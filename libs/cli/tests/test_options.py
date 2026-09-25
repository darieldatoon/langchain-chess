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
    assert model.model_name == "anthropic/claude-opus-5"
    assert model.openai_api_base == "https://gateway.smith.langchain.com/v1"
    assert model.profile == {"max_input_tokens": 1_000_000}
    assert chat_model("gpt-5.6-sol", "low").profile is None
