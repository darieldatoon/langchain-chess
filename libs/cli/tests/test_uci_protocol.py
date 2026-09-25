import pytest

from langchain_chess_cli.uci.clock import MIN_MS, SAFETY_MS, deadline_ms
from langchain_chess_cli.uci.completion import SearchResult, complete, root_moves
from langchain_chess_cli.uci.protocol import (
    STARTPOS,
    Go,
    IsReady,
    PonderHit,
    Position,
    Quit,
    SetOption,
    Stop,
    Uci,
    UciNewGame,
    Unknown,
    parse,
)


@pytest.mark.parametrize(
    ("line", "command"),
    [
        ("uci", Uci()),
        ("isready", IsReady()),
        ("ucinewgame", UciNewGame()),
        ("stop", Stop()),
        ("ponderhit", PonderHit()),
        ("quit", Quit()),
        ("uci extra", Unknown("uci extra")),
        ("", Unknown("")),
        ("setoption name Reasoning Effort value high", SetOption("Reasoning Effort", "high")),
        ("setoption name Model", SetOption("Model", None)),
        ("setoption value 3", Unknown("setoption value 3")),
        ("position startpos", Position(STARTPOS, ())),
        ("position startpos moves e2e4 e7e5", Position(STARTPOS, ("e2e4", "e7e5"))),
        (
            "position fen 8/8/8/4k3/8/8/8/4K3 w - - 0 1 moves e1d1",
            Position("8/8/8/4k3/8/8/8/4K3 w - - 0 1", ("e1d1",)),
        ),
        ("position fen", Unknown("position fen")),
        ("position", Unknown("position")),
        ("go", Go()),
        ("go infinite", Go(infinite=True)),
        ("go ponder wtime 100 btime 200", Go(ponder=True, wtime=100, btime=200)),
        (
            "go wtime 1000 btime 2000 winc 10 binc 20 movestogo 5",
            Go(wtime=1000, btime=2000, winc=10, binc=20, movestogo=5),
        ),
        ("go movetime 500 searchmoves e2e4 d2d4", Go(movetime=500, searchmoves=("e2e4", "d2d4"))),
        ("go searchmoves e2e4 movetime 500", Go(movetime=500, searchmoves=("e2e4",))),
        ("go depth 5 nodes 100 movetime x", Go()),
        ("go movetime", Go()),
    ],
)
def test_parse(line, command):
    assert parse(line) == command


def test_deadlines():
    assert deadline_ms(Go(infinite=True), white_to_move=True) is None
    assert deadline_ms(Go(ponder=True, wtime=1000), white_to_move=True) is None
    assert deadline_ms(Go(), white_to_move=True) is None
    assert deadline_ms(Go(movetime=1000), white_to_move=True) == 1000 - SAFETY_MS
    assert deadline_ms(Go(movetime=10), white_to_move=True) == MIN_MS
    assert deadline_ms(Go(wtime=30000, winc=500), white_to_move=True) == 1000 + 500 - SAFETY_MS
    assert deadline_ms(Go(btime=10000, movestogo=2), white_to_move=False) == 5000 - SAFETY_MS
    assert deadline_ms(Go(wtime=100, winc=5000), white_to_move=True) == MIN_MS
    assert deadline_ms(Go(wtime=30000), white_to_move=False) is None


def test_root_moves():
    assert len(root_moves(STARTPOS, (), None)) == 20
    assert root_moves(STARTPOS, ("e2e4",), ["e7e5", "a1a2"]) == ["e7e5"]
    assert root_moves("nope", (), None) == []
    assert root_moves(STARTPOS, ("e2e5",), None) == []


def result(status="finished", pool=("e2e4", "d2d4"), error=None):
    return SearchResult(request="r", status=status, error=error, pool=pool, seed="s")


def turn(status, request="r", ply=None, attempts=0):
    return {"request": request, "status": status, "ply": ply, "illegal_attempts": attempts}


def test_completion_rows():
    committed = {"turns": [turn("committed", ply=0)], "plies": [{"uci": "e2e4"}]}
    assert complete(committed, result("cancelled")) == ["bestmove e2e4"]
    resigned = {
        "turns": [turn("terminal", attempts=4)],
        "outcome": {"kind": "resignation", "winner": "black", "reason": "illegal_moves"},
    }
    assert complete(resigned, result()) == [
        "info string resigns: no legal move after 4 attempts",
        "bestmove 0000",
    ]
    drawn = {"turns": [turn("terminal")], "outcome": {"kind": "draw", "reason": "fivefold"}}
    assert complete(drawn, result())[0] == "info string game over: Draw by fivefold. 1/2-1/2"
    rejected = {"invocation": {"action": "reject"}, "error": "bad"}
    assert complete(rejected, result()) == ["info string bad", "bestmove 0000"]
    kept = {"turns": [turn("pending")], "fallback_move": "d2d4"}
    assert complete(kept, result("cancelled")) == ["bestmove d2d4"]
    assert complete(kept, result("failed", error="boom")) == [
        "info string error: boom",
        "bestmove d2d4",
    ]
    stale = {"turns": [turn("pending", request="other")], "fallback_move": "d2d4"}
    (line,) = complete(stale, result("cancelled"))
    assert line in {"bestmove e2e4", "bestmove d2d4"}
    assert complete({}, result("cancelled", pool=())) == ["bestmove 0000"]
    outside = {"turns": [turn("pending")], "fallback_move": "g1f3"}
    assert complete(outside, result("cancelled", pool=("e2e4",))) == ["bestmove e2e4"]
