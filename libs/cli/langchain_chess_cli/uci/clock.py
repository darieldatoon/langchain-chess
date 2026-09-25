"""Search deadlines from `go` parameters. Pure."""

from langchain_chess_cli.uci.protocol import Go

SAFETY_MS = 150
"""Left for settling the search and printing `bestmove` before the GUI's flag falls."""
MIN_MS = 50
MOVES_LEFT = 30


def deadline_ms(go: Go, *, white_to_move: bool) -> float | None:
    """How long to search, or None for no deadline (`infinite`, `ponder`, depth-only)."""
    if go.infinite or go.ponder:
        return None
    if go.movetime is not None:
        return float(max(MIN_MS, go.movetime - SAFETY_MS))
    remaining = go.wtime if white_to_move else go.btime
    if remaining is None:
        return None
    increment = go.winc if white_to_move else go.binc
    budget = min(remaining / (go.movestogo or MOVES_LEFT) + increment, remaining)
    return float(max(MIN_MS, budget - SAFETY_MS))
