"""Domain types for the pure core. Frozen, constructed only from python-chess boards."""

from dataclasses import dataclass
from typing import Literal

type Side = Literal["white", "black"]
type PieceName = Literal["pawn", "knight", "bishop", "rook", "queen", "king"]
type CastleSide = Literal["kingside", "queenside"]
type DescriptionStyle = Literal["terse", "rich"]

PIECE_VALUES: dict[PieceName, int] = {
    "pawn": 1,
    "knight": 3,
    "bishop": 3,
    "rook": 5,
    "queen": 9,
    "king": 0,
}


@dataclass(frozen=True, slots=True)
class Position:
    """What a model is allowed to see about the current position.

    `legal_moves` is sorted so option keys are stable across runs.
    """

    fen: str
    pgn: str
    legal_moves: tuple[str, ...]
    side: Side


@dataclass(frozen=True, slots=True)
class MoveFacts:
    """Board-verified facts about one legal move. Computed by code, never by a model."""

    uci: str
    san: str
    piece: PieceName
    from_square: str
    to_square: str
    captured: PieceName | None
    capture_value: int
    gives_check: bool
    is_mate: bool
    castle: CastleSide | None
    promotion: PieceName | None
    is_en_passant: bool
    attackers_after: int
    defenders_after: int
    see_gain: int

    @property
    def lands_on_attacked_square(self) -> bool:
        return self.attackers_after > 0

    @property
    def hangs_material(self) -> bool:
        return self.see_gain < 0


@dataclass(frozen=True, slots=True)
class MaterialBalance:
    """Material from White's point of view, in pawn units."""

    white: int
    black: int

    @property
    def diff(self) -> int:
        return self.white - self.black
