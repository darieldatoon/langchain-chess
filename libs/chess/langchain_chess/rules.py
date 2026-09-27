"""Validated replay, endings, draw claims and chat-move parsing. Pure.

Every check replays from the root, so repetition is detected: a board rebuilt from a FEN has no
move stack and never sees a threefold.
"""

import hashlib
import json
from collections.abc import Sequence
from typing import Literal

import chess

from langchain_chess.state import Draw, DrawReason, Outcome, Side, Timeout

type DrawClaims = Literal["auto", "never"]

_AUTOMATIC_DRAWS: dict[chess.Termination, DrawReason] = {
    chess.Termination.STALEMATE: "stalemate",
    chess.Termination.INSUFFICIENT_MATERIAL: "insufficient_material",
    chess.Termination.FIVEFOLD_REPETITION: "fivefold",
    chess.Termination.SEVENTYFIVE_MOVES: "seventyfive_moves",
}


class CommandError(ValueError):
    """A command that fails validation. The message is shown to the caller."""


def side(color: chess.Color) -> Side:
    return "white" if color == chess.WHITE else "black"


def ending(board: chess.Board, draw_claims: DrawClaims) -> Outcome | None:
    """Automatic endings first; with `auto`, also draws that have actually occurred.

    Never `outcome(claim_draw=True)` or `can_claim_threefold_repetition()`: both also claim a
    draw reachable by the next move, which would adjudicate before the agent has moved.
    """
    result = board.outcome(claim_draw=False)
    if result is not None:
        if result.winner is not None:
            return {"kind": "checkmate", "winner": side(result.winner)}
        return Draw(kind="draw", reason=_AUTOMATIC_DRAWS[result.termination])
    if draw_claims == "auto":
        if board.is_repetition(3):
            return Draw(kind="draw", reason="threefold")
        if board.halfmove_clock >= 100:
            return Draw(kind="draw", reason="fifty_moves")
    return None


def flag_fell(board: chess.Board, flagged: Side) -> Outcome:
    """A loss on time, or a draw when the other side can't mate by any legal sequence.

    python-chess's check is conservative: a rare dead position scores a loss, never the reverse.
    """
    winner = chess.BLACK if flagged == "white" else chess.WHITE
    if board.has_insufficient_material(winner):
        return Draw(kind="draw", reason="timeout_vs_insufficient_material")
    return Timeout(kind="timeout", winner=side(winner))


def root_board(start_fen: str) -> chess.Board:
    try:
        board = chess.Board(start_fen)
    except ValueError as e:
        msg = f"invalid FEN {start_fen!r}: {e}"
        raise CommandError(msg) from e
    if not board.is_valid():
        msg = f"invalid position: {start_fen}"
        raise CommandError(msg)
    return board


def legal_member(board: chess.Board, uci: str) -> chess.Move:
    """The legal move `uci` names. Membership, not parse success: `0000` parses as a null move."""
    try:
        move = chess.Move.from_uci(uci)
    except ValueError as e:
        msg = f"`{uci}` is not a UCI move"
        raise CommandError(msg) from e
    if move not in board.legal_moves:
        msg = f"`{uci}` is not a legal move here"
        raise CommandError(msg)
    return move


def replay(start_fen: str, moves: Sequence[str], draw_claims: DrawClaims) -> chess.Board:
    """Replay with an ending check before every ply, so a later move can't hide an ending."""
    board = root_board(start_fen)
    for index, uci in enumerate(moves, start=1):
        if (end := ending(board, draw_claims)) is not None:
            msg = f"move {index} ({uci}) comes after the game ended ({describe_outcome(end)})"
            raise CommandError(msg)
        board.push(legal_member(board, uci))
    return board


def legal_ucis(board: chess.Board) -> list[str]:
    return [move.uci() for move in board.legal_moves]


def parse_chat(board: chess.Board, text: str) -> chess.Move | None:
    """`go` gives None; exactly one legal move (SAN or UCI) gives the move; anything else raises."""
    token = text.strip()
    if token.lower() == "go":
        return None
    for parse in (board.parse_san, board.parse_uci):
        try:
            move = parse(token)
        except ValueError:
            continue
        if move in board.legal_moves:
            return move
    msg = f"`{token}` is neither `go` nor a legal move"
    raise CommandError(msg)


def fingerprint(start_fen: str, moves: Sequence[str], restrict: Sequence[str] | None) -> str:
    blob = json.dumps([start_fen, list(moves), sorted(restrict) if restrict is not None else None])
    return "position:" + hashlib.sha256(blob.encode()).hexdigest()


def describe_outcome(outcome: Outcome) -> str:
    if outcome["kind"] == "draw":
        return f"draw by {outcome['reason'].replace('_', ' ')}"
    if outcome["kind"] == "checkmate":
        return f"checkmate, {outcome['winner']} wins"
    if outcome["kind"] == "timeout":
        return f"{outcome['winner']} wins on time"
    return f"{outcome['winner']} wins by resignation"


def score(outcome: Outcome) -> str:
    if outcome["kind"] == "draw":
        return "1/2-1/2"
    return "1-0" if outcome["winner"] == "white" else "0-1"


def result_text(outcome: Outcome) -> str:
    if outcome["kind"] == "draw":
        return f"Draw by {outcome['reason'].replace('_', ' ')}. {score(outcome)}"
    if outcome["kind"] == "checkmate":
        return f"Checkmate, {outcome['winner']} wins. {score(outcome)}"
    loser = "black" if outcome["winner"] == "white" else "white"
    if outcome["kind"] == "timeout":
        return f"{loser.capitalize()} runs out of time. {score(outcome)}"
    return f"{loser.capitalize()} resigns after repeated illegal moves. {score(outcome)}"
