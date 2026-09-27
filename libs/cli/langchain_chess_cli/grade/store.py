"""The LangSmith side of grading: find games, read their runs, replace their feedback."""

import json
from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime
from typing import TYPE_CHECKING, Any

from langchain_chess_cli.grade.records import (
    FAILED,
    GRADER,
    KEYS,
    REVIEW_KEY,
    STATUS_KEY,
    Feedback,
    RootRun,
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


def _ours(feedback: Any) -> dict[str, Any] | None:
    source = feedback.feedback_source
    metadata = (source.metadata if source else None) or {}
    return metadata if metadata.get("grader") == GRADER else None


class LangSmithStore:
    def __init__(self, client: "Client", *, write_concurrency: int = 16) -> None:
        self._client = client
        self._write_concurrency = write_concurrency

    def find_threads(self, query: ProjectQuery) -> list[str]:
        """Newest first, each thread once."""
        threads: dict[str, None] = {}
        runs = self._client.list_runs(
            project_name=query.project,
            is_root=True,
            start_time=query.since,
            filter=run_filter(query.until, query.metadata),
            select=["id", "start_time", "extra"],
        )
        for run in runs:
            thread_id = ((run.extra or {}).get("metadata") or {}).get("thread_id")
            if thread_id:
                threads[str(thread_id)] = None
                if query.limit is not None and len(threads) >= query.limit:
                    break
        return list(threads)

    def thread_runs(self, project: str, thread_id: str) -> list[RootRun]:
        runs = self._client.list_runs(
            project_name=project,
            is_root=True,
            filter=_metadata_clause("thread_id", thread_id),
            select=["id", "session_id", "start_time", "outputs"],
        )
        return [RootRun(str(r.id), str(r.session_id), r.start_time, r.outputs) for r in runs]

    def graded(self, run_id: str) -> str | None:
        """The fingerprint of this grader's review on the run, if there is one."""
        for fb in self._client.list_feedback(run_ids=[run_id], feedback_key=[REVIEW_KEY]):
            ours = _ours(fb)
            if ours is not None:
                return ours.get("fingerprint")
        return None

    def replace(self, runs: Sequence[RootRun], entries: Sequence[Feedback]) -> None:
        """Drop this grader's earlier feedback on the game's runs, then write `entries`.

        The last entry is written only after all the others: it marks the game as graded. The
        review app's `grade_status` mark goes after that, so the game never reads as neither.
        """
        stale = [
            fb
            for fb in self._client.list_feedback(
                run_ids=[r.id for r in runs], feedback_key=[*KEYS, STATUS_KEY]
            )
            if _ours(fb) is not None
        ]
        # The game reads as graded while an old marker survives, so markers go first.
        markers = [f.id for f in stale if f.key == REVIEW_KEY]
        others = [f.id for f in stale if f.key in KEYS and f.key != REVIEW_KEY]
        statuses = [f.id for f in stale if f.key == STATUS_KEY]
        *rest, marker = entries
        with ThreadPoolExecutor(self._write_concurrency) as pool:
            list(pool.map(self._client.delete_feedback, markers))
            list(pool.map(self._client.delete_feedback, others))
            list(pool.map(self._create, rest))
        self._create(marker)
        for status in statuses:
            self._client.delete_feedback(status)

    def settle(self, runs: Sequence[RootRun], failure: str | None) -> None:
        """Clear the `grade_status` marks on these runs, or fail them, `failure` saying why."""
        # No runs would be no filter at all: every mark in the workspace.
        if not runs:
            return
        for fb in self._client.list_feedback(
            run_ids=[r.id for r in runs], feedback_key=[STATUS_KEY]
        ):
            if _ours(fb) is None:
                continue
            if failure is None:
                self._client.delete_feedback(fb.id)
            else:
                self._client.update_feedback(fb.id, value=FAILED, comment=failure)

    def _create(self, entry: Feedback) -> None:
        self._client.create_feedback(
            entry.run.id,
            key=entry.key,
            session_id=entry.run.project_id,
            start_time=entry.run.start_time,
            score=entry.score,
            value=entry.value,
            source_info=entry.source_info,
        )
