"""UCI engine adapters over chess.engine: Stockfish (oracle, opponent) and Maia via lc0 (anchor)."""

from jev_chess.engines.maia import MaiaOpponent, MaiaRating, weights_path
from jev_chess.engines.paths import EngineNotFoundError, resolve_binary
from jev_chess.engines.protocol import BackendOpener, MovePlayer, UciBackend, popen_uci
from jev_chess.engines.stockfish import (
    EloLimit,
    Evaluation,
    Oracle,
    OracleConfig,
    RankedMove,
    SkillLimit,
    StockfishOpponent,
    StrengthLimit,
)

__all__ = [
    "BackendOpener",
    "EloLimit",
    "EngineNotFoundError",
    "Evaluation",
    "MaiaOpponent",
    "MaiaRating",
    "MovePlayer",
    "Oracle",
    "OracleConfig",
    "RankedMove",
    "SkillLimit",
    "StockfishOpponent",
    "StrengthLimit",
    "UciBackend",
    "popen_uci",
    "resolve_binary",
    "weights_path",
]
