"""Against the real LLM Gateway: `uv run --all-packages --env-file .env pytest -m live --no-cov`."""

import chess
import pytest

from langchain_chess_evals.systemone.target import make_target
from langchain_chess_systemone import GatewayRanker

pytestmark = pytest.mark.live


async def test_the_target_ranks_a_real_position_with_semif():
    board = chess.Board()
    legal = [m.uci() for m in board.legal_moves]
    outputs = await make_target(GatewayRanker("semif-qwen3.5-4b"))(
        {"start_fen": board.fen(), "moves": [], "legal": legal}
    )
    assert outputs["error"] is None
    # 20 legal moves: SemIf holds 16, so a tournament ran
    assert outputs["tournament"] is True
    assert set(outputs["finalists"]) <= set(legal)
    assert outputs["ranked"][0]["uci"] in outputs["finalists"]
