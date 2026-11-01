"""The LangSmith side of grading: find games, read their runs, replace their feedback."""

import contextlib
import json
import time
import uuid
from collections.abc import Callable, Iterable, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any

from langchain_chess_cli.grade.records import (
    FAILED,
    GRADER,
    PART_KEY,
    REVIEW_KEY,
    REVIEW_KEYS,
    SCORE_KEYS,
    STATUS_KEY,
    Feedback,
    RootRun,
    size,
    whole,
)

if TYPE_CHECKING:
    from langsmith import Client


@dataclass(frozen=True, slots=True)
class ProjectQuery:
    project: str
    since: datetime | None = None
    until: datetime | None = None
    metadata: tuple[tuple[str, str], ...] = ()
    limit: int | None = None


def _metadata_clause(key: str, value: str) -> str:
    return f"and(eq(metadata_key, {json.dumps(key)}), eq(metadata_value, {json.dumps(value)}))"


def run_filter(until: datetime | None, metadata: Sequence[tuple[str, str]]) -> str | None:
    clauses = [f'lt(start_time, "{until.isoformat()}")'] if until else []
    clauses += [_metadata_clause(k, v) for k, v in metadata]
    if len(clauses) < 2:
        return clauses[0] if clauses else None
    return f"and({', '.join(clauses)})"


LOOKBACK = timedelta(days=400)
"""How far back the run queries reach. `runs.query` looks back one day unless told otherwise and
refuses windows over 401 days; 400 days is also LangSmith's longest trace retention."""
PAGE_SIZE = 1000

RUNS_PER_LIST = 25
"""Run ids go in the URL of a feedback listing; a long game's would make it too long."""
READ_BACK_TRIES = 5


def environment_project(environments: Iterable[Any], environment: str) -> str:
    """The tracing project of an agent's environment, e.g. `local` or `production`."""
    for env in environments:
        if env.environment.lower() == environment.lower():
            return env.tracer_session_name
    msg = f"the agent has no {environment!r} environment"
    raise LookupError(msg)


class UnstoredReviewError(RuntimeError):
    """LangSmith accepted a review's feedback but didn't store it as written."""


def _ours(feedback: Any) -> dict[str, Any] | None:
    source = feedback.feedback_source
    metadata = (source.metadata if source else None) or {}
    return metadata if metadata.get("grader") == GRADER else None


def _newest(feedback: Iterable[Any]) -> Any | None:
    return max(feedback, key=lambda f: f.created_at, default=None)


def _superseded(stale: Iterable[Any]) -> list[str]:
    """The earlier reviews: their headers and those headers' parts, and parts LangSmith emptied.

    Not every other part: another grading of the game may have written its parts and not yet
    its header.
    """
    stale = list(stale)
    published = {
        f.value.get("generation")
        for f in stale
        if f.key == REVIEW_KEY and isinstance(f.value, dict)
    }
    return [
        f.id
        for f in stale
        if f.key == REVIEW_KEY
        or (
            f.key == PART_KEY
            and (not isinstance(f.value, dict) or f.value.get("generation") in published)
        )
    ]


