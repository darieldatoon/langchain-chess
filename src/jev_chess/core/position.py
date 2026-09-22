"""Snapshot a python-chess board into the model-facing Position."""

from collections.abc import Sequence

import chess

from jev_chess.core.types import MaterialBalance, Position, Side

_MATERIAL: dict[chess.PieceType, int] = {
    chess.PAWN: 1,
    chess.KNIGHT: 3,
    chess.BISHOP: 3,
    chess.ROOK: 5,
    chess.QUEEN: 9,
}


def side_of(color: chess.Color) -> Side:
    return "white" if color == chess.WHITE else "black"


def movetext(board: chess.Board) -> str:
    """SAN movetext from the game root, empty when there is no history."""
    if not board.move_stack:
        return ""
    return board.root().variation_san(board.move_stack)


def movetext_from_san(history: Sequence[str]) -> str:
    """SAN movetext for a game replayed from the start; empty for no moves.

    Boards rebuilt from a FEN carry no move stack, so callers that only have the SAN list
    (the game graph, thread state) use this instead of `movetext`.
    """
    board = chess.Board()
    moves = [board.push_san(san) for san in history]
    return chess.Board().variation_san(moves) if moves else ""


def legal_moves_uci(board: chess.Board) -> tuple[str, ...]:
    """Legal moves as UCI strings in a stable sorted order."""
    return tuple(sorted(move.uci() for move in board.legal_moves))


def snapshot(board: chess.Board) -> Position:
    return Position(
        fen=board.fen(),
        pgn=movetext(board),
        legal_moves=legal_moves_uci(board),
        side=side_of(board.turn),
    )


def material_balance(board: chess.Board) -> MaterialBalance:
    def total(color: chess.Color) -> int:
        return sum(
            value * len(board.pieces(piece_type, color)) for piece_type, value in _MATERIAL.items()
        )

    return MaterialBalance(white=total(chess.WHITE), black=total(chess.BLACK))
