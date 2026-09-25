"""Against the real LLM Gateway: `uv run --all-packages --env-file .env pytest -m live --no-cov`."""

import os

import pytest
from langchain.chat_models import init_chat_model
from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.memory import InMemorySaver

from langchain_chess import create_chess_agent, turn_cost
from langchain_chess.testing import human

pytestmark = pytest.mark.live

GATEWAY = "https://gateway.smith.langchain.com/v1"


def opus():
    return init_chat_model(
        "langsmith:anthropic/claude-opus-5",
        base_url=GATEWAY,
        api_key=os.environ["LANGSMITH_GATEWAY_API_KEY"],
        reasoning_effort="low",
        max_tokens=32000,
    )


async def test_a_few_opus_moves_are_played_and_priced():
    agent = create_chess_agent(opus(), checkpointer=InMemorySaver())
    config: RunnableConfig = {"configurable": {"thread_id": "live-opus"}, "tags": ["live"]}
    out = await agent.ainvoke(human("go"), config)
    for reply in ("e5", "Nc6"):
        if out["outcome"] is not None:
            break
        legal_reply = await agent.ainvoke(human(reply), config)
        if legal_reply["error"]:
            # Opus opened with something other than 1.e4; answer with any legal move instead.
            legal_reply = await agent.ainvoke(human("go"), config)
        out = legal_reply
    assert len(out["plies"]) >= 3
    llm_turns = [t for t in out["turns"] if t["status"] == "committed"]
    for turn in llm_turns:
        call = turn["calls"][-1]
        assert call["model"] == "anthropic:claude-opus-5"
        assert call["input_tokens"] > 0
        assert call["cost_usd"] is not None
        assert call["cost_usd"] > 0
        cost = turn_cost(turn["calls"])
        assert cost is not None
        assert cost["complete"]
