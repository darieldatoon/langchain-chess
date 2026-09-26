"""Reading a move out of a model reply. Pure."""

import re

import chess
from langchain_core.messages import BaseMessage

EMPTY_REPLY = "[no text in reply]"
"""Stored in place of an empty reply: Anthropic rejects a replayed assistant turn with no text."""

_MOVE_MARKER = re.compile(r"MOVE:", re.IGNORECASE)
_MOVE_TOKEN = re.compile(
    r"\b(O-O(?:-O)?|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=?[QRBN])?|[a-h][1-8][a-h][1-8][qrbn]?)[+#]?\b"
)


def text_of(message: BaseMessage) -> str:
    """The message's text, joining text blocks: gateway replies are lists of blocks."""
    content = message.content
    if isinstance(content, str):
        return content
    parts: list[str] = []
    for block in content:
        if isinstance(block, str):
            parts.append(block)
        elif isinstance(block, dict) and block.get("type") == "text":
            parts.append(str(block.get("text", "")))
    return "\n".join(parts)


def _normalise(token: str) -> str:
    token = token.strip().strip(".,;:!?)\"'").replace("0-0-0", "O-O-O").replace("0-0", "O-O")
    return token.replace("o-o-o", "O-O-O").replace("o-o", "O-O")


def parse_move(board: chess.Board, reply: str) -> tuple[chess.Move | None, str | None]:
    """The legal move named in the reply, or the reason none was found.

    The last `MOVE:` marker wins, read to the end of its line; without one, the last move-like
    token. SAN first, then UCI.
    """
    if markers := list(_MOVE_MARKER.finditer(reply)):
        # Only the final marker's contents, to the end of its line: an empty or unreadable one
        # is rejected, not skipped in favour of an earlier marker.
        line = reply[markers[-1].end() :].partition("\n")[0]
        words = line.replace("*", " ").replace("`", " ").split()
        if not words:
            return None, "the last `MOVE:` line names no move; end with `MOVE: <move>`"
        token = _normalise(words[0])
    elif found := _MOVE_TOKEN.findall(reply):
        token = _normalise(found[-1])
    else:
        return None, "no move found; end your reply with a line `MOVE: <move>`"
    for parse in (board.parse_san, board.parse_uci):
        try:
            move = parse(token)
        except ValueError:
            continue
        if move in board.legal_moves:
            return move, None
    return None, f"`{token}` is not a legal move in this position"
