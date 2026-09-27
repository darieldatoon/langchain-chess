"""The TUI's game clock. Pure: the app passes in the time.

The client keeps the clock, as a UCI GUI does: each run carries it, and the agent records its
own time left on the ply it commits, which the clock then adopts.
"""

import math
import re
from collections.abc import Mapping
from dataclasses import dataclass, replace
from typing import Any, Literal

import chess

from langchain_chess import ClockInput, TimeControl
from langchain_chess_cli.tui.view import board_of

type Side = Literal["white", "black"]

_CONTROL = re.compile(r"^(\d+(?:\.\d+)?)\+(\d+)$")


def parse_time_control(text: str) -> TimeControl:
    """`15+10`: minutes of base, seconds of increment."""
    match = _CONTROL.match(text.strip())
    if match is None or (base_ms := round(float(match[1]) * 60_000)) <= 0:
        msg = f"{text!r} is not a time control such as 15+10 (minutes + seconds)"
        raise ValueError(msg)
    return {"base_ms": base_ms, "increment_ms": int(match[2]) * 1000}


def control_text(control: TimeControl) -> str:
    minutes = control["base_ms"] / 60_000
    return f"{minutes:g}+{control['increment_ms'] // 1000}"


@dataclass(frozen=True, slots=True)
class Clock:
    control: TimeControl
    white_ms: float
    black_ms: float
    running: Side | None = None
    since: float = 0.0
    """When `running` started, in the app's seconds."""


def new_clock(control: TimeControl) -> Clock:
    """Stopped: it starts with the game's first run."""
    return Clock(control, control["base_ms"], control["base_ms"])


def left(clock: Clock, side: Side, now: float) -> float:
    stored = clock.white_ms if side == "white" else clock.black_ms
    return stored - ((now - clock.since) * 1000 if clock.running == side else 0.0)


def _set(clock: Clock, side: Side, ms: float) -> Clock:
    return replace(clock, white_ms=ms) if side == "white" else replace(clock, black_ms=ms)


def stop(clock: Clock, now: float) -> Clock:
    if clock.running is None:
        return clock
    return replace(_set(clock, clock.running, left(clock, clock.running, now)), running=None)


def start(clock: Clock, side: Side, now: float) -> Clock:
    return replace(stop(clock, now), running=side, since=now)


def moved(clock: Clock, side: Side, now: float) -> Clock:
    """Stopped, with `side`'s increment added for the move it just made."""
    stopped = stop(clock, now)
    return _set(stopped, side, left(stopped, side, now) + clock.control["increment_ms"])


def flagged(clock: Clock, now: float) -> Side | None:
    running = clock.running
    return running if running is not None and left(clock, running, now) <= 0 else None


def sent(clock: Clock, now: float) -> ClockInput:
    """What a run carries: a running side is charged up to now, and whole milliseconds are
    rounded up, so time left never reads as zero."""
    return {
        "control": clock.control,
        "white_ms": math.ceil(left(clock, "white", now)),
        "black_ms": math.ceil(left(clock, "black", now)),
    }


def flag_input(clock: Clock, side: Side, now: float) -> dict[str, Any]:
    return {"clock": sent(_set(stop(clock, now), side, 0), now), "flag": side}


def settled(
    before: Clock | None, during: Clock, values: Mapping[str, Any], *, human: Side, now: float
) -> Clock:
    """The clock once a run is over. `before` is the clock as the human's move was sent.

    A rejected move gives the human back their clock as if they hadn't moved.
    """
    board = board_of(values)
    to_move: Side = "white" if board.turn == chess.WHITE else "black"
    if before is not None and values.get("error") is not None and to_move == human:
        return before
    turns = values.get("turns") or []
    clock = stop(during, now)
    agent: Side = "black" if human == "white" else "white"
    plies = values.get("plies") or []
    if plies and plies[-1]["side"] == agent and plies[-1].get("clock_ms") is not None:
        clock = _set(clock, agent, plies[-1]["clock_ms"])
    if values.get("outcome") is not None or (turns and turns[-1]["status"] == "pending"):
        return clock
    return start(clock, human, now) if to_move == human else clock


def clock_text(ms: float) -> str:
    """m:ss, with tenths under ten seconds; never below zero."""
    ms = max(ms, 0.0)
    if ms < 10_000:
        return f"0:{ms / 1000:04.1f}"
    seconds = int(ms // 1000)
    return f"{seconds // 60}:{seconds % 60:02d}"
