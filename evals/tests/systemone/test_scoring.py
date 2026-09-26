import chess
import pytest

from langchain_chess.grading import Cp, Mate
from langchain_chess_evals.positions.examples import Reference
from langchain_chess_evals.systemone.scoring import ROW_METRICS, row_scores

WHITE = {"start_fen": chess.STARTING_FEN, "moves": [], "legal": []}
BLACK = {"start_fen": chess.STARTING_FEN, "moves": ["e2e4"], "legal": []}
# Engine order, best first; White's side
REFERENCE = Reference(
    {
        "e2e4": Cp(40),
        "d2d4": Cp(35),
        "g1f3": Cp(30),
        "c2c4": Cp(20),
        "b1c3": Cp(10),
        "a2a3": Cp(0),
        "h2h4": Cp(-30),
        "g2g4": Cp(-100),
        "f2f3": Mate(4, "black"),
    }
)


def outputs(ranked, *, finalists=None, error=None, input_tokens=100):
    return {
        "ranked": [{"uci": u, "probability": 0.1} for u in ranked],
        "finalists": finalists,
        "error": error,
        "requests": 2 if finalists else 1,
        "latency_ms": 250.0,
        "input_tokens": input_tokens,
    }


def test_a_ranking_with_the_best_move_second():
    ranked = ["d2d4", "e2e4", "a2a3", "h2h4", "g2g4", "c2c4", "b1c3", "g1f3", "f2f3"]
    scores = row_scores(WHITE, outputs(ranked), REFERENCE, played_move="d2d4")
    assert set(scores) == set(ROW_METRICS)
    assert [scores[f"recall@{k}"] for k in (1, 3, 5, 8)] == [0.0, 1.0, 1.0, 1.0]
    assert scores["top3_in_top5"] == 1.0
    assert scores["human_match@1"] == 1.0
    assert scores["cp_loss"] == 5.0
    assert scores["win_pct_loss"] == pytest.approx(0.46, abs=0.01)
    assert (scores["finalist_recall"], scores["finalist_top3"]) == (None, None)
    assert (scores["error"], scores["requests"], scores["input_tokens"]) == (0.0, 1.0, 100.0)


def test_losses_are_capped_and_seen_from_the_mover():
    blunder = row_scores(WHITE, outputs(["f2f3"]), REFERENCE, played_move="e2e4")
    assert blunder["cp_loss"] == 1000.0
    assert blunder["recall@8"] == 0.0
    assert blunder["top3_in_top5"] == 0.0
    # Black to move: the lowest White score is Black's best
    black = Reference({"e7e5": Cp(-30), "d7d5": Cp(10)})
    scores = row_scores(BLACK, outputs(["d7d5"]), black, played_move="e7e5")
    assert scores["cp_loss"] == 40.0
    assert scores["human_match@1"] == 0.0


def test_a_tournament_that_lost_the_best_move_in_the_heats():
    ranked = ["g1f3", "c2c4"]
    scores = row_scores(
        WHITE, outputs(ranked, finalists=ranked, input_tokens=None), REFERENCE, "e2e4"
    )
    assert scores["recall@8"] == 0.0
    assert scores["finalist_recall"] == 0.0
    assert scores["finalist_top3"] == 1.0
    assert scores["requests"] == 2.0
    assert scores["input_tokens"] is None


def test_a_failed_ranking_is_a_miss():
    scores = row_scores(WHITE, outputs([], error="down"), REFERENCE, played_move="e2e4")
    assert scores["recall@1"] == 0.0
    assert scores["human_match@1"] == 0.0
    assert (scores["cp_loss"], scores["win_pct_loss"]) == (None, None)
    assert scores["error"] == 1.0
