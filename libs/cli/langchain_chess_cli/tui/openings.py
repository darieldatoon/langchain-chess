"""Opening names from Lichess's CC0 chess-openings, by position, so transpositions are named.

`openings.json` links to the table `scripts/openings.py` writes for the web app: both apps read
the same file. Do not copy it here; the wheel build follows the link.
"""

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from functools import cache
from importlib.resources import files

import chess

type Table = Mapping[str, Sequence[str]]
"""Position keys to `[eco, name]`."""


@dataclass(frozen=True, slots=True)
class Opening:
    eco: str
    name: str
    reached: int
    """The position it was reached at: 0 is the root."""

    @property
    def title(self) -> str:
        """E.g. "B90 · Sicilian Defense: Najdorf Variation"."""
        return f"{self.eco} · {self.name}"


@cache
def table() -> Table:
    text = files("langchain_chess_cli.tui").joinpath("openings.json").read_text()
    return json.loads(text)["positions"]


def position_key(fen: str) -> str:
    """`positionKey` in packages/chess-ui/src/openings.ts and scripts/openings.py agree."""
    return chess.Board(fen).epd(en_passant="legal")


def opening_at(fens: Sequence[str], index: int, openings: Table) -> Opening | None:
    """The latest named position at or before `index`: it holds after the game leaves the book."""
    for i in range(min(index, len(fens) - 1), -1, -1):
        if (hit := openings.get(position_key(fens[i]))) is not None:
            return Opening(hit[0], hit[1], i)
    return None
