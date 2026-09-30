"""How a finished, cancelled or failed search becomes `bestmove`. Pure.

The rows are checked in order: a committed ply, a resignation, any other game end, a rejected
position, then System 1's pick (after a cancellation or an execution failure), else a forfeit.
Never a random move: it would be worse than a loss on time.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal

import chess

from langchain_chess.rules import result_text

type RunStatus = Literal["finished", "cancelled", "failed"]

NULL_MOVE = "0000"
"""Not a standard UCI resignation but a null move; GUIs score it as a forfeit, which is intended."""


@dataclass(frozen=True, slots=True)
class SearchResult:
    request: str
    """The fingerprint of the search's position command."""
    status: RunStatus
    error: str | None
    pool: tuple[str, ...]
    """Legal moves at the root, within `searchmoves`: what a fallback may play."""


def info_lines(text: str) -> list[str]:
    """One `info string` per non-blank line: an embedded newline could forge a command."""
    return [f"info string {line}" for line in text.splitlines() if line.strip()]


def root_moves(start_fen: str, moves: Sequence[str]) -> list[str]:
    """Legal root moves, or none if the position doesn't replay."""
    try:
        board = chess.Board(start_fen)
        for uci in moves:
            board.push(board.parse_uci(uci))
    except ValueError:
        return []
    return [move.uci() for move in board.legal_moves]


def _turn(values: Mapping[str, Any], request: str) -> Mapping[str, Any] | None:
    """The latest turn, if it belongs to this search."""
    turns = values.get("turns") or []
    return turns[-1] if turns and turns[-1]["request"] == request else None


def kept_move(values: Mapping[str, Any], request: str, pool: Sequence[str]) -> str | None:
    """System 1's pick for this search, if it left one."""
    kept = values.get("fallback_move") if _turn(values, request) is not None else None
    return str(kept) if kept in pool else None


def complete(values: Mapping[str, Any], result: SearchResult) -> list[str]:
    """The `info string` lines, then `bestmove`, for one search."""
    turn = _turn(values, result.request)
    if turn is not None and turn["status"] == "committed":
        return [f"bestmove {values['plies'][turn['ply']]['uci']}"]
    outcome = values.get("outcome")
    if turn is not None and turn["status"] == "terminal" and outcome is not None:
        # UCI never sends `resign`, but the record's type allows one.
        if outcome["kind"] == "resignation" and outcome["reason"] == "illegal_moves":
            attempts = turn["illegal_attempts"]
            return [
                *info_lines(f"resigns: no legal move after {attempts} attempts"),
                f"bestmove {NULL_MOVE}",
            ]
        return [*info_lines(f"game over: {result_text(outcome)}"), f"bestmove {NULL_MOVE}"]
    invocation = values.get("invocation") or {}
    if result.status == "finished" and invocation.get("action") == "reject":
        return [*info_lines(str(values.get("error"))), f"bestmove {NULL_MOVE}"]
    lines = info_lines(f"error: {result.error}") if result.status == "failed" else []
    if (kept := kept_move(values, result.request, result.pool)) is not None:
        return [*lines, f"bestmove {kept}"]
    return [*lines, *info_lines("forfeits: no move to play"), f"bestmove {NULL_MOVE}"]
