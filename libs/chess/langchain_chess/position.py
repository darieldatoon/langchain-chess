"""Movetext from any root and board rendering. Pure."""

from collections.abc import Sequence

import chess


def movetext(start_fen: str, sans: Sequence[str], first: int = 0) -> str:
    """SAN movetext for `sans[first:]`, numbered from the root's fullmove number.

    A fragment that starts with Black's move is numbered `n...`, so a black-to-move root and a
    delta for the opponent's reply both read correctly.
    """
    root = chess.Board(start_fen)
    number, white = root.fullmove_number, root.turn == chess.WHITE
    parts: list[str] = []
    for index, san in enumerate(sans):
        if index >= first:
            if white:
                parts.append(f"{number}. {san}")
            elif index == first:
                parts.append(f"{number}... {san}")
            else:
                parts.append(san)
        if not white:
            number += 1
        white = not white
    return " ".join(parts)


def san_list(board: chess.Board, ucis: Sequence[str]) -> list[str]:
    return [board.san(chess.Move.from_uci(uci)) for uci in ucis]


def ascii_board(board: chess.Board) -> str:
    """Ranks 8 to 1, uppercase is White (python-chess's `str(board)`)."""
    return str(board)
