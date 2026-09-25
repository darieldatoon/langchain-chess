from langgraph.checkpoint.memory import InMemorySaver

from langchain_chess.testing import ScriptedModel
from langchain_chess_cli.models import chat_model
from langchain_chess_cli.options import AgentOptions, build_agent, default_model


def nodes(agent):
    return set(agent.get_graph().nodes)


def test_policies_build_their_stacks():
    factory = lambda options: ScriptedModel(script=[])  # noqa: E731
    for policy, systemone in (("llm", False), ("systemone", True), ("hybrid", True)):
        agent = build_agent(
            AgentOptions(policy=policy),
            draw_claims="auto",
            checkpointer=InMemorySaver(),
            model_factory=factory,
        )
        assert ("SystemOneMiddleware.before_model" in nodes(agent)) is systemone


def test_the_cli_chat_model_uses_the_environment(monkeypatch):
    monkeypatch.setenv("LANGSMITH_GATEWAY", "true")
    monkeypatch.setenv("LANGSMITH_GATEWAY_API_KEY", "lsv2_test")
    model = default_model(AgentOptions(reasoning_effort="low"))
    assert model.model_name == "anthropic/claude-opus-5-5"
    assert model.openai_api_base == "https://gateway.smith.langchain.com/v1"
    assert model.profile == {"max_input_tokens": 1_000_000}
    assert chat_model("gpt-5.6-sol", "low").profile is None


def test_summarize_through_the_cli_model_factory(monkeypatch):
    import pytest

    from langchain_chess import ChessContractError

    monkeypatch.setenv("LANGSMITH_GATEWAY", "true")
    monkeypatch.setenv("LANGSMITH_GATEWAY_API_KEY", "lsv2_test")
    saver = InMemorySaver()
    agent = build_agent(AgentOptions(memory="summarize"), draw_claims="auto", checkpointer=saver)
    assert "SummarizationMiddleware.before_model" in nodes(agent)
    profileless = AgentOptions(memory="summarize", model="gpt-5.6-sol")
    with pytest.raises(ChessContractError, match="summary_trigger_tokens"):
        build_agent(profileless, draw_claims="auto", checkpointer=saver)
    trigger = AgentOptions(memory="summarize", model="gpt-5.6-sol", summary_trigger_tokens=9000)
    agent = build_agent(trigger, draw_claims="auto", checkpointer=saver)
    assert "SummarizationMiddleware.before_model" in nodes(agent)
    alone = AgentOptions(policy="systemone", memory="summarize")
    agent = build_agent(alone, draw_claims="auto", checkpointer=saver)
    assert "SummarizationMiddleware.before_model" not in nodes(agent)
