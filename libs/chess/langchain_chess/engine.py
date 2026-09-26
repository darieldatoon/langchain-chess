"""UCI engine settings and a pool of engine processes, on python-chess's `chess.engine`."""

import asyncio
import contextlib
import hashlib
import json
from collections.abc import Sequence
from dataclasses import dataclass, field
from types import TracebackType
from typing import Literal, Self

import chess
import chess.engine

from langchain_chess.grading import Analysis, Cp, Eval, Line, Mate
from langchain_chess.state import JSONValue

type SearchKind = Literal["depth", "nodes", "movetime"]


@dataclass(frozen=True, slots=True)
class SearchLimit:
    kind: SearchKind
    value: int
    """Plies, nodes, or milliseconds."""

    def __post_init__(self) -> None:
        if self.value < 1:
            msg = f"{self.kind} must be at least 1"
            raise ValueError(msg)

    def to_engine(self) -> chess.engine.Limit:
        if self.kind == "movetime":
            return chess.engine.Limit(time=self.value / 1000)
        return chess.engine.Limit(**{self.kind: self.value})


@dataclass(frozen=True, slots=True)
class EngineConfig:
    path: str = "stockfish"
    limit: SearchLimit = field(default_factory=lambda: SearchLimit("depth", 16))
    multipv: int = 1
    threads: int = 1
    """Per engine. More than one makes the search nondeterministic."""
    hash_mb: int = 256

    def __post_init__(self) -> None:
        for name in ("multipv", "threads", "hash_mb"):
            if getattr(self, name) < 1:
                msg = f"{name} must be at least 1"
                raise ValueError(msg)

    def settings(self) -> dict[str, JSONValue]:
        """What shapes the grades. Not the path: it differs between machines."""
        return {
            self.limit.kind: self.limit.value,
            "multipv": self.multipv,
            "threads": self.threads,
            "hash_mb": self.hash_mb,
        }


@dataclass(frozen=True, slots=True)
class Grader:
    """The engine (its UCI `id name`) and settings behind a set of grades."""

    engine: str
    settings: dict[str, JSONValue]

    @property
    def fingerprint(self) -> str:
        blob = json.dumps({"engine": self.engine, **self.settings}, sort_keys=True)
        return hashlib.sha256(blob.encode()).hexdigest()[:16]


def eval_from(score: chess.engine.PovScore) -> Eval:
    white = score.white()
    mate = white.mate()
    if mate is None:
        return Cp(white.score(mate_score=0) or 0)
    return Mate(abs(mate), "white" if mate > 0 else "black")


def analysis_from(infos: Sequence[chess.engine.InfoDict]) -> Analysis:
    lines = tuple(
        Line(eval_from(info["score"]), tuple(m.uci() for m in info.get("pv", [])))
        for info in infos
        if "score" in info
    )
    if not lines:
        msg = "the engine returned no score"
        raise chess.engine.EngineError(msg)
    return Analysis(lines)


class EnginePool:
    """`workers` engine processes; each `analyse` runs on whichever engine is free, FIFO."""

    def __init__(self, config: EngineConfig, workers: int) -> None:
        if workers < 1:
            msg = "workers must be at least 1"
            raise ValueError(msg)
        self.config = config
        self.workers = workers
        self._engines: list[chess.engine.UciProtocol] = []
        self._idle: asyncio.Queue[chess.engine.UciProtocol] = asyncio.Queue()

    @property
    def grader(self) -> Grader:
        name = self._engines[0].id.get("name", self.config.path)
        return Grader(name, self.config.settings())

    async def __aenter__(self) -> Self:
        try:
            for _ in range(self.workers):
                _, engine = await chess.engine.popen_uci(self.config.path)
                self._engines.append(engine)
                await engine.configure(
                    {"Threads": self.config.threads, "Hash": self.config.hash_mb}
                )
                self._idle.put_nowait(engine)
        except BaseException:
            await self._quit()
            raise
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        await self._quit()

    async def _quit(self) -> None:
        engines, self._engines = self._engines, []
        for engine in engines:
            with contextlib.suppress(chess.engine.EngineError, chess.engine.EngineTerminatedError):
                await engine.quit()

    async def analyse(self, fen: str) -> Analysis:
        engine = await self._idle.get()
        try:
            # A fresh `game` sends ucinewgame, clearing the hash: without it a grade would depend
            # on which positions that engine happened to search before.
            infos = await engine.analyse(
                chess.Board(fen),
                self.config.limit.to_engine(),
                multipv=self.config.multipv,
                game=object(),
            )
        finally:
            self._idle.put_nowait(engine)
        return analysis_from(infos)
