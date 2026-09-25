"""Board-verified move facts and their deterministic descriptions. Pure.

Everything here answers questions python-chess settles exactly. Static exchange evaluation walks
legal captures on the destination square, so pins and king safety are respected, which a plain
attacker/defender count would miss. Rich descriptions are the default because prior art found
description richness to be the largest single quality lever for System 1 rankers.
"""

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Literal

import chess

type PieceName = Literal["pawn", "knight", "bishop", "rook", "queen", "king"]
type CastleSide = Literal["kingside", "queenside"]
type DescriptionStyle = Literal["terse", "rich"]

PIECE_VALUES: dict[PieceName, int] = {
    "pawn": 1,
    "knight": 3,
    "bishop": 3,
    "rook": 5,
    "queen": 9,
    "king": 0,
}

_PIECE_NAMES: dict[chess.PieceType, PieceName] = {
    chess.PAWN: "pawn",
    chess.KNIGHT: "knight",
    chess.BISHOP: "bishop",
    chess.ROOK: "rook",
    chess.QUEEN: "queen",
    chess.KING: "king",
}


@dataclass(frozen=True, slots=True)
class MoveFacts:
    """Facts about one legal move. Computed by code, never by a model."""

    uci: str
    san: str
    piece: PieceName
    from_square: str
    to_square: str
    captured: PieceName | None
    capture_value: int
    gives_check: bool
    is_mate: bool
    castle: CastleSide | None
    promotion: PieceName | None
    is_en_passant: bool
    attackers_after: int
    defenders_after: int
    see_gain: int

    @property
    def lands_on_attacked_square(self) -> bool:
        return self.attackers_after > 0

    @property
    def hangs_material(self) -> bool:
        return self.see_gain < 0


@dataclass(frozen=True, slots=True)
class MaterialBalance:
    """Material in pawn units."""

    white: int
    black: int

    @property
    def diff(self) -> int:
        return self.white - self.black


def piece_name(piece_type: chess.PieceType) -> PieceName:
    return _PIECE_NAMES[piece_type]


def piece_value(piece_type: chess.PieceType) -> int:
    return PIECE_VALUES[piece_name(piece_type)]


def material_balance(board: chess.Board) -> MaterialBalance:
    def total(color: chess.Color) -> int:
        return sum(
            piece_value(piece_type) * len(board.pieces(piece_type, color))
            for piece_type in _PIECE_NAMES
        )

    return MaterialBalance(white=total(chess.WHITE), black=total(chess.BLACK))


def _captured_type(board: chess.Board, move: chess.Move) -> chess.PieceType | None:
    if board.is_en_passant(move):
        return chess.PAWN
    captured = board.piece_at(move.to_square)
    return captured.piece_type if captured else None


def _mover_value_after(board: chess.Board, move: chess.Move) -> int:
    """Value of the piece that ends up on the destination square."""
    if move.promotion:
        return piece_value(move.promotion)
    mover = board.piece_at(move.from_square)
    assert mover is not None, "move must originate from an occupied square"
    return piece_value(mover.piece_type)


def _best_recapture_gain(board: chess.Board, square: chess.Square, value_on_square: int) -> int:
    """Material the side to move can win by capturing on `square`, or 0 by declining."""
    captures = [m for m in board.legal_moves if m.to_square == square and board.is_capture(m)]
    if not captures:
        return 0
    attacker = min(captures, key=lambda m: _mover_value_after(board, m))
    attacker_value = _mover_value_after(board, attacker)
    board.push(attacker)
    reply = _best_recapture_gain(board, square, attacker_value)
    board.pop()
    return max(0, value_on_square - reply)


def static_exchange(board: chess.Board, move: chess.Move) -> int:
    """Net material for the mover after all profitable recaptures on the destination.

    Negative means the moved piece is lost for less than it is worth. Non-captures onto a safe
    square score 0; onto an undefended attacked square, minus the piece.
    """
    scratch = board.copy(stack=False)
    captured = _captured_type(scratch, move)
    gain = piece_value(captured) if captured is not None else 0
    mover_value = _mover_value_after(scratch, move)
    scratch.push(move)
    return gain - _best_recapture_gain(scratch, move.to_square, mover_value)


def _castle_side(board: chess.Board, move: chess.Move) -> CastleSide | None:
    if board.is_kingside_castling(move):
        return "kingside"
    if board.is_queenside_castling(move):
        return "queenside"
    return None


def move_facts(board: chess.Board, move: chess.Move) -> MoveFacts:
    """Facts for one legal move. The board is not mutated."""
    if move not in board.legal_moves:
        msg = f"{move.uci()} is not legal in {board.fen()}"
        raise ValueError(msg)
    mover = board.piece_at(move.from_square)
    assert mover is not None
    captured = _captured_type(board, move)
    scratch = board.copy(stack=False)
    gives_check = scratch.gives_check(move)
    san = scratch.san(move)
    scratch.push(move)
    us = not scratch.turn
    return MoveFacts(
        uci=move.uci(),
        san=san,
        piece=piece_name(mover.piece_type),
        from_square=chess.square_name(move.from_square),
        to_square=chess.square_name(move.to_square),
        captured=piece_name(captured) if captured is not None else None,
        capture_value=piece_value(captured) if captured is not None else 0,
        gives_check=gives_check,
        is_mate=scratch.is_checkmate(),
        castle=_castle_side(board, move),
        promotion=piece_name(move.promotion) if move.promotion else None,
        is_en_passant=board.is_en_passant(move),
        attackers_after=len(scratch.attackers(scratch.turn, move.to_square)),
        defenders_after=len(scratch.attackers(us, move.to_square)),
        see_gain=static_exchange(board, move),
    )


def _tactical_phrases(facts: MoveFacts) -> list[str]:
    phrases: list[str] = []
    if facts.is_mate:
        phrases.append("checkmate")
    elif facts.gives_check:
        phrases.append("gives check")
    if facts.captured is not None:
        suffix = " en passant" if facts.is_en_passant else ""
        phrases.append(f"captures {facts.captured} ({facts.capture_value}){suffix}")
    if facts.see_gain < 0:
        phrases.append(f"loses material in the exchange ({facts.see_gain})")
    elif facts.see_gain > 0:
        phrases.append(f"wins material in the exchange (+{facts.see_gain})")
    return phrases


def _safety_phrase(facts: MoveFacts) -> str:
    if facts.attackers_after == 0:
        return "square safe"
    defended = f"defended {facts.defenders_after}x" if facts.defenders_after else "undefended"
    return f"square attacked {facts.attackers_after}x, {defended}"


def _movement_phrase(facts: MoveFacts) -> str:
    if facts.castle is not None:
        return f"castles {facts.castle}, king to {facts.to_square}"
    text = f"{facts.piece} {facts.from_square} to {facts.to_square}"
    if facts.promotion is not None:
        text += f", promotes to {facts.promotion}"
    return text


def describe(facts: MoveFacts, style: DescriptionStyle = "rich") -> str:
    # Phrase order is fixed, so the same facts always produce the same string.
    if style == "terse":
        tactical = _tactical_phrases(facts)
        return f"{facts.san}: {tactical[0]}" if tactical else facts.san
    parts = [_movement_phrase(facts), *_tactical_phrases(facts), _safety_phrase(facts)]
    return f"{facts.san}: " + ", ".join(parts)


def describe_moves(
    board: chess.Board, ucis: Iterable[str], style: DescriptionStyle = "rich"
) -> dict[str, str]:
    """UCI to description, in the given order, ready to use as Choice criteria."""
    return {uci: describe(move_facts(board, chess.Move.from_uci(uci)), style) for uci in ucis}
