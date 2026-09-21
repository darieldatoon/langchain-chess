"""Maia via lc0: a human-like opponent at a named rating.

Maia is a policy network trained to predict human moves at a rating band. It is run at
one node, meaning no search, because search makes it stronger and less human-like than
the rating it is named for.
"""

from pathlib import Path
from types import TracebackType
from typing import Literal, Self

import chess
import chess.engine

from jev_chess.engines.paths import EngineNotFoundError, resolve_binary
from jev_chess.engines.protocol import BackendOpener, UciBackend, popen_uci

type MaiaRating = Literal[1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900]


def weights_path(weights_dir: Path, rating: MaiaRating) -> Path:
    path = weights_dir / f"maia-{rating}.pb.gz"
    if not path.is_file():
        msg = f"Maia weights not found at {path}; download from CSSLab/maia-chess"
        raise EngineNotFoundError(msg)
    return path


class MaiaOpponent:
    def __init__(self, backend: UciBackend, rating: MaiaRating) -> None:
        self._backend = backend
        self.rating = rating
        self._limit = chess.engine.Limit(nodes=1)

    @classmethod
    def open(
        cls,
        rating: MaiaRating,
        weights_dir: Path,
        lc0_path: str | None = None,
        opener: BackendOpener = popen_uci,
    ) -> Self:
        weights = weights_path(weights_dir, rating)
        backend = opener(resolve_binary("lc0", lc0_path))
        backend.configure({"WeightsFile": str(weights)})
        return cls(backend, rating)

    def play(self, board: chess.Board) -> chess.Move:
        result = self._backend.play(board, self._limit)
        assert result.move is not None, "lc0 returned no move"
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
