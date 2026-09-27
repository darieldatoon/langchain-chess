"""What the model reads: the system prompt, the position block, deltas and the model view. Pure.

Change the wording only deliberately, with rendered-prompt tests.
"""

import copy
from collections.abc import Callable, Sequence
from dataclasses import dataclass

import chess
from langchain_core.messages import AIMessage, AnyMessage, HumanMessage

from langchain_chess.contract import PositionView
from langchain_chess.position import ascii_board, movetext, san_list
from langchain_chess.rules import root_board, side
from langchain_chess.settings import ListedMoves
from langchain_chess.state import TurnRecord

SYSTEM_PROMPT = (
    "You are a strong chess player. You will be shown a game in progress and asked for your "
    "next move. Think as deeply as you need, then end your reply with exactly one line of the "
    "form `MOVE: <move>` where <move> is in standard algebraic notation (for example "
    "`MOVE: Nf3`, `MOVE: exd5`, `MOVE: O-O`, `MOVE: e8=Q`). Play only legal moves."
)

_REASONING_BLOCKS = frozenset({"reasoning", "thinking", "redacted_thinking"})


@dataclass(frozen=True, slots=True)
class PositionSection:
    """A renderer's part of a turn's message, in two places around the side to move."""

    position: str = ""
    """After the moves so far: the position itself."""
    moves: str = ""
    """After the side to move and check: move lists."""


type PositionRenderer = Callable[[PositionView], str | PositionSection]
"""The position section of a turn's message, from the turn's view; a string is the position
part. Pure. The core adds what every turn must say: the moves so far, a custom starting FEN, the
side to move, check, the permitted moves on a restricted turn, and the request for
`MOVE: <move>`."""


def position_renderer(
    *, show_fen: bool = True, show_board: bool = True, move_list: ListedMoves = "both"
) -> PositionRenderer:
    """The bundled renderer, shaped by the display settings."""

    def render(view: PositionView) -> PositionSection:
        board = view.board()
        position: list[str] = []
        if show_fen:
            position.append(f"FEN: {board.fen()}")
        if show_board:
            position += [
                "Board (ranks 8 to 1, uppercase is White):",
                f"```\n{ascii_board(board)}\n```",
            ]
        lines: list[str] = []
        if view.candidates and move_list in ("both", "candidates"):
            lines.append(
                "Suggested candidates: "
                + ", ".join(san_list(board, view.candidates))
                + ". These are suggested candidates; you may play any allowed move."
            )
        if not view.restricted and move_list in ("both", "legal"):
            lines.append("Legal moves: " + ", ".join(san_list(board, view.allowed)))
        return PositionSection("\n".join(position), "\n".join(lines))

    return render


def render_position(view: PositionView, sans: Sequence[str], render: PositionRenderer) -> str:
    """The trailing human message appended to every move request. Never stored.

    `view.candidates` must already be narrowed to the allowed moves.
    """
    board = view.board()
    lines = [f"Moves so far: {movetext(view.start_fen, sans) or '(none, this is the first move)'}"]
    root = root_board(view.start_fen).fen()
    if root != chess.STARTING_FEN:
        lines.append(f"Starting position (FEN): {root}")
    rendered = render(view)
    section = rendered if isinstance(rendered, PositionSection) else PositionSection(rendered)
    if position := section.position.strip():
        lines.append(position)
    lines.append(f"{side(board.turn).capitalize()} to move.")
    if board.is_check():
        lines.append("You are in check.")
    if moves := section.moves.strip():
        lines.append(moves)
    if view.restricted:
        lines.append(
            "Only these moves are permitted: " + ", ".join(san_list(board, view.allowed)) + "."
        )
    lines.append("Reply with your analysis, then the final line `MOVE: <move>`.")
    return "\n".join(lines)


def delta_text(
    start_fen: str, sans: Sequence[str], first: int, to_move: chess.Color, *, had_moves: bool
) -> str:
    """The human message that opens a position-command turn."""
    if not had_moves:
        return f"New game. You are {side(to_move).capitalize()}."
    if first < len(sans):
        return movetext(start_fen, sans, first=first)
    return f"Your move as {side(to_move).capitalize()}."


def feedback_text(board: chess.Board, allowed: Sequence[str], reason: str, *, empty: bool) -> str:
    why = (
        "your reply had no text, so the output budget was probably spent on reasoning"
        if empty
        else f"that move was rejected: {reason}"
    )
    return (
        f"Try again, {why}. Choose from: {', '.join(san_list(board, allowed))}. "
        "Keep the reply short and end with `MOVE: <move>`."
    )


def _without_reasoning(message: AnyMessage) -> AnyMessage:
    if not isinstance(message, AIMessage) or isinstance(message.content, str):
        return message
    kept = [
        block
        for block in message.content
        if not (isinstance(block, dict) and block.get("type") in _REASONING_BLOCKS)
    ]
    return message.model_copy(update={"content": kept})


def model_view(
    messages: Sequence[AnyMessage], turns: Sequence[TurnRecord], *, memory: bool
) -> list[AnyMessage]:
    """Stored messages to what the model sees, before the trailing position message.

    Only the current turn's latest failed attempt is shown, with all of its feedback still in
    state. Earlier turns' reasoning blocks are stripped (stored messages keep them for tracing).
    Returns deep copies, so wrappers that mutate messages can't reach state.
    """
    current = turns[-1]
    rejected = current["rejected_message_ids"]
    hidden = set(rejected[:-1])
    if not memory:
        opened = current["opened_message_id"]
        start = next((i for i, m in enumerate(messages) if m.id == opened), len(messages))
        window = list(messages[start:])
    else:
        hidden |= {
            mid
            for turn in turns[:-1]
            for mid in (*turn["rejected_message_ids"], *turn["feedback_message_ids"])
        }
        window = list(messages)
    keep_reasoning = set(rejected[-1:])
    return [
        copy.deepcopy(m if m.id in keep_reasoning else _without_reasoning(m))
        for m in window
        if m.id not in hidden and isinstance(m, HumanMessage | AIMessage)
    ]
