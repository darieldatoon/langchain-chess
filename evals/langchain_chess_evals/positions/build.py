"""Build a dataset version: sample Lichess positions, label them, write `vN.jsonl` and its
manifest. One-off, not CI: the first run downloads a month (about 6 GB)."""

import itertools
import json
from collections.abc import Callable, Iterator, Sequence
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from langchain_chess.engine import EngineConfig, EnginePool, Grader, SearchLimit
from langchain_chess_evals.positions.examples import Row, row_of
from langchain_chess_evals.positions.labels import Analyser, label
from langchain_chess_evals.positions.lichess import (
    Fetch,
    MonthFile,
    month_games,
    next_month,
    urlopen,
)
from langchain_chess_evals.positions.sampling import Filters, Quotas, Sample, counts, sample

DATASET = "langchain-chess-positions"

# Stockfish's MultiPV ceiling, above the most legal moves any position has (218): every move
# gets its own line.
ALL_MOVES_MULTIPV = 256

type Pools = Callable[[EngineConfig, int], AbstractAsyncContextManager[Analyser]]


def default_engine() -> EngineConfig:
    return EngineConfig(limit=SearchLimit("depth", 16), multipv=ALL_MOVES_MULTIPV, threads=1)


@dataclass(frozen=True, slots=True)
class BuildConfig:
    version: str
    month: str
    """The pinned month. Later months are read only for buckets it leaves short."""
    out_dir: Path
    cache_dir: Path
    seed: int = 7
    max_months: int = 3
    workers: int = 4
    quotas: Quotas = field(default_factory=Quotas)
    filters: Filters = field(default_factory=Filters)
    engine: EngineConfig = field(default_factory=default_engine)
    dataset: str = DATASET

    @property
    def rows_path(self) -> Path:
        return self.out_dir / f"{self.version}.jsonl"

    @property
    def manifest_path(self) -> Path:
        return self.out_dir / f"{self.version}.manifest.json"


class BuildError(RuntimeError):
    """Shown to the user without a traceback."""


def months_from(first: str) -> Iterator[str]:
    month = first
    while True:
        yield month
        month = next_month(month)


def manifest(
    config: BuildConfig,
    drawn: Sample,
    files: Sequence[MonthFile],
    grader: Grader,
    *,
    git_sha: str,
    created_at: datetime,
) -> dict[str, Any]:
    return {
        "version": config.version,
        "dataset": config.dataset,
        "tag": config.version,
        "created_at": created_at.isoformat(),
        "git_sha": git_sha,
        "source": {
            "months": [{"month": f.month, "url": f.url, "sha256": f.sha256} for f in files],
            "license": "CC0 (Lichess games database)",
            "games_read": drawn.games_read,
            "games_used": drawn.games_used,
        },
        "filters": config.filters.json(),
        "quotas_per_band": config.quotas.json(),
        "seed": config.seed,
        "engine": {
            "name": grader.engine,
            "settings": grader.settings,
            "fingerprint": grader.fingerprint,
        },
        "counts": counts(drawn.positions),
        "rows": len(drawn.positions),
    }


def _short_message(drawn: Sample) -> str:
    buckets = ", ".join(f"{band} {phase} -{n}" for (band, phase), n in drawn.short.items())
    return (
        f"{len(drawn.months)} month(s) left buckets short: {buckets}; raise --max-months "
        "or lower the quotas"
    )


def progress(report: Callable[[str], None], steps: int = 20) -> Callable[[int, int], None]:
    """Reports about every 1/`steps` of the labels, and the last."""

    def labelled(done: int, total: int) -> None:
        if done == total or done % max(1, total // steps) == 0:
            report(f"labelled {done}/{total}")

    return labelled


async def build(
    config: BuildConfig,
    *,
    git_sha: str,
    pools: Pools = EnginePool,
    fetch: Fetch = urlopen,
    report: Callable[[str], None] = lambda _: None,
    now: Callable[[], datetime] = lambda: datetime.now(UTC),
) -> tuple[Row, ...]:
    for path in (config.rows_path, config.manifest_path):
        if path.exists():
            msg = f"{path} exists: a new build is a new version, not an edit"
            raise BuildError(msg)
    files: list[MonthFile] = []
    games = month_games(
        itertools.islice(months_from(config.month), config.max_months),
        config.cache_dir / "lichess",
        on_month=files.append,
        fetch=fetch,
        report=report,
    )
    report(f"sampling with seed {config.seed}")
    drawn = sample(games, quotas=config.quotas, filters=config.filters, seed=config.seed)
    if drawn.short:
        raise BuildError(_short_message(drawn))
    report(f"sampled {len(drawn.positions)} positions from {drawn.games_used} games")

    positions = [s.position for s in drawn.positions]
    async with pools(config.engine, config.workers) as pool:
        grader = pool.grader
        references = await label(
            positions, pool, config.cache_dir / "labels", report=progress(report)
        )
    rows = tuple(row_of(s, references[s.position.fen]) for s in drawn.positions)

    config.out_dir.mkdir(parents=True, exist_ok=True)
    config.rows_path.write_text("".join(json.dumps(r.json()) + "\n" for r in rows))
    record = manifest(config, drawn, files, grader, git_sha=git_sha, created_at=now())
    config.manifest_path.write_text(json.dumps(record, indent=2) + "\n")
    report(f"wrote {config.rows_path} and {config.manifest_path}")
    return rows
