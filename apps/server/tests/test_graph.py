from contextlib import suppress
from dataclasses import asdict
from itertools import product
from types import SimpleNamespace

import chess
import pytest
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.memory import InMemorySaver
from pydantic import ValidationError

from langchain_chess import ChessContractError, create_chess_agent
from langchain_chess.testing import ScriptedModel, position, topology
from langchain_chess_server import graph as graph_module
from langchain_chess_server.context import ChessContext, resolve_context
from langchain_chess_server.graph import (
    build_agent,
    chat_model,
    make_graph,
    model_limit,
)
from langchain_chess_server.settings import ServerSettings
from langchain_chess_systemone.testing import FakeTypeSafeClient

ITALIAN = "r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4"


@pytest.fixture
def fake_systemone(env, monkeypatch):
    client = FakeTypeSafeClient()
    monkeypatch.setattr(graph_module, "_classifier", lambda *args: client)
    return client


READ = SimpleNamespace(execution_runtime=None)


def run_runtime(**context):
    return SimpleNamespace(execution_runtime=SimpleNamespace(context=context))


@pytest.mark.parametrize(
    ("policy", "memory"), list(product(["llm", "systemone", "hybrid"], ["none", "summarize"]))
)
def test_every_setting_builds_the_graph_reads_rebuild(fake_systemone, policy, memory):
    run = make_graph({}, run_runtime(policy=policy, memory=memory))
    read = make_graph({"configurable": {"policy": policy, "memory": memory}}, READ)
    assert (run.name, read.name) == ("chess", "chess")
    assert topology(run) == topology(read)
    assert "SummarizationMiddleware.before_model" in topology(run)[0]
    assert "SystemOneMiddleware.before_model" in topology(run)[0]
    assert "GameSetupMiddleware.before_agent" in topology(run)[0]
    assert fake_systemone.requests == []


def test_reads_need_no_credentials(env):
    for name in ("LANGSMITH_GATEWAY_API_KEY", "TYPESAFE_API_KEY", "TYPESAFE_BASE_URL"):
        env.delenv(name)
    assert make_graph({}, READ).name == "chess"


async def test_the_llm_policy_never_asks_system_one(fake_systemone, monkeypatch):
    model = ScriptedModel(script=["MOVE: e4"])
    monkeypatch.setattr(graph_module, "chat_model", lambda context: model)
    agent = build_agent(ChessContext(policy="llm"), ServerSettings(), checkpointer=InMemorySaver())
    out = await agent.ainvoke(position(), {"configurable": {"thread_id": "t"}})
    assert out["plies"][0]["source"] == "llm"
    assert fake_systemone.requests == []


def _scripted(monkeypatch, *replies):
    monkeypatch.setattr(graph_module, "chat_model", lambda context: ScriptedModel(script=replies))


def test_the_first_turn_records_the_setup_and_later_runs_keep_it(env, monkeypatch):
    _scripted(monkeypatch, "MOVE: e5", "MOVE: Nc6")
    saver, config = InMemorySaver(), {"configurable": {"thread_id": "t"}}
    first = ChessContext(policy="llm", threshold=0.5)
    agent = build_agent(first, ServerSettings(), checkpointer=saver)
    out = agent.invoke(position(["e2e4"]), config)
    assert out["setup"] == asdict(first)

    later = ChessContext(policy="llm", model="langsmith:openai/gpt-6-luna")
    again = build_agent(later, ServerSettings(), checkpointer=saver)
    out = again.invoke(position(["e2e4", "e7e5", "g1f3"]), config)
    assert len(out["plies"]) == 4
    assert again.get_state(config).values["setup"] == asdict(first)


FOOLS_MATE = ["f2f3", "e7e5", "g2g4", "d8h4"]


def test_a_first_turn_that_ends_the_game_records_the_setup(env, monkeypatch):
    _scripted(monkeypatch)
    context = ChessContext(policy="llm")
    agent = build_agent(context, ServerSettings(), checkpointer=InMemorySaver())
    out = agent.invoke(position(FOOLS_MATE), {"configurable": {"thread_id": "t"}})
    assert out["outcome"] == {"kind": "checkmate", "winner": "black"}
    assert out["setup"] == asdict(context)


