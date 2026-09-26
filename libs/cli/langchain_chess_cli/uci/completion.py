"""How a finished, cancelled or failed search becomes `bestmove`. Pure.

The rows are checked in order: a committed ply, a resignation, any other game end, a rejected
position, then the fallback move (after a cancellation or an execution failure).
"""

import random
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
    seed: str


def info_lines(text: str) -> list[str]:
    """One `info string` per non-blank line: an embedded newline could forge a command."""
    return [f"info string {line}" for line in text.splitlines() if line.strip()]


def root_moves(
    start_fen: str, moves: Sequence[str], searchmoves: Sequence[str] | None
) -> list[str]:
    """Legal root moves within `searchmoves`, or none if the position doesn't replay."""
    try:
        board = chess.Board(start_fen)
        for uci in moves:
            board.push(board.parse_uci(uci))
    except ValueError:
        return []
    legal = [move.uci() for move in board.legal_moves]
    return legal if searchmoves is None else [uci for uci in legal if uci in searchmoves]


def _fallback(values: Mapping[str, Any], result: SearchResult, ours: bool) -> str:
    kept = values.get("fallback_move") if ours else None
    if kept in result.pool:
        return str(kept)
    if not result.pool:
        return NULL_MOVE
    return random.Random(result.seed).choice(result.pool)


def complete(values: Mapping[str, Any], result: SearchResult) -> list[str]:
    """The `info string` lines, then `bestmove`, for one search."""
    turns = values.get("turns") or []
    turn = turns[-1] if turns else None
    ours = turn is not None and turn["request"] == result.request
    if ours and turn["status"] == "committed":
        return [f"bestmove {values['plies'][turn['ply']]['uci']}"]
    outcome = values.get("outcome")
    if ours and turn["status"] == "terminal" and outcome is not None:
        if outcome["kind"] == "resignation":
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
    return [*lines, f"bestmove {_fallback(values, result, ours)}"]
