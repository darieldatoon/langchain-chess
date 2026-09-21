"""Compute board-verified facts for legal moves.

Everything here answers questions python-chess can settle exactly. Static exchange
evaluation walks legal captures on the destination square so pins and king safety are
respected, which a plain attacker/defender count would miss.
"""

import chess

from jev_chess.core.types import PIECE_VALUES, CastleSide, MoveFacts, PieceName

_PIECE_NAMES: dict[chess.PieceType, PieceName] = {
    chess.PAWN: "pawn",
    chess.KNIGHT: "knight",
    chess.BISHOP: "bishop",
    chess.ROOK: "rook",
    chess.QUEEN: "queen",
    chess.KING: "king",
}


def piece_name(piece_type: chess.PieceType) -> PieceName:
    return _PIECE_NAMES[piece_type]


def piece_value(piece_type: chess.PieceType) -> int:
    return PIECE_VALUES[piece_name(piece_type)]


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

    Negative means the moved piece is lost for less than it is worth. Non-captures onto
    a safe square score 0; onto an undefended attacked square score minus the piece.
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


def all_move_facts(board: chess.Board) -> tuple[MoveFacts, ...]:
    """Facts for every legal move, sorted by UCI to match Position.legal_moves."""
    moves = sorted(board.legal_moves, key=lambda m: m.uci())
    return tuple(move_facts(board, m) for m in moves)
