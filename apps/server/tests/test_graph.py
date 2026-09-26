import chess
import pytest
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.memory import InMemorySaver
from pydantic import ValidationError

from langchain_chess import ChessContractError
from langchain_chess.testing import position
from langchain_chess_server import graph as graph_module
from langchain_chess_server.context import ChessContext, resolve_context
from langchain_chess_server.graph import build_agent, chat_model, make_graph, model_limit
from langchain_chess_server.settings import ServerSettings
from langchain_chess_systemone.testing import FakeTypeSafeClient

ITALIAN = "r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4"


@pytest.fixture
def fake_systemone(env, monkeypatch):
    client = FakeTypeSafeClient()
    monkeypatch.setattr(graph_module, "_classifier", lambda *args: client)
    return client


def nodes(agent):
    return set(agent.get_graph().nodes)


@pytest.mark.parametrize(
    ("policy", "has_systemone", "has_model"),
    [("llm", False, True), ("systemone", True, False), ("hybrid", True, True)],
)
def test_each_policy_builds_its_stack(fake_systemone, policy, has_systemone, has_model):
    agent = make_graph({"configurable": {"policy": policy}}, None)
    assert agent.name == "chess"
    assert ("SystemOneMiddleware.before_model" in nodes(agent)) is has_systemone
    assert fake_systemone.requests == []
    model = agent.get_graph().nodes["model"]
    assert model is not None
    assert has_model is (policy != "systemone")


def test_the_gateway_chat_model(env):
    model = chat_model(ChessContext(reasoning_effort="low"))
    assert isinstance(model, ChatOpenAI)
    assert model.model_name == "baseten/zai-org/GLM-5.3-Flash"
    assert model.openai_api_base == "https://gateway.smith.langchain.com/v1"
    assert model.max_tokens == 32000
    assert model.reasoning_effort == "low"
    assert model.profile == {"max_input_tokens": 1_048_000 - 32000}
    assert model.get_name() == "zai-org/GLM-5.3-Flash"
    opus = chat_model(ChessContext(model="langsmith:anthropic/claude-opus-5-5"))
    assert opus.profile == {"max_input_tokens": 1_000_000 - 32000}
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


def test_the_classifier_is_cached_per_model(env):
    a = graph_module._classifier("semif-qwen3.5-4b", "k", "https://gateway.smith.langchain.com")
    b = graph_module._classifier("semif-qwen3.5-4b", "k", "https://gateway.smith.langchain.com")
    assert a is b
    assert a.base_url == "https://gateway.smith.langchain.com"


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
    agent = build_agent(ChessContext(memory="summarize", model=model), ServerSettings())
    assert "SummarizationMiddleware.before_model" in nodes(agent)


def test_summarize_needs_a_known_input_limit(fake_systemone):
    unknown = "langsmith:fireworks/accounts/fireworks/models/nope"
    with pytest.raises(ChessContractError, match="use memory='none'"):
        build_agent(ChessContext(memory="summarize", model=unknown), ServerSettings())
    assert build_agent(ChessContext(memory="none", model=unknown), ServerSettings()) is not None
    alone = ChessContext(policy="systemone", memory="summarize", model=unknown)
    assert "SummarizationMiddleware.before_model" not in nodes(build_agent(alone, ServerSettings()))


def test_full_memory_is_gone():
    with pytest.raises(ValidationError):
        resolve_context(ChessContext, {"configurable": {"memory": "full"}})


def test_the_model_limit_agrees_with_the_agent(env):
    model_limit.cache_clear()
    assert model_limit("langsmith:baseten/zai-org/GLM-5.3-Flash") == 1_048_000 - 32000
    assert model_limit("gpt-5.6-sol") == 1_050_000
    assert model_limit("langsmith:fireworks/accounts/fireworks/models/nope") is None
    assert model_limit("fireworks/accounts/fireworks/models/glm-5p3") is None
