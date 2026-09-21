"""A scripted UCI backend so engine adapters are unit-testable without a subprocess."""

from collections.abc import Mapping
from dataclasses import dataclass, field

import chess
import chess.engine


@dataclass
class FakeBackend:
    scripted_infos: list[chess.engine.InfoDict] = field(default_factory=list)
    scripted_move: chess.Move | None = None
    options: dict[str, chess.engine.ConfigValue] = field(default_factory=dict)
    limits: list[chess.engine.Limit] = field(default_factory=list)
    quit_called: bool = False

    def configure(self, options: Mapping[str, chess.engine.ConfigValue]) -> None:
        self.options.update(options)

    def analyse(
        self, board: chess.Board, limit: chess.engine.Limit, *, multipv: int
    ) -> list[chess.engine.InfoDict]:
        self.limits.append(limit)
        return self.scripted_infos[:multipv]

    def play(self, board: chess.Board, limit: chess.engine.Limit) -> chess.engine.PlayResult:
        self.limits.append(limit)
        return chess.engine.PlayResult(self.scripted_move, None)

    def quit(self) -> None:
        self.quit_called = True


def info(uci: str, cp: int | None = None, mate: int | None = None) -> chess.engine.InfoDict:
    """Build an InfoDict as Stockfish would report it, from White's point of view."""
    score = chess.engine.Mate(mate) if mate is not None else chess.engine.Cp(cp or 0)
    return {"score": chess.engine.PovScore(score, chess.WHITE), "pv": [chess.Move.from_uci(uci)]}
