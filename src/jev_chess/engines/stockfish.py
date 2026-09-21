"""Stockfish in two roles: Oracle grades positions, Opponent plays them.

Oracle settings are pinned for reproducibility: one thread, fixed hash, and a depth limit
rather than a time limit. Depth-limited search returns the same result regardless of CPU
load; time-limited search does not.
"""

from dataclasses import dataclass
from types import TracebackType
from typing import Self

import chess
import chess.engine

from jev_chess.engines.paths import resolve_binary
from jev_chess.engines.protocol import BackendOpener, UciBackend, popen_uci

UCI_ELO_MIN = 1320
UCI_ELO_MAX = 3190


@dataclass(frozen=True, slots=True)
class OracleConfig:
    depth: int = 18
    multipv: int = 3
    hash_mb: int = 256
    threads: int = 1


@dataclass(frozen=True, slots=True)
class RankedMove:
    """One principal variation, scored from the side to move's point of view."""

    uci: str
    cp: int | None
    mate: int | None

    @property
    def score_cp(self) -> int:
        """Centipawns with mates mapped far outside the normal range, for sorting and deltas."""
        if self.mate is not None:
            return 100_000 - abs(self.mate) if self.mate > 0 else -100_000 + abs(self.mate)
        assert self.cp is not None
        return self.cp


@dataclass(frozen=True, slots=True)
class Evaluation:
    ranked: tuple[RankedMove, ...]

    @property
    def best(self) -> RankedMove:
        return self.ranked[0]

    def cp_loss(self, uci: str) -> int | None:
        """How much worse `uci` is than the best move, if it appears in the ranking."""
        for move in self.ranked:
            if move.uci == uci:
                return max(0, self.best.score_cp - move.score_cp)
        return None


def _ranked_from_info(info: chess.engine.InfoDict, pov: chess.Color) -> RankedMove:
    score = info["score"].pov(pov)
    pv = info.get("pv") or []
    assert pv, "analysis without a principal variation"
    return RankedMove(uci=pv[0].uci(), cp=score.score(), mate=score.mate())


class Oracle:
    """Full-strength Stockfish used only to grade moves."""

    def __init__(self, backend: UciBackend, config: OracleConfig | None = None) -> None:
        self._backend = backend
        self._config = config = config or OracleConfig()
        backend.configure({"Threads": config.threads, "Hash": config.hash_mb})

    @classmethod
    def open(
        cls,
        path: str | None = None,
        config: OracleConfig | None = None,
        opener: BackendOpener = popen_uci,
    ) -> Self:
        return cls(opener(resolve_binary("stockfish", path)), config)

    def evaluate(self, board: chess.Board, multipv: int | None = None) -> Evaluation:
        infos = self._backend.analyse(
            board,
            chess.engine.Limit(depth=self._config.depth),
            multipv=multipv or self._config.multipv,
        )
        ranked = tuple(_ranked_from_info(info, board.turn) for info in infos)
        return Evaluation(ranked=tuple(sorted(ranked, key=lambda m: -m.score_cp)))

    def close(self) -> None:
        self._backend.quit()

    def __enter__(self) -> Self:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        self.close()


@dataclass(frozen=True, slots=True)
class EloLimit:
    elo: int

    def __post_init__(self) -> None:
        if not UCI_ELO_MIN <= self.elo <= UCI_ELO_MAX:
            msg = f"UCI_Elo must be within {UCI_ELO_MIN}..{UCI_ELO_MAX}, got {self.elo}"
            raise ValueError(msg)

    def options(self) -> dict[str, chess.engine.ConfigValue]:
        return {"UCI_LimitStrength": True, "UCI_Elo": self.elo}


@dataclass(frozen=True, slots=True)
class SkillLimit:
    level: int

    def __post_init__(self) -> None:
        if not 0 <= self.level <= 20:
            msg = f"Skill Level must be within 0..20, got {self.level}"
            raise ValueError(msg)

    def options(self) -> dict[str, chess.engine.ConfigValue]:
        return {"Skill Level": self.level}


type StrengthLimit = EloLimit | SkillLimit


class StockfishOpponent:
    """Strength-capped Stockfish that plays moves."""

    def __init__(
        self, backend: UciBackend, strength: StrengthLimit, move_time_s: float = 0.3
    ) -> None:
        self._backend = backend
        self._limit = chess.engine.Limit(time=move_time_s)
        self.strength = strength
        backend.configure({"Threads": 1, **strength.options()})

    @classmethod
    def open(
        cls,
        strength: StrengthLimit,
        path: str | None = None,
        move_time_s: float = 0.3,
        opener: BackendOpener = popen_uci,
    ) -> Self:
        return cls(opener(resolve_binary("stockfish", path)), strength, move_time_s)

    def play(self, board: chess.Board) -> chess.Move:
        result = self._backend.play(board, self._limit)
        assert result.move is not None, "engine returned no move"
        return result.move

    def close(self) -> None:
        self._backend.quit()

    def __enter__(self) -> Self:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        self.close()
