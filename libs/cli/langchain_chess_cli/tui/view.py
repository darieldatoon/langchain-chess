"""What the TUI shows, computed from the thread's record. Pure."""

from collections.abc import Mapping, Sequence
from typing import Any

import chess

from langchain_chess import turn_cost
from langchain_chess.rules import result_text
from langchain_chess_systemone.settings import ChessContext

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
            verb = "played" if meta["status"] == "played" else "suggested"
            lines.append(f"System 1 {verb}; its top moves:")
            for move in meta.get("top") or meta["shortlist"]:
                marker = "▸" if move["uci"] == ply["uci"] else " "
                lines.append(f" {marker}{_san(board, move['uci'])} {move['probability']:.0%}")
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


def describe_settings(settings: ChessContext) -> str:
    if settings.policy == "systemone":
        return f"System 1 alone ({settings.systemone_model})"
    effort = settings.reasoning_effort
    llm = settings.model if effort is None else f"{settings.model} ({effort})"
    if settings.policy == "llm":
        return llm
    return f"{settings.systemone_model} + {llm}"
