from contextlib import suppress
from itertools import product
from types import SimpleNamespace

import chess
import pytest
from langchain_core.callbacks import BaseCallbackHandler
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.memory import InMemorySaver
from pydantic import ValidationError

from langchain_chess import ChessContractError, create_chess_agent
from langchain_chess.testing import ScriptedModel, position, topology
from langchain_chess_server import graph as graph_module
from langchain_chess_server.context import resolve_context
from langchain_chess_server.graph import build_graph, make_graph, model_limit, pooled_ranker
from langchain_chess_server.settings import ServerSettings
from langchain_chess_systemone.agent import default_model as chat_model
from langchain_chess_systemone.settings import ChessContext, dump
from langchain_chess_systemone.testing import FakeTypeSafeClient

ITALIAN = "r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4"


@pytest.fixture
def fake_systemone(env, monkeypatch):
    client = FakeTypeSafeClient()
    monkeypatch.setattr(graph_module, "_classifier", lambda *args: client)
    return client


READ = SimpleNamespace(execution_runtime=None)


def build_agent(settings, *replies, **kwargs):
    """The server's graph; with `replies`, around a scripted model."""
    if replies:
        kwargs["model_factory"] = lambda _: ScriptedModel(script=list(replies))
    return build_graph(settings, ranker_factory=pooled_ranker(ServerSettings()), **kwargs)


def run_runtime(**context):
    return SimpleNamespace(execution_runtime=SimpleNamespace(context=context))


