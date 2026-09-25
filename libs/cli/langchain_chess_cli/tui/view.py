"""What the TUI shows, computed from the thread's record. Pure."""

from collections.abc import Mapping, Sequence
from typing import Any

import chess

from langchain_chess import turn_cost
from langchain_chess.rules import result_text
from langchain_chess_cli.options import AgentOptions

PIECES = {
    "K": "♔", "Q": "♕", "R": "♖", "B": "♗", "N": "♘", "P": "♙",
    "k": "♚", "q": "♛", "r": "♜", "b": "♝", "n": "♞", "p": "♟",
}  # fmt: skip

SOURCES = {
    "external": "you",
    "llm": "LLM",
    "systemone": "System 1",
    "forced": "forced",
}


def board_of(values: Mapping[str, Any]) -> chess.Board:
    board = chess.Board(values.get("start_fen") or chess.STARTING_FEN)
    for uci in values.get("moves") or ():
        board.push_uci(uci)
    return board


def board_text(board: chess.Board, *, white_bottom: bool, last_move: str | None) -> str:
    """Rich markup: ranks and files labelled, the last move's squares highlighted."""
    marked: set[int] = set()
    if last_move:
        move = chess.Move.from_uci(last_move)
        marked = {move.from_square, move.to_square}
    ranks = range(7, -1, -1) if white_bottom else range(8)
    files = list(range(8)) if white_bottom else list(range(7, -1, -1))
    lines = []
    for rank in ranks:
        cells = []
        for file in files:
            square = chess.square(file, rank)
            piece = board.piece_at(square)
            glyph = PIECES[piece.symbol()] if piece else "·"
            light = (rank + file) % 2 == 1
            style = "on yellow" if square in marked else ("on grey30" if light else "on grey15")
            cells.append(f"[{style}] {glyph} [/]")
        lines.append(f"{rank + 1} " + "".join(cells))
    lines.append("  " + "".join(f" {chess.FILE_NAMES[f]} " for f in files))
    return "\n".join(lines)


def source_label(source: str) -> str:
    return SOURCES.get(source, source)


def cost_text(calls: Sequence[Mapping[str, Any]]) -> str:
    """The turn total; `—` when nothing was priced, `≥` when the estimate is incomplete."""
    cost = turn_cost(list(calls))  # ty: ignore[invalid-argument-type]
    if cost is None:
        return "—"
    return f"${cost['usd']:.4f}" if cost["complete"] else f"≥${cost['usd']:.4f}"


def _turn(values: Mapping[str, Any], turn_id: str | None) -> Mapping[str, Any] | None:
    return next((t for t in values.get("turns") or () if t["id"] == turn_id), None)


def move_list(values: Mapping[str, Any]) -> str:
    """Numbered from the root, one line per move pair, with each move's source and cost."""
    root = chess.Board(values.get("start_fen") or chess.STARTING_FEN)
    number, white = root.fullmove_number, root.turn == chess.WHITE
    lines: list[str] = []
    row = ""
    for ply in values.get("plies") or ():
        turn = _turn(values, ply["turn_id"])
        cost = f" {cost_text(turn['calls'])}" if turn is not None else ""
        label = f"{ply['san']} ({source_label(ply['source'])}{cost})"
        if white:
            row = f"{number}. {label}"
        else:
            lines.append(f"{row}  {label}" if row else f"{number}... {label}")
            row = ""
            number += 1
        white = not white
    if row:
        lines.append(row)
    return "\n".join(lines) or "No moves yet."


def _san(board: chess.Board, uci: str) -> str:
    return board.san(chess.Move.from_uci(uci))


def ply_details(values: Mapping[str, Any]) -> str:
    """The latest agent move: source, model, latency, cost and System 1's suggestions."""
    plies = [p for p in values.get("plies") or () if p["source"] != "external"]
    if not plies:
        return "The agent hasn't moved yet."
    ply = plies[-1]
    empty: dict[str, Any] = {"calls": [], "illegal_attempts": 0}
    turn = _turn(values, ply["turn_id"]) or empty
    lines = [
        f"{ply['san']} by {source_label(ply['source'])}"
        + (f" ({ply['model']})" if ply["model"] else ""),
        f"latency {ply['latency_ms'] / 1000:.1f} s, cost {cost_text(turn['calls'])}",
    ]
    if turn["illegal_attempts"]:
        lines.append(f"illegal attempts: {turn['illegal_attempts']}")
    meta = ply["meta"].get("SystemOneMiddleware")
    if meta is not None:
        board = board_of({**values, "moves": (values.get("moves") or [])[: ply["ply"]]})
        if meta["status"] == "skipped":
            lines.append(f"System 1 skipped: {meta['error']}")
        else:
            among = " among finalists" if meta["finalist_conditional"] else ""
            verb = "played" if meta["status"] == "played" else "suggested"
            signal = meta["signal"]
            gate = f"{meta['gate']} {signal:.2f} vs {meta['threshold_used']:.2f}"
            lines.append(f"System 1 {verb} ({gate}{among})")
            for move in meta["shortlist"]:
                lines.append(f"  {_san(board, move['uci'])} {move['probability']:.0%}")
    return "\n".join(lines)


def status_text(
    values: Mapping[str, Any], *, human: chess.Color, running: bool, failed: str | None
) -> str:
    outcome = values.get("outcome")
    if outcome is not None:
        return result_text(outcome)
    turns = values.get("turns") or []
    if running:
        return "The agent is thinking…"
    if turns and turns[-1]["status"] == "pending":
        reason = f" ({failed})" if failed else ""
        return f"The agent's move failed{reason}. Press ctrl+r to retry."
    board = board_of(values)
    if board.turn == human:
        return "Your move."
    if not values.get("moves"):
        return "Press ctrl+s and the agent opens."
    return "The agent's move."


def describe_options(options: AgentOptions) -> str:
    if options.policy == "systemone":
        return f"System 1 alone ({options.systemone_model})"
    if options.policy == "llm":
        return f"{options.model} ({options.reasoning_effort})"
    return f"{options.systemone_model} + {options.model} ({options.reasoning_effort})"
