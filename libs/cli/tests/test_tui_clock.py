import pytest

from langchain_chess_cli.tui.clock import (
    clock_text,
    control_text,
    flag_input,
    flagged,
    left,
    moved,
    new_clock,
    parse_time_control,
    sent,
    settled,
    start,
    stop,
)

CONTROL = {"base_ms": 60_000, "increment_ms": 2_000}


def values(moves=(), *, turns=(), plies=(), error=None, outcome=None):
    return {
        "moves": list(moves),
        "turns": list(turns),
        "plies": list(plies),
        "error": error,
        "outcome": outcome,
    }


def test_parse_and_show_a_time_control():
    assert parse_time_control(" 15+10 ") == {"base_ms": 900_000, "increment_ms": 10_000}
    assert parse_time_control("0.5+0") == {"base_ms": 30_000, "increment_ms": 0}
    assert control_text(parse_time_control("0.5+3")) == "0.5+3"
    for bad in ("15", "0+5", "a+b", "15+1.5"):
        with pytest.raises(ValueError, match="not a time control"):
            parse_time_control(bad)


def test_the_running_side_is_charged_and_the_mover_gets_its_increment():
    clock = start(new_clock(CONTROL), "white", now=10.0)
    assert left(clock, "white", 12.5) == 57_500
    assert left(clock, "black", 12.5) == 60_000
    after = moved(clock, "white", 12.5)
    assert (after.white_ms, after.running) == (59_500, None)
    assert stop(after, 99.0) is after
    assert sent(start(after, "black", 13.0), 13.4) == {
        "control": CONTROL,
        "white_ms": 59_500,
        "black_ms": 59_600,
    }


def test_sent_time_is_rounded_up():
    clock = start(new_clock(CONTROL), "black", now=0.0)
    assert sent(clock, 59.9996)["black_ms"] == 1


def test_a_flag_falls_at_zero():
    clock = start(new_clock(CONTROL), "black", now=0.0)
    assert flagged(clock, 59.9) is None
    assert flagged(clock, 60.0) == "black"
    assert flagged(new_clock(CONTROL), 1e9) is None
    assert flag_input(clock, "black", 61.0) == {
        "clock": {"control": CONTROL, "white_ms": 60_000, "black_ms": 0},
        "flag": "black",
    }


def test_settling_adopts_the_agents_recorded_time_and_starts_the_human():
    during = start(new_clock(CONTROL), "black", now=0.0)
    ply = {"side": "black", "clock_ms": 61_000}
    clock = settled(None, during, values(["e2e4", "e7e5"], plies=[ply]), human="white", now=3.0)
    assert (clock.black_ms, clock.running, clock.since) == (61_000, "white", 3.0)


def test_settling_pauses_a_failed_turn_and_a_finished_game():
    during = start(new_clock(CONTROL), "black", now=0.0)
    pending = values(["e2e4"], turns=[{"status": "pending"}])
    clock = settled(None, during, pending, human="white", now=5.0)
    assert (clock.black_ms, clock.running) == (55_000, None)
    over = values(["e2e4"], outcome={"kind": "timeout", "winner": "white"})
    assert settled(None, during, over, human="white", now=5.0).running is None
    # A noop on the agent's move leaves the clock stopped.
    assert settled(None, during, values(["e2e4"]), human="white", now=5.0).running is None


def test_a_rejected_move_gives_the_human_their_clock_back():
    before = start(new_clock(CONTROL), "white", now=0.0)
    during = start(moved(before, "white", 2.0), "black", now=2.0)
    assert settled(before, during, values(error="nope"), human="white", now=3.0) is before
    # Only the human's own move is given back; a flag answered with an error is settled.
    assert settled(None, during, values(error="nope"), human="white", now=3.0).running == "white"


def test_clock_text():
    assert clock_text(754_000) == "12:34"
    assert clock_text(9_950) == "0:09.9"
    assert clock_text(-5) == "0:00.0"
