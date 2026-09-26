"""A grading batch: select games, evaluate each distinct position once, write each game's grades.

The work unit is a position, not a game, so one long game can't hold up the batch. Positions
are queued game by game and the engines take them FIFO, so earlier games finish, and are
written, first. A crash keeps every game already written; a re-run skips them.
"""

import asyncio
import time
from collections.abc import Callable, Iterable, Sequence
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from typing import Literal, Protocol

from langchain_chess.engine import Grader
from langchain_chess.grading import Analysis, GameGrade, engine_fens, grade_game
from langchain_chess_cli.grade.records import Feedback, GameRecord, RootRun, feedback, game_record
from langchain_chess_cli.grade.store import ProjectQuery


class Store(Protocol):
    def find_threads(self, query: ProjectQuery) -> list[str]: ...
    def thread_runs(self, project: str, thread_id: str) -> list[RootRun]: ...
    def graded(self, run_id: str) -> str | None: ...
    def replace(self, runs: Sequence[RootRun], entries: Sequence[Feedback]) -> None: ...


class Evaluator(Protocol):
    @property
    def grader(self) -> Grader: ...
    async def analyse(self, fen: str) -> Analysis: ...


type Pools = Callable[[int], AbstractAsyncContextManager[Evaluator]]
"""Opens a pool of that many engines."""


@dataclass(frozen=True, slots=True)
class Threads:
    project: str
    ids: tuple[str, ...]


type Selection = Threads | ProjectQuery


@dataclass(frozen=True, slots=True)
class Skipped:
    thread_id: str
    reason: Literal["no_game", "graded"]


@dataclass(frozen=True, slots=True)
class Planned:
    grader: Grader
    games: tuple[GameRecord, ...]
    positions: int
    workers: int
    dry_run: bool


@dataclass(frozen=True, slots=True)
class Graded:
    record: GameRecord
    grade: GameGrade
    positions_done: int
    positions_total: int
    elapsed_s: float


type Event = Skipped | Planned | Graded


@dataclass(frozen=True, slots=True)
class Summary:
    graded: int
    skipped: int
    positions: int


async def _bounded[T](limit: int, calls: Iterable[Callable[[], T]]) -> list[T]:
    semaphore = asyncio.Semaphore(limit)

    async def one(call: Callable[[], T]) -> T:
        async with semaphore:
            return await asyncio.to_thread(call)

    return await asyncio.gather(*(one(c) for c in calls))


async def grade_batch(
    selection: Selection,
    store: Store,
    pools: Pools,
    *,
    workers: int,
    force: bool = False,
    dry_run: bool = False,
    concurrency: int = 8,
    report: Callable[[Event], None] = lambda _: None,
    clock: Callable[[], float] = time.monotonic,
) -> Summary:
    if isinstance(selection, Threads):
        project, ids = selection.project, list(dict.fromkeys(selection.ids))
    else:
        project, ids = selection.project, await asyncio.to_thread(store.find_threads, selection)

    runs = await _bounded(concurrency, [lambda t=t: store.thread_runs(project, t) for t in ids])
    records: list[GameRecord] = []
    skipped = 0
    for thread_id, thread in zip(ids, runs, strict=True):
        record = game_record(thread_id, thread)
        if record is None:
            skipped += 1
            report(Skipped(thread_id, "no_game"))
        else:
            records.append(record)
    if not records:
        return Summary(graded=0, skipped=skipped, positions=0)

    async with pools(1) as probe:
        grader = probe.grader
    if not force:
        marks = await _bounded(
            concurrency, [lambda r=r: store.graded(r.last_run.id) for r in records]
        )
        todo = []
        for record, mark in zip(records, marks, strict=True):
            if mark == grader.fingerprint:
                skipped += 1
                report(Skipped(record.thread_id, "graded"))
            else:
                todo.append(record)
        records = todo

    fens = engine_fens(r.positions for r in records)
    size = max(1, min(workers, len(fens)))
    report(Planned(grader, tuple(records), len(fens), size, dry_run))
    if dry_run or not records:
        return Summary(graded=0, skipped=skipped, positions=0)

    async with pools(size) as pool:
        done = 0
        started = clock()

        async def evaluate(fen: str) -> Analysis:
            nonlocal done
            analysis = await pool.analyse(fen)
            done += 1
            return analysis

        tasks = {fen: asyncio.ensure_future(evaluate(fen)) for fen in fens}

        async def finish(record: GameRecord) -> None:
            unsettled = [p.fen for p in record.positions if p.settled is None]
            analyses = dict(
                zip(unsettled, await asyncio.gather(*(tasks[f] for f in unsettled)), strict=True)
            )
            grade = grade_game(record.positions, record.moves, analyses)
            entries = feedback(record, grade, grader)
            await asyncio.to_thread(store.replace, record.runs, entries)
            report(Graded(record, grade, done, len(fens), clock() - started))

        try:
            # Every game settles before a failure surfaces, so no finished game's write is cut off.
            results = await asyncio.gather(*(finish(r) for r in records), return_exceptions=True)
        finally:
            for task in tasks.values():
                task.cancel()
    failure = next((r for r in results if isinstance(r, BaseException)), None)
    if failure is not None:
        raise failure
    return Summary(graded=len(records), skipped=skipped, positions=len(fens))
