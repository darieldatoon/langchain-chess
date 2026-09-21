"""Interfaces the engine adapters depend on, so tests can inject fakes.

`UciBackend` is the slice of chess.engine.SimpleEngine we use. `MovePlayer` is what the
game runner needs from anything that plays moves: engines now, policies later.
"""

from collections.abc import Callable, Mapping
from typing import Protocol

import chess
import chess.engine


class UciBackend(Protocol):
    def configure(self, options: Mapping[str, chess.engine.ConfigValue]) -> None: ...

    def analyse(
        self, board: chess.Board, limit: chess.engine.Limit, *, multipv: int
    ) -> list[chess.engine.InfoDict]: ...

    def play(self, board: chess.Board, limit: chess.engine.Limit) -> chess.engine.PlayResult: ...

    def quit(self) -> None: ...


class MovePlayer(Protocol):
    def play(self, board: chess.Board) -> chess.Move: ...


type BackendOpener = Callable[[str], UciBackend]


def popen_uci(path: str) -> UciBackend:
    """Spawn a real UCI engine. The only line in this package that starts a process."""
    return chess.engine.SimpleEngine.popen_uci(path)
