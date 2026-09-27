import pytest
from langgraph.checkpoint.memory import InMemorySaver

from langchain_chess import ChessContractError
from langchain_chess.testing import ScriptedModel, position, topology
from langchain_chess_systemone import GatewayRanker
from langchain_chess_systemone.agent import build_agent, default_model, default_ranker
from langchain_chess_systemone.settings import ChessContext
from langchain_chess_systemone.testing import FakeRanker, distribution

SYSTEM_ONE = "SystemOneMiddleware.before_model"
SUMMARY = "SummarizationMiddleware.before_model"


def scripted(*replies, profile=None):
    return lambda settings: ScriptedModel(script=list(replies), profile=profile)


def nodes(agent):
    return topology(agent)[0]


@pytest.fixture
def gateway(monkeypatch):
    monkeypatch.setenv("LANGSMITH_GATEWAY", "true")
    monkeypatch.setenv("LANGSMITH_GATEWAY_API_KEY", "lsv2_test")


@pytest.mark.parametrize(
    ("policy", "systemone"), [("llm", False), ("systemone", True), ("hybrid", True)]
)
def test_policies_build_their_stacks(policy, systemone):
    ranker = FakeRanker([])
    agent = build_agent(
        ChessContext(policy=policy), model_factory=scripted(), ranker_factory=lambda s: ranker
    )
    assert (SYSTEM_ONE in nodes(agent)) is systemone
    assert SUMMARY not in nodes(agent)


def test_a_fixed_topology_keeps_every_node():
    shapes = [
        topology(
            build_agent(
                ChessContext(policy=policy, memory=memory),
                model_factory=scripted(profile={"max_input_tokens": 100_000}),
                ranker_factory=lambda s: FakeRanker([]),
                fixed_topology=True,
            )
        )
        for policy in ("llm", "systemone", "hybrid")
        for memory in (False, True)
    ]
    assert all(shape == shapes[0] for shape in shapes)
    assert {SYSTEM_ONE, SUMMARY} <= shapes[0][0]


async def test_the_settings_reach_the_agent():
    ranker = FakeRanker([distribution({"e7e5": 0.5, "c7c5": 0.4})])
    model = ScriptedModel(script=["MOVE: c5"])
    settings = ChessContext(threshold=0.95, k=1, move_list="none", seed=3)
    agent = build_agent(
        settings,
        model_factory=lambda s: model,
        ranker_factory=lambda s: ranker,
        checkpointer=InMemorySaver(),
    )
    out = await agent.ainvoke(position(["e2e4"]), {"configurable": {"thread_id": "t"}})
    assert out["plies"][-1]["uci"] == "c7c5"
    prompt = model.requests[0][-1].content
    assert "Suggested candidates" not in prompt
    assert "Legal moves" not in prompt
    meta = out["plies"][-1]["meta"]["SystemOneMiddleware"]
    assert (meta["threshold_used"], [m["uci"] for m in meta["shortlist"]]) == (0.95, ["e7e5"])


def test_system_one_alone_always_plays_and_never_builds_a_model():
    def no_model(settings):
        raise AssertionError

    agent = build_agent(
        ChessContext(policy="systemone", threshold=1.0, memory=True),
        model_factory=no_model,
        ranker_factory=lambda s: FakeRanker([]),
    )
    assert SUMMARY not in nodes(agent)


def test_memory_needs_a_known_input_limit():
    with pytest.raises(ChessContractError, match="no known input limit, so it can't use memory"):
        build_agent(ChessContext(policy="llm", memory=True), model_factory=scripted())
    agent = build_agent(
        ChessContext(policy="llm", memory=True),
        model_factory=scripted(profile={"max_input_tokens": 100_000}),
    )
    assert SUMMARY in nodes(agent)


def test_the_default_model_is_the_gateway_chat_model(gateway):
    model = default_model(ChessContext(reasoning_effort="low"))
    assert model.model_name == "baseten/zai-org/GLM-5.3-Flash"
    assert model.openai_api_base == "https://gateway.smith.langchain.com/v1"
    assert model.reasoning_effort == "low"
    assert model.profile == {"max_input_tokens": 1_048_000 - 64000}
    assert default_model(ChessContext()).reasoning_effort is None


def test_the_default_ranker_describes_moves_as_the_settings_say(gateway, monkeypatch):
    monkeypatch.setenv("TYPESAFE_API_KEY", "lsv2_test")
    monkeypatch.setenv("TYPESAFE_BASE_URL", "https://gateway.smith.langchain.com")
    ranker = default_ranker(ChessContext(systemone_model="typesafe/jev-latest", style="terse"))
    assert isinstance(ranker, GatewayRanker)
    assert (ranker.model, ranker.style) == ("typesafe/jev-latest", "terse")
