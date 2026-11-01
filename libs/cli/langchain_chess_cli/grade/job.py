"""`lcchess grade --sandbox-job`: the review app's Analyze, finished inside its sandbox.

The app marks each game `grade_status: analyzing`, launches the job and lets go. Nothing polls
the sandbox, so the job settles every mark itself, whatever happens, then deletes its sandbox.
"""

import asyncio
from collections import deque
from collections.abc import Awaitable, Callable, Iterable, Sequence
from typing import Protocol

from langchain_chess_cli.grade.batch import Event, Graded, Skipped, Summary, Threads
from langchain_chess_cli.grade.cli import printer
from langchain_chess_cli.grade.records import RootRun

TAIL_LINES = 20
NO_GAME = "The thread has no game in its traces."


class MarkStore(Protocol):
    async def thread_runs(self, project: str, thread_id: str) -> list[RootRun]: ...
    def settle(self, runs: Sequence[RootRun], failure: str | None) -> None: ...


def verdicts(
    ids: Iterable[str], events: Iterable[Event], failure: str | None
) -> dict[str, str | None]:
    """Each ungraded game's mark: None clears it, text fails it. A graded game's write cleared it.

    `failure` is why the batch stopped, or None when it finished.
    """
    graded = {e.record.thread_id for e in events if isinstance(e, Graded)}
    skipped = {e.thread_id: e.reason for e in events if isinstance(e, Skipped)}
    marks: dict[str, str | None] = {}
    for thread_id in dict.fromkeys(ids):
        if thread_id in graded:
            continue
        match skipped.get(thread_id):
            case "no_game":
                marks[thread_id] = NO_GAME
            case "graded":
                marks[thread_id] = None
            case _:
                marks[thread_id] = failure
    return marks


async def _settle(store: MarkStore, project: str, marks: dict[str, str | None]) -> None:
    for thread_id, failure in marks.items():
        runs = await store.thread_runs(project, thread_id)
        await asyncio.to_thread(store.settle, runs, failure)


async def sandbox_job(
    selection: Threads,
    store: MarkStore,
    grade: Callable[[Callable[[Event], None]], Awaitable[Summary]],
    *,
    echo: Callable[[str], None],
    delete_sandbox: Callable[[], None],
) -> Summary:
    """Run `grade` with a progress reporter, settle the marks, and delete the sandbox last."""
    log: deque[str] = deque(maxlen=TAIL_LINES)
    events: list[Event] = []

    def tee(line: str) -> None:
        log.append(line)
        echo(line)

    show = printer(tee)

    def report(event: Event) -> None:
        events.append(event)
        show(event)

    try:
        try:
            summary = await grade(report)
        except Exception as error:
            log.append(f"{type(error).__name__}: {error}")
            marks = verdicts(selection.ids, events, "\n".join(log))
            await _settle(store, selection.project, marks)
            raise
        await _settle(store, selection.project, verdicts(selection.ids, events, None))
        return summary
    finally:
        delete_sandbox()
