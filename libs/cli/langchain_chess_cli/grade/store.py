"""The LangSmith side of grading: find games, read their runs, replace their feedback."""

import json
from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime
from typing import TYPE_CHECKING, Any

from langchain_chess_cli.grade.records import GRADER, KEYS, REVIEW_KEY, Feedback, RootRun

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

        The last entry is written only after all the others: it marks the game as graded.
        """
        stale = [
            fb.id
            for fb in self._client.list_feedback(
                run_ids=[r.id for r in runs], feedback_key=list(KEYS)
            )
            if _ours(fb) is not None
        ]
        *rest, marker = entries
        with ThreadPoolExecutor(self._write_concurrency) as pool:
            list(pool.map(self._client.delete_feedback, stale))
            list(pool.map(self._create, rest))
        self._create(marker)

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