async def test_a_first_turn_that_ends_the_game_records_the_setup_async(env, monkeypatch):
    _scripted(monkeypatch)
    context = ChessContext(policy="llm")
    agent = build_agent(context, ServerSettings(), checkpointer=InMemorySaver())
    out = await agent.ainvoke(position(FOOLS_MATE), {"configurable": {"thread_id": "t"}})
    assert out["outcome"] == {"kind": "checkmate", "winner": "black"}
    assert out["setup"] == asdict(context)


def _legacy_thread(monkeypatch, *replies, first="MOVE: e5"):
    """A thread whose one turn ran without the setup middleware."""
    saver, config = InMemorySaver(), {"configurable": {"thread_id": "t"}}
    old = create_chess_agent(ScriptedModel(script=[first]), checkpointer=saver)
    with suppress(RuntimeError):
        old.invoke(position(["e2e4"]), config)
    _scripted(monkeypatch, *replies)
    agent = build_agent(ChessContext(policy="llm"), ServerSettings(), checkpointer=saver)
    return agent, config


LEGACY_RUNS = {
    "a later turn": position(["e2e4", "e7e5", "g1f3"]),
    "an empty retry": {},
    "the same position again": position(["e2e4"]),
    "an illegal position": position(["e2e5"]),
}


@pytest.mark.parametrize("run", LEGACY_RUNS.values(), ids=LEGACY_RUNS.keys())
def test_a_thread_from_before_setup_never_gains_one(env, monkeypatch, run):
    agent, config = _legacy_thread(monkeypatch, "MOVE: Nc6")
    assert "setup" not in agent.invoke(run, config)


@pytest.mark.parametrize("run", LEGACY_RUNS.values(), ids=LEGACY_RUNS.keys())
async def test_a_thread_from_before_setup_never_gains_one_async(env, monkeypatch, run):
    agent, config = _legacy_thread(monkeypatch, "MOVE: Nc6")
    assert "setup" not in await agent.ainvoke(run, config)


def test_a_retried_first_turn_from_before_setup_gains_none(env, monkeypatch):
    agent, config = _legacy_thread(monkeypatch, "MOVE: e5", first=RuntimeError("provider down"))
    assert agent.get_state(config).values["turns"][0]["status"] == "pending"
    out = agent.invoke({}, config)
    assert len(out["plies"]) == 2
    assert "setup" not in out


def test_a_first_turn_that_fails_still_records_the_setup(env, monkeypatch):
    _scripted(monkeypatch, RuntimeError("provider down"))
    context = ChessContext(policy="llm")
    saver, config = InMemorySaver(), {"configurable": {"thread_id": "t"}}
    agent = build_agent(context, ServerSettings(), checkpointer=saver)
    with pytest.raises(RuntimeError):
        agent.invoke(position(["e2e4"]), config)
    assert agent.get_state(config).values["setup"] == asdict(context)


async def test_a_rejected_first_input_records_no_setup(env, monkeypatch):
    _scripted(monkeypatch)
    agent = build_agent(ChessContext(policy="llm"), ServerSettings(), checkpointer=InMemorySaver())
    out = await agent.ainvoke(position(["e2e5"]), {"configurable": {"thread_id": "t"}})
    assert out["error"]
    assert "setup" not in out


def test_the_gateway_chat_model(env):
    model = chat_model(ChessContext(reasoning_effort="low"))
    assert isinstance(model, ChatOpenAI)
    assert model.model_name == "baseten/zai-org/GLM-5.3-Flash"
    assert model.openai_api_base == "https://gateway.smith.langchain.com/v1"
    assert model.max_tokens == 64000
    assert model.reasoning_effort == "low"
    assert model.profile == {"max_input_tokens": 1_048_000 - 64000}
    assert model.get_name() == "zai-org/GLM-5.3-Flash"
    opus = chat_model(ChessContext(model="langsmith:anthropic/claude-opus-5-5"))
    assert opus.profile == {"max_input_tokens": 1_000_000 - 64000}
    assert opus.get_name() == "claude-opus-5-5"
    unknown = chat_model(ChessContext(model="langsmith:fireworks/accounts/fireworks/models/nope"))
    assert unknown.profile is None


