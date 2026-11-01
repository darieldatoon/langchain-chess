"""The `chess` graph under a real `langgraph dev`, offline: no run here reaches a model.

The server rebuilds the graph without the run's settings to read a thread and to describe the
graph, so every build must have the same shape as the one that ran.
"""

import os
from collections.abc import Callable, Iterator
from contextlib import AbstractContextManager
from types import SimpleNamespace
from typing import Any

import pytest
from langgraph_sdk import get_sync_client
from langgraph_sdk.client import SyncLangGraphClient

from langchain_chess.testing import position, topology
from langchain_chess_server.graph import make_graph
from langchain_chess_systemone.settings import ChessContext, dump

PAUSED = ["SummarizationMiddleware.before_model"]
# Studio saves an assistant without a version.
SETTINGS = {"policy": "llm", "memory": True, "move_list": "candidates"}
RESOLVED = ChessContext(policy="llm", memory=True, move_list="candidates")


@pytest.fixture(scope="module")
def client(
    tmp_path_factory: pytest.TempPathFactory,
    langgraph_dev: Callable[..., AbstractContextManager[str]],
) -> Iterator[SyncLangGraphClient]:
    workdir = tmp_path_factory.mktemp("langgraph-dev-offline")
    env_file = workdir / ".env"
    env_file.write_text(
        "LANGSMITH_GATEWAY=true\nLANGSMITH_GATEWAY_API_KEY=lsv2_test\nLANGSMITH_TRACING=false\n"
    )
    # No System 1 keys, and none of the shell's LangSmith settings.
    prefixes = ("LANGSMITH_", "LANGCHAIN_", "TYPESAFE_", "LC_")
    environ = {k: v for k, v in os.environ.items() if not k.startswith(prefixes)}
    with langgraph_dev(workdir, env_file=env_file, environ=environ) as url:
        yield get_sync_client(url=url)


def _paused_run(client: SyncLangGraphClient, assistant: str, **run: Any) -> tuple[str, list]:
    """Runs until summarization; returns the thread and the `next` the running graph reported."""
    thread = client.threads.create()["thread_id"]
    reported = [
        part.data["payload"]["next"]
        for part in client.runs.stream(
            thread, assistant, input=position(), interrupt_before=PAUSED, stream_mode="debug", **run
        )
        if part.event == "debug" and part.data["type"] == "checkpoint"
    ]
    return thread, reported[-1]


@pytest.mark.parametrize("via", ["run config", "assistant context"])
def test_a_paused_run_reads_back_as_the_graph_that_ran(client, env, via):
    if via == "run config":
        assistant, run = "chess", {"config": {"configurable": SETTINGS}}
    else:
        assistant, run = client.assistants.create("chess", context=SETTINGS)["assistant_id"], {}
    thread, reported = _paused_run(client, assistant, **run)
    assert reported == PAUSED
    state = client.threads.get_state(thread)
    assert state["next"] == reported
    assert state["values"]["setup"] == dump(RESOLVED)
    ran = make_graph({}, SimpleNamespace(execution_runtime=SimpleNamespace(context=SETTINGS)))
    described = client.assistants.get_graph(assistant)
    assert {node["id"] for node in described["nodes"]} == topology(ran)[0]


def test_an_unversioned_assistant_with_a_versioned_partial_override(client):
    assistant = client.assistants.create("chess", context=SETTINGS)["assistant_id"]
    override = {"version": 1, "k": 3, "top_p": 0.5}
    thread, _ = _paused_run(client, assistant, config={"configurable": override})
    setup = client.threads.get_state(thread)["values"]["setup"]
    assert setup == dump(RESOLVED.model_copy(update={"k": 3, "top_p": 0.5}))


def test_a_run_without_system_1_keys_fails_before_writing_and_its_thread_still_reads(client):
    thread = client.threads.create()["thread_id"]
    run = client.runs.create(
        thread, "chess", input=position(), config={"configurable": {"policy": "hybrid"}}
    )
    client.runs.join(thread, run["run_id"])
    assert client.runs.get(thread, run["run_id"])["status"] == "error"
    state = client.threads.get_state(thread)
    assert (state["values"], state["next"]) == ({}, [])


def test_langgraph_dev_needs_no_key_but_checks_a_bearer_token(client: SyncLangGraphClient):
    http = client.http.client
    assert http.post("/assistants/search", json={"limit": 1}).status_code == 200
    refused = http.post(
        "/assistants/search", json={"limit": 1}, headers={"Authorization": "Bearer not-a-jwt"}
    )
    assert refused.status_code == 401
