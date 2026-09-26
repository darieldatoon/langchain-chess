import chess
import pytest

from langchain_chess.grading import (
    Analysis,
    Cp,
    Line,
    Mate,
    engine_fens,
    eval_json,
    first_runs,
    game_accuracy,
    grade_game,
    judge,
    move_accuracy,
    positions,
    win_percent,
    winning_chances,
)

FOOLS_MATE = ["f2f3", "e7e5", "g2g4", "d8h4"]


def test_winning_chances_are_symmetric_and_clamped():
    assert winning_chances(Cp(0), "white") == 0
    assert winning_chances(Cp(300), "white") == pytest.approx(-winning_chances(Cp(300), "black"))
    assert winning_chances(Cp(5000), "white") == winning_chances(Cp(1000), "white")
    assert winning_chances(Mate(3, "white"), "white") == winning_chances(Cp(1000), "white")
    assert winning_chances(Mate(0, "white"), "black") == winning_chances(Cp(-1000), "white")
    assert win_percent(Cp(0), "black") == 50


@pytest.mark.parametrize(
    ("before", "after", "expected"),
    [
        (Cp(0), Cp(-40), None),
        (Cp(0), Cp(-60), "inaccuracy"),
        (Cp(0), Cp(-120), "mistake"),
        (Cp(0), Cp(-180), "blunder"),
        (Cp(-200), Cp(300), None),
    ],
)
def test_centipawn_judgements(before, after, expected):
    assert judge(before, after, "white") == expected


@pytest.mark.parametrize(
    ("before", "after", "expected"),
    [
        # Walking into a mate: how lost it already was decides.
        (Cp(-1200), Mate(4, "black"), "inaccuracy"),
        (Cp(-800), Mate(4, "black"), "mistake"),
        (Cp(0), Mate(4, "black"), "blunder"),
        # Letting a mate go: how much is left decides.
        (Mate(2, "white"), Cp(1200), "inaccuracy"),
        (Mate(2, "white"), Cp(800), "mistake"),
        (Mate(2, "white"), Cp(100), "blunder"),
        (Mate(2, "white"), Mate(5, "black"), "blunder"),
        # No judgement: a mate kept (even delayed), found, or escaped.
        (Mate(2, "white"), Mate(6, "white"), None),
        (Cp(0), Mate(3, "white"), None),
        (Mate(3, "black"), Cp(-500), None),
        (Mate(3, "black"), Mate(1, "black"), None),
    ],
)
def test_mate_judgements(before, after, expected):
    assert judge(before, after, "white") == expected


def test_judgements_are_from_the_movers_side():
    assert judge(Cp(0), Cp(180), "black") == "blunder"
    assert judge(Cp(0), Mate(4, "white"), "black") == "blunder"


def test_move_accuracy():
    assert move_accuracy(60, 60) == 100
    assert move_accuracy(40, 70) == 100
    assert move_accuracy(60, 50) == pytest.approx(64.58, abs=0.01)
    assert move_accuracy(100, 0) == 0


def test_game_accuracy_by_side():
    evals = [Cp(20), Cp(20), Cp(20), Cp(-400)]
    accuracy = game_accuracy("white", evals, [100.0, 100.0, 10.0])
    assert accuracy["black"] == 100
    assert accuracy["white"] is not None
    assert accuracy["white"] < 50


def test_game_accuracy_for_one_move_from_black():
    assert game_accuracy("black", [Cp(0), Cp(0)], [100.0]) == {"white": None, "black": 100}


def test_game_accuracy_over_a_long_game_uses_wider_windows():
    evals = [Cp(i * 10) for i in range(101)]
    accuracy = game_accuracy("white", evals, [90.0] * 100)
    assert accuracy == {"white": pytest.approx(90), "black": pytest.approx(90)}


def test_positions_settle_only_where_the_game_ended():
    mated = positions(chess.STARTING_FEN, FOOLS_MATE, {"kind": "checkmate", "winner": "black"})
    assert len(mated) == 5
    assert [p.settled for p in mated[:-1]] == [None] * 4
    assert mated[-1].settled == Mate(0, "black")

    stalemate = positions("7k/8/6K1/8/8/8/8/5Q2 w - - 0 1", ["f1f7"], None)
    assert stalemate[-1].settled == Cp(0)

    claimed = positions(chess.STARTING_FEN, ["g1f3"], {"kind": "draw", "reason": "threefold"})
    assert claimed[-1].settled == Cp(0)

    going = positions(chess.STARTING_FEN, ["e2e4"], None)
    assert going[-1].settled is None
    assert going[0].fen == chess.STARTING_FEN


def test_engine_fens_are_distinct_and_skip_settled_positions():
    a = positions(chess.STARTING_FEN, FOOLS_MATE, None)
    b = positions(chess.STARTING_FEN, ["f2f3", "e7e6"], None)
    fens = engine_fens([a, b])
    assert fens[:4] == tuple(p.fen for p in a[:4])
    assert len(fens) == 5
    assert a[-1].fen not in fens


def _line(eval, *pv):
    return Analysis((Line(eval, pv),))


def test_grade_game():
    game = positions(chess.STARTING_FEN, FOOLS_MATE, None)
    evals = [Cp(20), Cp(-120), Cp(-120), Mate(1, "black")]
    best = ["e2e4", "e7e5", "e2e4", "d8h4"]
    analyses = {p.fen: _line(e, m) for p, e, m in zip(game, evals, best, strict=False)}
    grade = grade_game(game, FOOLS_MATE, analyses)

    assert grade.evals == (*evals, Mate(0, "black"))
    assert [p.quality for p in grade.plies] == ["mistake", "best", "blunder", "best"]
    assert [p.side for p in grade.plies] == ["white", "black", "white", "black"]
    assert grade.plies[0].cp_loss == 140
    assert grade.plies[1].cp_loss == 0
    assert grade.plies[2].win_pct_loss > 30
    assert grade.plies[3].accuracy == 100
    assert grade.plies[0].best_move == "e2e4"
    assert grade.plies[0].lines == analyses[game[0].fen].lines
    assert grade.accuracy["black"] == 100
    assert grade.accuracy["white"] is not None
    assert grade.accuracy["white"] < 50


def test_grade_game_from_blacks_move_and_without_a_best_move():
    fen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"
    game = positions(fen, ["e7e5"], None)
    analyses = {game[0].fen: _line(Cp(30)), game[1].fen: _line(Cp(30), "g1f3")}
    grade = grade_game(game, ["e7e5"], analyses)
    assert grade.plies[0].side == "black"
    assert grade.plies[0].best_move is None
    assert grade.plies[0].quality == "good"
    assert grade.accuracy == {"white": None, "black": 100}


def test_first_runs():
    assert first_runs([("a", 1), ("b", 3), ("c", 3), ("d", 4)]) == ("a", "b", "b", "d")
    assert first_runs([("a", 2), ("b", 1)]) == ("a", "a")
    assert first_runs([]) == ()


def test_eval_json():
    assert eval_json(Cp(-35)) == {"cp": -35}
    assert eval_json(Mate(0, "black")) == {"mate": 0, "winner": "black"}
