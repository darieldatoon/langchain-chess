"""What the TUI shows, computed from the thread's record. Pure."""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

import chess

from langchain_chess.state import Outcome, Side

type Values = Mapping[str, Any]

ROLES = (chess.QUEEN, chess.ROOK, chess.BISHOP, chess.KNIGHT, chess.PAWN)
"""Largest first, as the strips show them."""
POINTS = {chess.QUEEN: 9, chess.ROOK: 5, chess.BISHOP: 3, chess.KNIGHT: 3, chess.PAWN: 1}


def start_fen(values: Values) -> str:
    return values.get("start_fen") or chess.STARTING_FEN


def board_of(values: Values) -> chess.Board:
    board = chess.Board(start_fen(values))
    for uci in values.get("moves") or ():
        board.push_uci(uci)
    return board


def positions(values: Values) -> list[str]:
    """The start and the position after each move."""
    board = chess.Board(start_fen(values))
    fens = [board.fen()]
    for uci in values.get("moves") or ():
        board.push_uci(uci)
        fens.append(board.fen())
    return fens


def board_at(values: Values, index: int) -> chess.Board:
    """The position after `index` moves, with its history, so the board can show check."""
    board = chess.Board(start_fen(values))
    for uci in (values.get("moves") or [])[:index]:
        board.push_uci(uci)
    return board


def opposite(side: Side) -> Side:
    return "black" if side == "white" else "white"


def color_side(color: chess.Color) -> Side:
    return "white" if color == chess.WHITE else "black"


def material_diff(board: chess.Board) -> dict[Side, dict[chess.PieceType, int]]:
    """The pieces each side has beyond the other's, per role."""
    white = {role: len(board.pieces(role, chess.WHITE)) for role in ROLES}
    black = {role: len(board.pieces(role, chess.BLACK)) for role in ROLES}
    return {
        "white": {role: max(0, white[role] - black[role]) for role in ROLES},
        "black": {role: max(0, black[role] - white[role]) for role in ROLES},
    }


def material_score(board: chess.Board) -> int:
    """White's lead in points; kings don't count."""
    return sum(
        POINTS[role] * (len(board.pieces(role, chess.WHITE)) - len(board.pieces(role, chess.BLACK)))
        for role in ROLES
    )


def material_text(board: chess.Board, side: Side) -> str:
    """The pieces `side` is up and its lead, e.g. "♟♟ +2"; empty when it's not ahead in either."""
    color = chess.WHITE if side == "white" else chess.BLACK
    extra = material_diff(board)[side]
    pieces = "".join(
        chess.Piece(role, color).unicode_symbol() * extra[role] for role in ROLES if extra[role]
    )
    lead = material_score(board) * (1 if side == "white" else -1)
    return " ".join(part for part in (pieces, f"+{lead}" if lead > 0 else "") if part)


@dataclass(frozen=True, slots=True)
class Entry:
    ply: int
    san: str
    source: str


type MoveRow = tuple[int, Entry | None, Entry | None]


def entries(values: Values) -> list[Entry]:
    return [Entry(p["ply"], p["san"], p["source"]) for p in values.get("plies") or ()]


def move_rows(moves: Sequence[Entry], start: str) -> list[MoveRow]:
    """Rows numbered from the root, which may have Black to move and any fullmove number."""
    root = chess.Board(start)
    offset = 1 if root.turn == chess.BLACK else 0
    rows: dict[int, list[Any]] = {}
    for i, entry in enumerate(moves):
        slot = i + offset
        row = rows.setdefault(slot // 2, [root.fullmove_number + slot // 2, None, None])
        row[1 + slot % 2] = entry
    return [(row[0], row[1], row[2]) for _, row in sorted(rows.items())]


def score_text(outcome: Outcome) -> str:
    if outcome["kind"] == "draw":
        return "½-½"
    return "1-0" if outcome["winner"] == "white" else "0-1"


def strip_result(outcome: Outcome, side: Side) -> str:
    """One word for a side's strip once the game is over."""
    if outcome["kind"] == "draw":
        return "Draw"
    if outcome["winner"] == side:
        return "Won"
    if outcome["kind"] == "checkmate":
        return "Checkmated"
    return "Resigned" if outcome["reason"] == "resigned" else "Forfeited"


def result_headline(outcome: Outcome, human: Side) -> str:
    if outcome["kind"] == "draw":
        return "Draw"
    return "You won" if outcome["winner"] == human else "You lost"
