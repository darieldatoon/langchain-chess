"""Validated replay, endings, draw claims and chat-move parsing. Pure.

Every check replays from the root, so repetition is detected: a board rebuilt from a FEN has no
move stack and never sees a threefold.
"""

import hashlib
import json
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Literal

import chess

from langchain_chess.state import Draw, DrawAnswer, DrawReason, Outcome, Side

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


@dataclass(frozen=True, slots=True)
class Go:
    """Asks the agent to move."""


@dataclass(frozen=True, slots=True)
class Play:
    move: chess.Move


@dataclass(frozen=True, slots=True)
class Resign:
    side: Side


@dataclass(frozen=True, slots=True)
class OfferDraw:
    side: Side


type ChatCommand = Go | Play | Resign | OfferDraw
type Control = Resign | OfferDraw

_CONTROLS: dict[str, Callable[[Side], Control]] = {"resign": Resign, "draw": OfferDraw}
_SIDES: dict[str, Side] = {"white": "white", "black": "black"}


def control_command(text: str) -> Control | None:
    """`resign <side>` or `draw <side>`, case-insensitive, single-spaced; else None.

    The side is named because the server doesn't know which side is human; it isn't
    authenticated.
    """
    words = text.strip().lower().split(" ")
    if len(words) != 2 or words[0] not in _CONTROLS:
        return None
    if words[1] not in _SIDES:
        msg = f"`{text.strip()}`: name the side, `{words[0]} white` or `{words[0]} black`"
        raise CommandError(msg)
    return _CONTROLS[words[0]](_SIDES[words[1]])


def parse_chat(board: chess.Board, text: str) -> ChatCommand:
    """`go`, exactly one legal move (SAN or UCI), `resign <side>` or `draw <side>`."""
    token = text.strip()
    if token.lower() == "go":
        return Go()
    if (control := control_command(token)) is not None:
        return control
    for parse in (board.parse_san, board.parse_uci):
        try:
            move = parse(token)
        except ValueError:
            continue
        if move in board.legal_moves:
            return Play(move)
    if (pieces := _promotions(board, token)) is not None:
        msg = f"`{token}` promotes; add the piece: {pieces}"
        raise CommandError(msg)
    msg = f"`{token}` is neither `go` nor a legal move"
    raise CommandError(msg)


def _promotions(board: chess.Board, token: str) -> str | None:
    """`token` completed with each promotion piece, in its own notation, if it names one."""
    base = token.rstrip("+#")
    # UCI first: SAN parsing also takes `e7e8=Q`, which would answer UCI in SAN.
    notations = (
        (board.parse_uci, [f"{base}{piece}" for piece in "qrbn"]),
        (board.parse_san, [f"{base}={piece}" for piece in "QRBN"]),
    )
    for parse, forms in notations:
        try:
            parse(forms[0])  # raises unless it's legal here
        except ValueError:
            continue
        quoted = [f"`{form}`" for form in forms]
        return f"{', '.join(quoted[:3])} or {quoted[3]}"
    return None


type DrawPolicy = Callable[[chess.Board, Side], DrawAnswer]
"""How the agent answers a draw offer made by a side in a position."""


def decline_all(board: chess.Board, by: Side) -> DrawAnswer:
    return "declined"


def fingerprint(start_fen: str, moves: Sequence[str], restrict: Sequence[str] | None) -> str:
    blob = json.dumps([start_fen, list(moves), sorted(restrict) if restrict is not None else None])
    return "position:" + hashlib.sha256(blob.encode()).hexdigest()


def describe_outcome(outcome: Outcome) -> str:
    if outcome["kind"] == "draw":
        return f"draw by {outcome['reason'].replace('_', ' ')}"
    if outcome["kind"] == "checkmate":
        return f"checkmate, {outcome['winner']} wins"
    if outcome["reason"] == "resigned":
        return f"{outcome['winner']} wins, {_loser(outcome['winner'])} resigned"
    return f"{outcome['winner']} wins by forfeit"


def _loser(winner: Side) -> Side:
    return "black" if winner == "white" else "white"


def score(outcome: Outcome) -> str:
    if outcome["kind"] == "draw":
        return "1/2-1/2"
    return "1-0" if outcome["winner"] == "white" else "0-1"


_DRAW_REASONS: dict[DrawReason, str] = {
    "stalemate": "stalemate",
    "insufficient_material": "insufficient material",
    "threefold": "threefold repetition",
    "fivefold": "fivefold repetition",
    "fifty_moves": "the fifty-move rule",
    "seventyfive_moves": "the seventy-five-move rule",
}


def outcome_line(outcome: Outcome) -> str:
    """The result in words; mirrors `outcomeLine` in packages/chess-ui/src/format.ts."""
    if outcome["kind"] == "draw":
        return f"Draw by {_DRAW_REASONS[outcome['reason']]}"
    winner = outcome["winner"].capitalize()
    if outcome["kind"] == "checkmate":
        return f"Checkmate · {winner} wins"
    loser = _loser(outcome["winner"]).capitalize()
    if outcome["reason"] == "resigned":
        return f"{loser} resigned · {winner} wins"
    return f"{loser} forfeited after repeated illegal moves · {winner} wins"


def result_text(outcome: Outcome) -> str:
    """`outcome_line` with the score after it."""
    return f"{outcome_line(outcome)}. {score(outcome)}"
