"""Pure domain layer: types, position facts, move descriptions. No I/O, no clients."""

from jev_chess.core.describe import describe, describe_all
from jev_chess.core.facts import all_move_facts, move_facts, static_exchange
from jev_chess.core.position import (
    legal_moves_uci,
    material_balance,
    movetext,
    movetext_from_san,
    snapshot,
)
from jev_chess.core.types import (
    PIECE_VALUES,
    DescriptionStyle,
    MaterialBalance,
    MoveFacts,
    Position,
    Side,
)

__all__ = [
    "PIECE_VALUES",
    "DescriptionStyle",
    "MaterialBalance",
    "MoveFacts",
    "Position",
    "Side",
    "all_move_facts",
    "describe",
    "describe_all",
    "legal_moves_uci",
    "material_balance",
    "move_facts",
    "movetext",
    "movetext_from_san",
    "snapshot",
    "static_exchange",
]