@pytest.mark.parametrize(
    ("policy", "memory"), list(product(["llm", "systemone", "hybrid"], [False, True]))
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


async def test_the_llm_policy_never_asks_system_one(fake_systemone):
    agent = build_agent(ChessContext(policy="llm"), "MOVE: e4", checkpointer=InMemorySaver())
    out = await agent.ainvoke(position(), {"configurable": {"thread_id": "t"}})
    assert out["plies"][0]["source"] == "llm"
    assert fake_systemone.requests == []


def test_the_first_turn_records_the_setup_and_later_runs_keep_it(env):
    saver, config = InMemorySaver(), {"configurable": {"thread_id": "t"}}
    first = ChessContext(policy="llm", threshold=0.5)
    agent = build_agent(first, "MOVE: e5", checkpointer=saver)
    out = agent.invoke(position(["e2e4"]), config)
    assert out["setup"] == dump(first)
    assert out["setup"]["version"] == 2

    later = ChessContext(policy="llm", model="langsmith:openai/gpt-6-luna")
    again = build_agent(later, "MOVE: Nc6", checkpointer=saver)
    out = again.invoke(position(["e2e4", "e7e5", "g1f3"]), config)
    assert len(out["plies"]) == 4
    assert again.get_state(config).values["setup"] == dump(first)


FOOLS_MATE = ["f2f3", "e7e5", "g2g4", "d8h4"]


def test_a_first_turn_that_ends_the_game_records_the_setup(env):
    context = ChessContext(policy="llm")
    agent = build_agent(context, checkpointer=InMemorySaver())
    out = agent.invoke(position(FOOLS_MATE), {"configurable": {"thread_id": "t"}})
    assert out["outcome"] == {"kind": "checkmate", "winner": "black"}
    assert out["setup"] == dump(context)


async def test_a_first_turn_that_ends_the_game_records_the_setup_async(env):
    context = ChessContext(policy="llm")
    agent = build_agent(context, checkpointer=InMemorySaver())
    out = await agent.ainvoke(position(FOOLS_MATE), {"configurable": {"thread_id": "t"}})
    assert out["outcome"] == {"kind": "checkmate", "winner": "black"}
    assert out["setup"] == dump(context)


def _legacy_thread(*replies, first="MOVE: e5"):
    """A thread whose one turn ran without the setup middleware."""
    saver, config = InMemorySaver(), {"configurable": {"thread_id": "t"}}
    old = create_chess_agent(ScriptedModel(script=[first]), checkpointer=saver)
    with suppress(RuntimeError):
        old.invoke(position(["e2e4"]), config)
    agent = build_agent(ChessContext(policy="llm"), *replies, checkpointer=saver)
    return agent, config


LEGACY_RUNS = {
    "a later turn": position(["e2e4", "e7e5", "g1f3"]),
    "an empty retry": {},
    "the same position again": position(["e2e4"]),
    "an illegal position": position(["e2e5"]),
}


@pytest.mark.parametrize("run", LEGACY_RUNS.values(), ids=LEGACY_RUNS.keys())
def test_a_thread_from_before_setup_never_gains_one(env, run):
    agent, config = _legacy_thread("MOVE: Nc6")
    assert "setup" not in agent.invoke(run, config)


@pytest.mark.parametrize("run", LEGACY_RUNS.values(), ids=LEGACY_RUNS.keys())
async def test_a_thread_from_before_setup_never_gains_one_async(env, run):
    agent, config = _legacy_thread("MOVE: Nc6")
    assert "setup" not in await agent.ainvoke(run, config)


def test_a_retried_first_turn_from_before_setup_gains_none(env):
    agent, config = _legacy_thread("MOVE: e5", first=RuntimeError("provider down"))
    assert agent.get_state(config).values["turns"][0]["status"] == "pending"
    out = agent.invoke({}, config)
    assert len(out["plies"]) == 2
    assert "setup" not in out


def test_a_first_turn_that_fails_still_records_the_setup(env):
    context = ChessContext(policy="llm")
    saver, config = InMemorySaver(), {"configurable": {"thread_id": "t"}}
    agent = build_agent(context, RuntimeError("provider down"), checkpointer=saver)
    with pytest.raises(RuntimeError):
        agent.invoke(position(["e2e4"]), config)
    assert agent.get_state(config).values["setup"] == dump(context)


async def test_a_rejected_first_input_records_no_setup(env):
    agent = build_agent(ChessContext(policy="llm"), checkpointer=InMemorySaver())
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
    assert build_agent(ChessContext(policy="llm")) is not None
    with pytest.raises(ValueError, match="System 1 needs TYPESAFE_API_KEY"):
        build_agent(ChessContext(policy="hybrid"))


async def test_systemone_alone_always_plays_even_with_a_tournament_threshold(fake_systemone):
    context = ChessContext(policy="systemone", threshold=0.95, tournament_threshold=0.99)
    agent = build_agent(context, checkpointer=InMemorySaver())
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
def test_memory_with_a_known_input_limit(fake_systemone, model):
    assert build_agent(ChessContext(memory=True, model=model)) is not None


def test_memory_needs_a_known_input_limit(fake_systemone):
    unknown = "langsmith:fireworks/accounts/fireworks/models/nope"
    with pytest.raises(ChessContractError, match="can't use memory; turn it off"):
        build_agent(ChessContext(memory=True, model=unknown))
    assert build_agent(ChessContext(memory=False, model=unknown)) is not None
    alone = ChessContext(policy="systemone", memory=True, model=unknown)
    assert build_agent(alone) is not None


def test_full_memory_is_gone():
    with pytest.raises(ValidationError):
        resolve_context({"configurable": {"memory": "full"}})


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


def test_the_server_builds_models_with_only_the_arguments_it_allows(env):
    model = graph_module.server_model(ChessContext(model_kwargs={"temperature": 0.3}))
    assert model.temperature == 0.3
    for held in ({"tools": [{"type": "web_search"}]}, {"extra_body": {"prompt": {"id": "p"}}}):
        with pytest.raises(ValueError, match="deployment's own tools"):
            graph_module.server_model(ChessContext(model_kwargs=held))
    with pytest.raises(ValueError, match="the server doesn't send it"):
        graph_module.server_model(ChessContext(model_kwargs={"seed": 3}))


class Metadata(BaseCallbackHandler):
    def __init__(self):
        self.seen = []

    def on_chain_start(self, serialized, inputs, *, metadata=None, **kwargs):
        self.seen.append(metadata or {})


def test_runs_record_the_values_sent_and_the_setup_keeps_model_kwargs_as_given(env):
    kwargs = {"reasoning_effort": "high", "max_output_tokens": 900}
    settings = ChessContext(policy="llm", reasoning_effort="low", model_kwargs=kwargs)
    agent = build_agent(settings, "MOVE: e5", checkpointer=InMemorySaver())
    handler = Metadata()
    config = {"configurable": {"thread_id": "t", "reasoning_effort": "low"}, "callbacks": [handler]}
    out = agent.invoke(position(["e2e4"]), config)
    assert handler.seen[0]["reasoning_effort"] == "high"
    assert handler.seen[0]["max_tokens"] == 900
    assert out["setup"]["model_kwargs"] == kwargs


def test_model_kwargs_go_unread_when_the_llm_does_not_play(fake_systemone):
    settings = ChessContext(policy="systemone", model_kwargs={"stop": ["x"]})
    assert build_agent(settings) is not None