def test_no_reasoning_effort_sends_none(env):
    haiku = chat_model(ChessContext(model="langsmith:anthropic/claude-haiku-4-5-20251001"))
    assert haiku.reasoning_effort is None
    assert "reasoning" not in haiku._get_request_payload("hi")


@pytest.mark.parametrize("spec", ["openai:gpt-5.6-sol", "gpt-5.6-sol"])
def test_provider_specs_and_bare_names_use_the_environment(env, spec):
    # With LANGSMITH_GATEWAY=true, langchain-core routes provider specs to the passthrough.
    model = chat_model(ChessContext(model=spec))
    assert model.openai_api_base == "https://gateway.smith.langchain.com/openai/v1"
    assert model.get_name() == "gpt-5.6-sol"


def test_systemone_needs_typesafe_settings_only_when_it_runs(env):
    env.delenv("TYPESAFE_API_KEY")
    assert build_agent(ChessContext(policy="llm"), ServerSettings()) is not None
    with pytest.raises(ValueError, match="System 1 needs TYPESAFE_API_KEY"):
        build_agent(ChessContext(policy="hybrid"), ServerSettings())


async def test_systemone_alone_always_plays_even_with_a_tournament_threshold(fake_systemone):
    context = ChessContext(policy="systemone", threshold=0.95, tournament_threshold=0.99)
    agent = build_agent(context, ServerSettings(), checkpointer=InMemorySaver())
    out = await agent.ainvoke(position(start_fen=ITALIAN), {"configurable": {"thread_id": "t"}})
    ply = out["plies"][0]
    assert ply["source"] == "systemone"
    assert ply["meta"]["SystemOneMiddleware"]["threshold_used"] == 0.0
    assert len(fake_systemone.requests) == 2
    assert len(list(chess.Board(ITALIAN).legal_moves)) > 16


def test_classifiers_share_one_connection_pool(env):
    gateway = "https://gateway.smith.langchain.com"
    semif = graph_module._classifier("semif-qwen3.5-4b", "k", gateway)
    jev = graph_module._classifier("typesafe/jev-latest", "k", gateway)
    assert semif.client is jev.client
    assert semif.async_client is jev.async_client
    assert semif.base_url == gateway


@pytest.mark.parametrize(
    "model",
    [
        "langsmith:baseten/zai-org/GLM-5.3-Flash",
        "langsmith:anthropic/claude-opus-5-5",
        "langsmith:anthropic/claude-haiku-4-5-20251001",
        "langsmith:openai/gpt-6-luna",
        "gpt-5.6-sol",
    ],
)
def test_summarize_with_a_known_input_limit(fake_systemone, model):
    assert build_agent(ChessContext(memory="summarize", model=model), ServerSettings()) is not None


def test_summarize_needs_a_known_input_limit(fake_systemone):
    unknown = "langsmith:fireworks/accounts/fireworks/models/nope"
    with pytest.raises(ChessContractError, match="use memory='none'"):
        build_agent(ChessContext(memory="summarize", model=unknown), ServerSettings())
    assert build_agent(ChessContext(memory="none", model=unknown), ServerSettings()) is not None
    alone = ChessContext(policy="systemone", memory="summarize", model=unknown)
    assert build_agent(alone, ServerSettings()) is not None


def test_full_memory_is_gone():
    with pytest.raises(ValidationError):
        resolve_context(ChessContext, {"configurable": {"memory": "full"}})


def test_the_model_limit_agrees_with_the_agent(env):
    model_limit.cache_clear()
    assert model_limit("langsmith:baseten/zai-org/GLM-5.3-Flash") == 1_048_000 - 64000
    assert model_limit("gpt-5.6-sol") == 1_050_000 - 64000
    assert model_limit("langsmith:fireworks/accounts/fireworks/models/nope") is None
    assert model_limit("fireworks/accounts/fireworks/models/glm-5p3") is None


def test_a_small_window_splits_between_input_and_output(env):
    gpt4 = chat_model(ChessContext(model="langsmith:openai/gpt-4"))
    assert gpt4.max_tokens == 8192 // 2
    assert gpt4.profile == {"max_input_tokens": 8192 - 8192 // 2}
    model_limit.cache_clear()
    assert model_limit("langsmith:openai/gpt-4") == 8192 - 8192 // 2
