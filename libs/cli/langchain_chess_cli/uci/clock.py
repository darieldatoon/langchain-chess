"""Search deadlines from `go` parameters. Pure."""

from dataclasses import dataclass

from langchain_chess_cli.uci.protocol import Go

SAFETY_MS = 150
"""Left for settling the search and printing `bestmove` before the GUI's flag falls."""
MIN_MS = 50
MOVES_LEFT = 30


@dataclass(frozen=True, slots=True)
class Deadlines:
    soft: float
    """The per-move budget: stop here only to play System 1's pick."""
    hard: float
    """The clock itself: with no pick by now, forfeit."""


def _limit(ms: float, left: float) -> float:
    return float(min(max(MIN_MS, ms), max(0, left)))


def deadlines(go: Go, *, white_to_move: bool) -> Deadlines | None:
    """Milliseconds from the start of the search, or None for no deadline (`infinite`,
    `ponder`, depth-only)."""
    if go.infinite or go.ponder:
        return None
    if go.movetime is not None:
        # No clock to save: the whole move time is the budget.
        limit = _limit(go.movetime - SAFETY_MS, go.movetime)
        return Deadlines(limit, limit)
    remaining = go.wtime if white_to_move else go.btime
    if remaining is None:
        return None
    # The increment arrives after the move, so only the budget may count on it.
    increment = go.winc if white_to_move else go.binc
    budget = min(remaining / (go.movestogo or MOVES_LEFT) + increment, remaining)
    return Deadlines(
        soft=_limit(budget - SAFETY_MS, remaining), hard=_limit(remaining - SAFETY_MS, remaining)
    )
