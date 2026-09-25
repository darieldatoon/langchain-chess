"""Against the real LLM Gateway: `uv run --all-packages --env-file .env pytest -m live --no-cov`."""

import os

import chess
import pytest
from langchain.chat_models import init_chat_model
from langgraph.checkpoint.memory import InMemorySaver

from langchain_chess import create_chess_agent
from langchain_chess.testing import position
from langchain_chess_systemone import GatewayRanker, RankRequest, SystemOneMiddleware

pytestmark = pytest.mark.live

ITALIAN = "r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4"
OPTIONS = tuple(m.uci() for m in chess.Board(ITALIAN).legal_moves)


def test_semif_runs_a_tournament_over_more_than_sixteen_moves():
    assert len(OPTIONS) > 16
    ranker = GatewayRanker("semif-qwen3.5-4b", with_eval=True)
    result = ranker.rank(RankRequest(ITALIAN, (), OPTIONS, seed=1))
    assert result.tournament is not None
    assert len(result.candidates) == 16
    assert len(result.calls) == 2
    assert all(c["input_tokens"] is None and c["cost_usd"] is None for c in result.calls)
    assert result.eval_score is not None


async def test_jev_ranks_every_move_in_one_request_and_is_priced():
    ranker = GatewayRanker("typesafe/jev-latest")
    result = await ranker.arank(RankRequest(ITALIAN, (), OPTIONS, seed=1))
    assert result.tournament is None
    assert len(result.candidates) == len(OPTIONS)
    (call,) = result.calls
    assert call["model"] == "typesafe:jev-latest"
    assert call["cost_usd"] is not None
    assert call["cost_usd"] > 0


async def test_a_hybrid_move():
    opus = init_chat_model(
        "langsmith:anthropic/claude-opus-5",
        base_url="https://gateway.smith.langchain.com/v1",
        api_key=os.environ["LANGSMITH_GATEWAY_API_KEY"],
        reasoning_effort="low",
        max_tokens=32000,
    )
    # threshold=1 always hands the SemIf shortlist to Opus.
    systemone = SystemOneMiddleware("semif-qwen3.5-4b", threshold=1.0, k=3)
    agent = create_chess_agent(opus, middleware=[systemone], checkpointer=InMemorySaver())
    out = await agent.ainvoke(position(start_fen=ITALIAN), {"configurable": {"thread_id": "h"}})
    ply = out["plies"][0]
    assert ply["source"] == "llm"
    meta = ply["meta"]["SystemOneMiddleware"]
    assert meta["status"] == "shortlist"
    assert len(meta["shortlist"]) == 3
    assert meta["finalist_conditional"] is True
    kinds = [c["kind"] for c in out["turns"][0]["calls"]]
    assert kinds.count("llm") >= 1
    assert kinds.count("systemone") == 2
