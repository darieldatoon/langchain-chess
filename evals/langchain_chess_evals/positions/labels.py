"""Label every legal move of each position with the `langchain_chess.engine` pool, resumably.

Finished labels are appended to a JSONL cache named by the grader's fingerprint, so an
interrupted build picks up where it stopped and a change of engine or settings starts afresh.
"""

import asyncio
import json
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Protocol

from langchain_chess.engine import Grader
from langchain_chess.grading import Analysis
from langchain_chess_evals.positions.examples import Reference, reference_from
from langchain_chess_evals.positions.sampling import Position


class Analyser(Protocol):
    @property
    def grader(self) -> Grader: ...
    async def analyse(self, fen: str) -> Analysis: ...


def load_cache(path: Path) -> dict[str, Reference]:
    if not path.exists():
        return {}
    labels: dict[str, Reference] = {}
    for line in path.read_text().splitlines():
        if line.strip():
            entry = json.loads(line)
            labels[entry["fen"]] = Reference.from_json(entry["reference"])
    return labels


async def label(
    positions: Sequence[Position],
    pool: Analyser,
    cache_dir: Path,
    *,
    report: Callable[[int, int], None] = lambda done, total: None,
) -> dict[str, Reference]:
    """References by FEN, for every position."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / f"{pool.grader.fingerprint}.jsonl"
    labels = load_cache(path)
    todo = {p.fen: p.legal for p in positions if p.fen not in labels}
    total = len(todo)
    done = 0
    with path.open("a") as cache:

        async def one(fen: str, legal: tuple[str, ...]) -> None:
            nonlocal done
            reference = reference_from(await pool.analyse(fen), legal)
            labels[fen] = reference
            cache.write(json.dumps({"fen": fen, "reference": reference.json()}) + "\n")
            cache.flush()
            done += 1
            report(done, total)

        # A TaskGroup, not gather: a failure must cancel the rest before the cache closes.
        async with asyncio.TaskGroup() as group:
            for fen, legal in todo.items():
                group.create_task(one(fen, legal))
    return labels
