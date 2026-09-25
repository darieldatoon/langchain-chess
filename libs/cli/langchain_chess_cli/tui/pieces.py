"""Piece art at four sizes, picked by the square's height in rows.

The block-art designs are chess-tui's DEFAULT style (https://github.com/thomas-mauran/chess-tui),
Copyright (c) 2023 Thomas Mauran, used under the MIT License: permission is hereby granted, free
of charge, to deal in the Software without restriction, provided this notice is included.
"""

from typing import Literal

import chess

type PieceSize = Literal["small", "compact", "extended", "large"]

SMALL: dict[str, str] = {
    "K": "♔", "Q": "♕", "R": "♖", "B": "♗", "N": "♘", "P": "♙",
    "k": "♚", "q": "♛", "r": "♜", "b": "♝", "n": "♞", "p": "♟",
}  # fmt: skip

ART: dict[PieceSize, dict[chess.PieceType, str]] = {
    "compact": {
        chess.KING: "▗▂╋▂▖\n ▀█▀ \n ▀▀▀ ",
        chess.QUEEN: " ▆▄▆ \n ▗█▖ \n ▀▀▀ ",
        chess.ROOK: " ▅ ▅ \n ███ \n▝▀▀▀▘",
        chess.BISHOP: " ▆▖▆ \n ▐▙▌ \n ▀▀▀ ",
        chess.KNIGHT: " ▄▟▟▖\n ▂█▛▘\n▝▀▀▀▘",
        chess.PAWN: "  ▂  \n ▆█▆ \n ▔▔▔ ",
    },
    "extended": {
        chess.KING: " ▂╋▂ \n▜███▛\n ▜█▛ \n▝▀▀▀▘",
        chess.QUEEN: "▂ ▄ ▂\n▜▙█▟▛\n ▜█▛ \n▝▀▀▀▘",
        chess.ROOK: "▄ ▄ ▄\n█████\n ███ \n▀▀▀▀▀",
        chess.BISHOP: " ▄▁▗ \n ██▟ \n ▟█▙ \n▝▀▀▀▘",
        chess.KNIGHT: "  ▖▗ \n▗▇▟█▌\n ▟█▛ \n▝▀▀▀▘",
        chess.PAWN: "     \n ▝█▘ \n ▟█▙ \n ▔▔▔ ",
    },
    "large": {
        chess.KING: "  ▂▃╋▃▂  \n ▐█████▋ \n  ▜███▛  \n   ▟█▙   \n  ▀▀▀▀▀  ",
        chess.QUEEN: "▗  ▂  ▖\n▐▙▟█▙▟▌\n ▜███▛ \n ▗███▖ \n▝▀▀▀▀▀▘",
        chess.ROOK: "▗▄ ▃ ▄▖\n▐█▄█▄█▌\n▝▜███▛▘\n ▟███▙ \n▝▀▀▀▀▀▘",
        chess.BISHOP: "▗▅  ▖\n██▍ █\n███▍█\n▝███▘\n▀▀▀▀▀",
        chess.KNIGHT: "  ▅ ▅ \n ▟▛███▖\n▝▀▜███▊\n ▗███▛ \n ▀▀▀▀▀ ",
        chess.PAWN: "     \n ▄▇▄ \n ▜█▛ \n▄███▄\n▔▔▔▔▔",
    },
}


def piece_size(square_height: int) -> PieceSize:
    if square_height < 3:
        return "small"
    if square_height == 3:
        return "compact"
    if square_height == 4:
        return "extended"
    return "large"


def piece_lines(piece: chess.Piece, size: PieceSize) -> list[str]:
    if size == "small":
        return [SMALL[piece.symbol()]]
    return ART[size][piece.piece_type].split("\n")
