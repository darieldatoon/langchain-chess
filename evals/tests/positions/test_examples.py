import uuid

import chess
import pytest

from langchain_chess.grading import Analysis, Cp, Line, Mate
from langchain_chess_evals.positions.examples import (
    LabelError,
    Reference,
    Row,
    eval_from_json,
    is_tactic,
    reference_from,
    row_of,
)
from langchain_chess_evals.positions.sampling import Game, Position, Sampled
from langchain_chess_evals.testing import fake_analysis

AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"


def test_eval_json_round_trip():
    assert eval_from_json({"cp": -35}) == Cp(-35)
    assert eval_from_json({"mate": 3, "winner": "black"}) == Mate(3, "black")
    reference = Reference({"e2e4": Cp(30), "d2d4": Mate(2, "white")})
    assert Reference.from_json(reference.json()) == reference
    assert reference.json()["best"] == "e2e4"
    assert reference.json()["top3"] == ["e2e4", "d2d4"]


def test_reference_order_survives_sorted_json_keys():
    reference = Reference({"g1f3": Cp(30), "a2a3": Cp(-10), "d2d4": Cp(20)})
    data = reference.json()
    data["evals"] = dict(sorted(data["evals"].items()))
    restored = Reference.from_json(data)
    assert restored == reference
    assert (restored.best, restored.top3) == ("g1f3", ("g1f3", "a2a3", "d2d4"))
    with pytest.raises(ValueError, match="every move"):
        Reference({"e2e4": Cp(0)}, ("d2d4",))


def test_reference_from_keeps_the_engine_order():
    legal = [m.uci() for m in chess.Board().legal_moves]
    reference = reference_from(fake_analysis(chess.STARTING_FEN), legal)
    assert reference.ranked == tuple(legal)
    assert reference.best == legal[0]
    assert reference.top3 == tuple(legal[:3])


def test_reference_from_needs_every_legal_move():
    legal = ["e2e4", "d2d4"]
    with pytest.raises(LabelError, match="missing"):
        reference_from(Analysis((Line(Cp(10), ("e2e4",)), Line(Cp(0), ()))), legal)
    with pytest.raises(LabelError, match="cover 3"):
        reference_from(
            Analysis(
                (
                    Line(Cp(10), ("e2e4",)),
                    Line(Cp(5), ("d2d4",)),
                    Line(Cp(0), ("g1f3",)),
                )
            ),
            legal,
        )
    # a repeated first move keeps its first, better line
    repeated = Analysis(
        (Line(Cp(10), ("e2e4",)), Line(Cp(-5), ("e2e4", "e7e5")), Line(Cp(0), ("d2d4",)))
    )
    assert reference_from(repeated, legal).evals == {"e2e4": Cp(10), "d2d4": Cp(0)}


def test_is_tactic():
    # 1. e4 d5: exd5 is a capture
    board = chess.Board("rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2")
    assert is_tactic(board, Reference({"e4d5": Cp(50), "g1f3": Cp(0)}))
    # a check
    check = chess.Board("4k3/8/8/8/8/8/8/R3K3 w - - 0 1")
    assert is_tactic(check, Reference({"a1a8": Cp(900), "a1a2": Cp(890)}))
    # quiet, but far ahead of the second best; Black to move, so Black's side counts
    quiet = chess.Board(AFTER_E4)
    assert is_tactic(quiet, Reference({"e7e5": Cp(-200), "d7d5": Cp(0)}))
    assert not is_tactic(quiet, Reference({"e7e5": Cp(0), "d7d5": Cp(100)}))
    assert not is_tactic(quiet, Reference({"e7e5": Cp(0)}))


def position() -> Position:
    game = Game(
        id="abcdefgh",
        month="2018-06",
        white_elo=1500,
        black_elo=2450,
        time_control="600+5",
        time_class="rapid",
        moves=("e2e4", "e7e5", "g1f3"),
    )
    return Position(game, 1, AFTER_E4, ("e7e5", "d7d5"), "2400+", "opening")


def row() -> Row:
    return row_of(Sampled(position(), "dev"), Reference({"e7e5": Cp(-20), "d7d5": Cp(10)}))


def test_row_of_records_the_game():
    r = row()
    assert r.id == "abcdefgh-001"
    assert r.start_fen == chess.STARTING_FEN
    assert r.moves == ("e2e4",)
    assert r.board.fen() == AFTER_E4
    assert r.metadata == {
        "game_url": "https://lichess.org/abcdefgh",
        "month": "2018-06",
        "white_elo": 1500,
        "black_elo": 2450,
        "rating": 2450,
        "band": "2400+",
        "time_control": "600+5",
        "time_class": "rapid",
        "ply": 1,
        "phase": "opening",
        "legal_count": 2,
        "tactic": False,
        "played_move": "e7e5",
    }


def test_row_json_round_trip_and_example():
    r = row()
    assert Row.from_json(r.json()) == r
    example = r.example()
    assert example["id"] == str(uuid.UUID(example["id"]))
    assert example["id"] == row().example_id
    assert example["inputs"] == {
        "start_fen": chess.STARTING_FEN,
        "moves": ["e2e4"],
        "legal": ["e7e5", "d7d5"],
    }
    assert example["metadata"]["row_id"] == "abcdefgh-001"
    assert example["split"] == "dev"
    with pytest.raises(ValueError, match="unknown split"):
        Row.from_json({**r.json(), "split": "test"})
