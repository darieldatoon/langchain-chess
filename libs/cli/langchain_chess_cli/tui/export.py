"""The game as PGN, and the Lichess link that opens it. Pure.

The headers and comments match the web app's `toPgn` (packages/chess-ui/src/pgn.ts);
python-chess writes and wraps the movetext.
"""

from collections.abc import Mapping
from datetime import datetime
from typing import Any
from urllib.parse import quote

import chess
import chess.pgn

from langchain_chess.rules import score
from langchain_chess_cli.tui.openings import Opening
from langchain_chess_cli.tui.view import start_fen

LICHESS_URL_LIMIT = 8000
"""Over this, a link is too long to open reliably."""


def pgn_date(values: Mapping[str, Any]) -> str:
    """The day of the game's first call, in UTC; unknown before any."""
    turns = values.get("turns") or []
    calls = turns[0]["calls"] if turns else []
    if not calls:
        return "????.??.??"
    return datetime.fromisoformat(calls[0]["called_at"]).strftime("%Y.%m.%d")


def to_pgn(
    values: Mapping[str, Any],
    *,
    white: str,
    black: str,
    comment: str | None,
    opening: Opening | None,
    site: str = "lcchess play",
) -> str:
    outcome = values.get("outcome")
    game = chess.pgn.Game()
    root = chess.Board(start_fen(values)).fen()
    custom = {"SetUp": "1", "FEN": root} if root != chess.STARTING_FEN else {}
    # In the web app's order; python-chess reads the board from the FEN header.
    game.headers.update(
        {
            "Event": "LangChain Chess",
            "Site": site,
            "Date": pgn_date(values),
            "Round": "-",
            "White": white,
            "Black": black,
            "Result": score(outcome) if outcome else "*",
            **custom,
            "Termination": "Normal" if outcome else "Unterminated",
            "Annotator": "LangChain Chess",
        }
    )
    named = f"{opening.eco} {opening.name}" if opening else None
    game.comment = " ".join(
        note for note in (comment, named if opening and opening.reached == 0 else None) if note
    )
    node: chess.pgn.GameNode = game
    for index, uci in enumerate(values.get("moves") or (), start=1):
        node = node.add_variation(chess.Move.from_uci(uci))
        if opening and opening.reached == index:
            node.comment = named or ""
    return game.accept(chess.pgn.StringExporter(columns=80)) + "\n"


def lichess_url(pgn: str, fen: str) -> tuple[str, bool]:
    """The analysis board with the game loaded; with True, the position only, as the game was
    too long for a link."""
    url = f"https://lichess.org/analysis/pgn/{quote(pgn, safe="-_.!~*'()")}"
    if len(url) <= LICHESS_URL_LIMIT:
        return url, False
    return f"https://lichess.org/analysis/{fen.replace(' ', '_')}", True


def pgn_file_name(thread: str) -> str:
    return f"langchain-chess-{thread}.pgn"
