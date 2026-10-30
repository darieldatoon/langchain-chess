"""The `chess` graph as the Agent Server runs it, under a real `langgraph dev`.

Checks what the in-process tests can't: that `langgraph.json` loads, that the server passes
assistant settings through the factory's `runtime`, that the call recorder survives the server
copying the graph, and that the `/ui` app is mounted. Against the real LLM Gateway:
`uv run --all-packages --env-file .env pytest -m live --no-cov`.
"""

from collections.abc import Callable, Iterator
from contextlib import AbstractContextManager
from typing import Any

import httpx
import pytest
from langgraph_sdk import get_sync_client
from langgraph_sdk.client import SyncLangGraphClient
from langgraph_sdk.schema import Config

pytestmark = pytest.mark.live


@pytest.fixture(scope="module")
def server(
    tmp_path_factory: pytest.TempPathFactory,
    langgraph_dev: Callable[..., AbstractContextManager[str]],
) -> Iterator[str]:
    with langgraph_dev(tmp_path_factory.mktemp("langgraph-dev")) as url:
        yield url


@pytest.fixture(scope="module")
def client(server: str) -> SyncLangGraphClient:
    return get_sync_client(url=server)


def human(content: str, id: str | None = None) -> dict[str, Any]:
    message: dict[str, Any] = {"type": "human", "content": content}
    if id is not None:
        message["id"] = id
    return {"messages": [message]}


SYSTEM_ONE: Config = {"configurable": {"policy": "systemone"}}


def test_the_ui_app_is_mounted(server: str):
    body = httpx.get(f"{server}/ui/config", timeout=10).json()
    assert body["graph"] == "chess"
    assert body["defaults"]["policy"] == "hybrid"


def test_a_chat_game_on_the_server(client: SyncLangGraphClient):
    thread = client.threads.create()["thread_id"]
    out = client.runs.wait(thread, "chess", input=human("e4", id="m1"), config=SYSTEM_ONE)
    assert out["moves"][0] == "e2e4"
    assert len(out["moves"]) == 2
    ply = out["plies"][1]
    assert (ply["source"], ply["model"]) == ("systemone", "typesafe/jev-latest")
    assert {c["kind"] for c in out["turns"][0]["calls"]} == {"systemone"}
    again = client.runs.wait(thread, "chess", input=human("e4", id="m1"), config=SYSTEM_ONE)
    assert again["moves"] == out["moves"]  # a resend is a no-op
    bad = client.runs.wait(thread, "chess", input=human("Ke9"), config=SYSTEM_ONE)
    assert "neither `go` nor a legal move" in bad["error"]


def test_assistant_settings_reach_the_factory_through_runtime(client: SyncLangGraphClient):
    # No run config at all: only the assistant's context can make this System 1 alone.
    assistant = client.assistants.create("chess", context={"policy": "systemone", "seed": 7})
    thread = client.threads.create()["thread_id"]
    out = client.runs.wait(thread, assistant["assistant_id"], input=human("go"))
    assert out["plies"][0]["source"] == "systemone"
    assert out["turns"][0]["calls"]
    assert all(c["kind"] == "systemone" for c in out["turns"][0]["calls"])


def test_the_recorder_prices_llm_calls_on_the_server(client: SyncLangGraphClient):
    # threshold=1 always hands System 1's shortlist to the LLM.
    config: Config = {"configurable": {"threshold": 1.0}}
    thread = client.threads.create()["thread_id"]
    out = client.runs.wait(thread, "chess", input=human("go"), config=config)
    ply = out["plies"][0]
    assert ply["source"] == "llm"
    llm = [c for c in out["turns"][0]["calls"] if c["kind"] == "llm"]
    assert llm
    assert llm[-1]["model"] == "baseten:zai-org/GLM-5.3-Flash"
    assert llm[-1]["cost_usd"] is not None
    assert llm[-1]["cost_usd"] > 0
