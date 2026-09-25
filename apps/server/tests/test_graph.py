import chess
import pytest
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.memory import InMemorySaver

from langchain_chess.testing import position
from langchain_chess_server import graph as graph_module
from langchain_chess_server.context import ChessContext
from langchain_chess_server.graph import build_agent, chat_model, make_graph
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
    assert model.model_name == "anthropic/claude-opus-5-5"
    assert model.openai_api_base == "https://gateway.smith.langchain.com/v1"
    assert model.max_tokens == 32000
    assert model.reasoning_effort == "low"
    assert model.profile == {"max_input_tokens": 1_000_000}
    assert model.get_name() == "claude-opus-5-5"
    other = chat_model(ChessContext(model="langsmith:openai/gpt-5.6-sol"))
    assert other.profile is None
    assert other.get_name() == "gpt-5.6-sol"


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


def test_summarize_through_the_real_model_factory(fake_systemone):
    from langchain_chess import ChessContractError

    settings = ServerSettings()
    agent = build_agent(ChessContext(memory="summarize"), settings)
    assert "SummarizationMiddleware.before_model" in nodes(agent)
    with pytest.raises(ChessContractError, match="summary_trigger_tokens"):
        build_agent(
            ChessContext(memory="summarize", model="langsmith:openai/gpt-5.6-sol"), settings
        )
    trigger = ChessContext(
        memory="summarize", model="langsmith:openai/gpt-5.6-sol", summary_trigger_tokens=50_000
    )
    assert "SummarizationMiddleware.before_model" in nodes(build_agent(trigger, settings))
    alone = build_agent(ChessContext(policy="systemone", memory="summarize"), settings)
    assert "SummarizationMiddleware.before_model" not in nodes(alone)
    assert build_agent(ChessContext(memory="full"), settings) is not None