class LangSmithStore:
    def __init__(
        self,
        client: "Client",
        *,
        write_concurrency: int = 16,
        sleep: Callable[[float], None] = time.sleep,
        now: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self._client = client
        self._write_concurrency = write_concurrency
        self._sleep = sleep
        self._now = now
        self._project_ids: dict[str, str] = {}

    def _since(self, since: datetime | None = None) -> datetime:
        earliest = self._now() - LOOKBACK
        return earliest if since is None else max(since, earliest)

    def agent_project(self, agent_id: str, environment: str) -> str:
        return environment_project(self._client.agents.retrieve(agent_id).environments, environment)

    async def _project_id(self, name: str) -> str:
        """`runs.query` takes project IDs, not names."""
        if name not in self._project_ids:
            project = await self._client.aread_project(project_name=name)
            self._project_ids[name] = str(project.id)
        return self._project_ids[name]

    async def find_threads(self, query: ProjectQuery) -> list[str]:
        """Newest first (the query's order), each thread once."""
        threads: dict[str, None] = {}
        filter_ = run_filter(query.until, query.metadata)
        runs = self._client.runs.query(
            project_ids=[await self._project_id(query.project)],
            is_root=True,
            min_start_time=self._since(query.since),
            selects=["ID", "START_TIME", "METADATA"],
            page_size=PAGE_SIZE,
            **({"filter": filter_} if filter_ else {}),
        )
        async for run in runs:
            thread_id = (run.metadata or {}).get("thread_id")
            if thread_id:
                threads[str(thread_id)] = None
                if query.limit is not None and len(threads) >= query.limit:
                    break
        return list(threads)

    async def thread_runs(self, project: str, thread_id: str) -> list[RootRun]:
        runs = self._client.runs.query(
            project_ids=[await self._project_id(project)],
            is_root=True,
            min_start_time=self._since(),
            filter=_metadata_clause("thread_id", thread_id),
            selects=["ID", "PROJECT_ID", "START_TIME", "OUTPUTS"],
            page_size=PAGE_SIZE,
        )
        # START_TIME is selected, so every run has one; the check is for the type.
        return [
            RootRun(str(r.id), str(r.project_id), r.start_time, r.outputs)
            async for r in runs
            if r.start_time is not None
        ]

    def _feedback(self, run_ids: Sequence[str], keys: Sequence[str]) -> list[Any]:
        """This grader's feedback under `keys` on the runs; none for no runs, not every run's."""
        batches = [run_ids[i : i + RUNS_PER_LIST] for i in range(0, len(run_ids), RUNS_PER_LIST)]
        return [
            fb
            for batch in batches
            for fb in self._client.list_feedback(run_ids=list(batch), feedback_key=list(keys))
            if _ours(fb) is not None
        ]

    def graded(self, run_id: str) -> str | None:
        """The fingerprint of this grader's review on the run, if it is there whole."""
        stored = self._feedback([run_id], REVIEW_KEYS)
        header = _newest(f for f in stored if f.key == REVIEW_KEY)
        if header is None:
            return None
        legacy = isinstance(header.value, dict) and header.value.get("version") == 1
        parts = [f.value for f in stored if f.key == PART_KEY]
        if not (legacy or whole(header.value, parts)):
            return None
        return header.feedback_source.metadata.get("fingerprint")

    def replace(self, runs: Sequence[RootRun], entries: Sequence[Feedback]) -> None:
        """Replace this grader's feedback on the game's runs with `entries`, the header last.

        The earlier review stays readable until the new one is stored and checked: its parts
        first, then its header. Only then do the earlier review and the app's `grade_status`
        mark go, so the game never reads as neither graded nor being graded. A review that
        fails its check is taken back, leaving the earlier one as it was.
        """
        stale = self._feedback([r.id for r in runs], (*SCORE_KEYS, *REVIEW_KEYS, STATUS_KEY))
        *rest, header = entries
        ids = [str(uuid.uuid4()) for _ in entries]
        *rest_ids, header_id = ids
        with ThreadPoolExecutor(self._write_concurrency) as pool:
            list(pool.map(self._delete, [f.id for f in stale if f.key in SCORE_KEYS]))
            list(pool.map(self._create, rest, rest_ids))
        try:
            self._check([e for e in rest if e.key == PART_KEY])
            # Its id is chosen first: a request that fails may still have stored it.
            self._create(header, header_id)
            self._check([header])
        except Exception:
            # The header goes first; if it can't, its parts stay with it.
            self._delete(header_id)
            parts = [i for i, e in zip(rest_ids, rest, strict=True) if e.key == PART_KEY]
            with ThreadPoolExecutor(self._write_concurrency) as pool:
                list(pool.map(self._delete, parts))
            raise
        with ThreadPoolExecutor(self._write_concurrency) as pool:
            list(pool.map(self._delete, _superseded(stale)))
        for status in (f for f in stale if f.key == STATUS_KEY):
            self._delete(status.id)

    def _delete(self, feedback_id: str) -> None:
        """Another grading of the same game may have deleted it first."""
        from langsmith.utils import LangSmithNotFoundError

        with contextlib.suppress(LangSmithNotFoundError):
            self._client.delete_feedback(feedback_id)

    def _check(self, entries: Sequence[Feedback]) -> None:
        """Read `entries` back until LangSmith has them as written; it may store them late."""
        if not entries:
            return
        run = entries[0].run.id
        expected = [e.value for e in entries]
        keys = sorted({e.key for e in entries})
        missing = expected
        for attempt in range(READ_BACK_TRIES):
            if attempt:
                self._sleep(2 ** (attempt - 1))
            stored = [f.value for f in self._feedback([run], keys)]
            missing = [v for v in expected if v not in stored]
            if not missing:
                return
        largest = max(size(v) for v in missing)
        msg = (
            f"LangSmith didn't store {len(missing)} of {len(expected)} {', '.join(keys)} values "
            f"on run {run} as written; the largest is {largest} bytes. Its feedback size cap may "
            "be lower."
        )
        raise UnstoredReviewError(msg)

    def settle(self, runs: Sequence[RootRun], failure: str | None) -> None:
        """Clear the `grade_status` marks on these runs, or fail them, `failure` saying why."""
        for fb in self._feedback([r.id for r in runs], [STATUS_KEY]):
            if failure is None:
                self._delete(fb.id)
            else:
                self._client.update_feedback(fb.id, value=FAILED, comment=failure)

    def _create(self, entry: Feedback, feedback_id: str) -> None:
        self._client.create_feedback(
            entry.run.id,
            feedback_id=feedback_id,
            key=entry.key,
            session_id=entry.run.project_id,
            start_time=entry.run.start_time,
            score=entry.score,
            value=entry.value,
            source_info=entry.source_info,
            extend_trace_retention=True,
        )
