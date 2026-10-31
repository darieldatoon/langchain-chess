import asyncio
import contextlib
import itertools
import json
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import ClassVar, cast

import chess
import pytest
from langsmith.utils import LangSmithNotFoundError
from typer.testing import CliRunner

from langchain_chess.engine import Grader, SearchLimit
from langchain_chess.grading import Analysis, Cp, Line
from langchain_chess.testing import FAKE_ENGINE_NAME, fake_engine
from langchain_chess_cli import main
from langchain_chess_cli.grade import cli, job
from langchain_chess_cli.grade.batch import (
    Graded,
    Planned,
    Skipped,
    Summary,
    Threads,
    grade_batch,
)
from langchain_chess_cli.grade.records import (
    FAILED,
    GRADER,
    PART_KEY,
    REVIEW_KEY,
    STATUS_KEY,
    Feedback,
    RootRun,
    feedback,
    game_record,
    review,
    size,
    source_info,
    whole,
)
from langchain_chess_cli.grade.store import (
    LangSmithStore,
    ProjectQuery,
    UnstoredReviewError,
    environment_project,
    run_filter,
)
from langchain_chess_cli.main import app

T0 = datetime(2026, 9, 25, 12, tzinfo=UTC)
ITALIAN = ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4"]
GRADER_A = Grader("FakeFish 1", {"depth": 1, "multipv": 1, "threads": 1, "hash_mb": 256})


def ply(i, uci, turn_id):
    return {"ply": i, "uci": uci, "turn_id": turn_id, "source": "llm" if turn_id else "external"}


def web_game(thread, moves, *, outcome=None, project="p1"):
    """Runs as the web UI makes them: the human's move comes in, the agent answers."""
    runs, plies = [], []
    for i, uci in enumerate(moves):
        plies.append(ply(i, uci, f"turn-{i}" if i % 2 else None))
        if i % 2 or i == len(moves) - 1:
            outputs = {
                "start_fen": chess.STARTING_FEN,
                "moves": [p["uci"] for p in plies],
                "plies": list(plies),
                "outcome": outcome if i == len(moves) - 1 else None,
            }
            runs.append(
                RootRun(f"{thread}-r{len(runs)}", project, T0 + timedelta(minutes=i), outputs)
            )
    return runs


# records


def test_a_game_record_from_its_runs():
    runs = web_game("t", ITALIAN)
    # A failed run and a non-game run are ignored; the order they arrive in doesn't matter.
    noise = [RootRun("err", "p1", T0, None), RootRun("probe", "p1", T0, {"messages": []})]
    record = game_record("t", [*reversed(runs), *noise])
    assert record is not None
    assert record.moves == tuple(ITALIAN)
    assert record.turn_ids == (None, "turn-1", None, "turn-3", None)
    assert [r.id for r in record.ply_runs] == ["t-r0", "t-r0", "t-r1", "t-r1", "t-r2"]
    assert record.last_run.id == "t-r2"
    assert [r.id for r in record.runs] == ["t-r0", "t-r1", "t-r2"]
    assert len(record.positions) == 6


def test_no_record_without_a_move():
    assert game_record("t", []) is None
    empty = {"start_fen": chess.STARTING_FEN, "moves": [], "plies": []}
    assert game_record("t", [RootRun("r", "p1", T0, empty)]) is None


def _grade(record):
    from langchain_chess.grading import grade_game

    analyses = {
        p.fen: Analysis((Line(Cp(0), ("e2e4",)),)) for p in record.positions if p.settled is None
    }
    return grade_game(record.positions, record.moves, analyses)


def test_feedback_goes_on_agent_turns_and_the_last_run():
    record = game_record("t", web_game("t", ITALIAN[:4]))
    entries = feedback(record, _grade(record), GRADER_A, "g1")
    by_run = [(e.run.id, e.key) for e in entries]
    assert by_run == [
        ("t-r0", "move_quality"),
        ("t-r0", "cp_loss"),
        ("t-r0", "win_pct_loss"),
        ("t-r0", "best_move"),
        ("t-r1", "move_quality"),
        ("t-r1", "cp_loss"),
        ("t-r1", "win_pct_loss"),
        ("t-r1", "best_move"),
        ("t-r1", "accuracy_white"),
        ("t-r1", "accuracy_black"),
        ("t-r1", PART_KEY),
        ("t-r1", REVIEW_KEY),
    ]
    assert entries[0].value == "good"
    assert entries[0].source_info == {**source_info(GRADER_A), "ply": 1}
    assert entries[-1].source_info["grader"] == GRADER
    assert entries[-1].source_info["fingerprint"] == GRADER_A.fingerprint


def test_a_side_that_never_moved_gets_no_accuracy():
    record = game_record("t", web_game("t", ITALIAN[:1]))
    keys = [e.key for e in feedback(record, _grade(record), GRADER_A, "g1")]
    assert keys == ["accuracy_white", PART_KEY, REVIEW_KEY]


def test_the_review_holds_what_the_app_draws():
    record = game_record("t", web_game("t", ITALIAN[:2]))
    header, parts = review(record, _grade(record), GRADER_A, "g1")
    assert header == {
        "version": 2,
        "generation": "g1",
        "engine": "FakeFish 1",
        "settings": GRADER_A.settings,
        "accuracy": {"white": 100.0, "black": 100.0},
        "plies": 2,
        "parts": 1,
        "final_eval": {"cp": 0},
    }
    [part] = parts
    assert (part["version"], part["generation"], part["part"], part["from"]) == (2, "g1", 0, 0)
    assert part["evals"] == [{"cp": 0}] * 2
    assert part["plies"][0] == {
        "ply": 0,
        "run_id": "t-r0",
        "side": "white",
        "uci": "e2e4",
        "best_move": "e2e4",
        "quality": "best",
        "cp_loss": 0,
        "win_pct_loss": 0.0,
        "accuracy": 100.0,
        "lines": [{"eval": {"cp": 0}, "pv": ["e2e4"]}],
    }
    one = game_record("t", web_game("t", ITALIAN[:1]))
    single, _ = review(one, _grade(one), GRADER_A, "g1")
    assert single["accuracy"] == {"white": 100.0, "black": None}


def test_a_long_review_is_split_into_parts_under_the_budget():
    record = game_record("t", web_game("t", ITALIAN))
    grade = _grade(record)
    [whole_part] = review(record, grade, GRADER_A, "g1")[1]
    header, parts = review(record, grade, GRADER_A, "g1", part_bytes=700)
    assert header["parts"] == len(parts) > 1
    assert all(size(p) <= 700 for p in parts)
    assert [p["part"] for p in parts] == list(range(len(parts)))
    plies = [cast("list", p["plies"]) for p in parts]
    assert [p["from"] for p in parts] == [0, *itertools.accumulate(map(len, plies))][:-1]
    assert [x for chunk in plies for x in chunk] == whole_part["plies"]
    assert [x for p in parts for x in cast("list", p["evals"])] == whole_part["evals"]
    with pytest.raises(ValueError, match="ply 0's grade alone is over 100 bytes"):
        review(record, grade, GRADER_A, "g1", part_bytes=100)


def test_a_header_is_whole_with_every_part_of_its_generation():
    header = {"version": 2, "generation": "g2", "parts": 2}
    part = lambda i, g="g2": {"generation": g, "part": i}  # noqa: E731
    assert whole(header, [part(1), part(0), part(0, "g1")])
    assert not whole(header, [part(0), part(1, "g1")])
    assert not whole(header, [part(0), None, "x"])
    assert not whole({**header, "parts": None}, [part(0)])
    assert not whole({"version": 1}, [])
    assert not whole(None, [part(0), part(1)])


# store


def test_run_filters():
    until = datetime(2026, 9, 1, tzinfo=UTC)
    assert run_filter(None, []) is None
    assert run_filter(until, []) == 'lt(start_time, "2026-09-01T00:00:00+00:00")'
    assert run_filter(None, [("surface", "web")]) == (
        'and(eq(metadata_key, "surface"), eq(metadata_value, "web"))'
    )
    both = run_filter(until, [("surface", "web"), ("policy", "hybrid")])
    assert both.startswith("and(lt(start_time")
    assert both.count("metadata_key") == 2


def fb(key, run_id, grader=GRADER, fingerprint="f1", value=None, created_at=T0, id=None):
    source = SimpleNamespace(metadata={"grader": grader, "fingerprint": fingerprint})
    return SimpleNamespace(
        id=id or f"{run_id}/{key}/{grader}",
        key=key,
        run_id=run_id,
        value=value,
        created_at=created_at,
        feedback_source=source,
    )


class FakeClient:
    """Stores what it is given as JSON, nulling a value over `cap` bytes as LangSmith does."""

    def __init__(self, runs=(), feedback=(), cap=20 * 1024):
        self.runs = list(runs)
        self.feedback = list(feedback)
        self.cap = cap
        self.calls = []
        self.created = []

    def list_runs(self, **kw):
        self.calls.append(("list_runs", kw))
        return iter(self.runs)

    def list_feedback(self, *, run_ids, feedback_key):
        self.calls.append(("list_feedback", run_ids, feedback_key))
        return [f for f in self.feedback if f.run_id in run_ids and f.key in feedback_key]

    def delete_feedback(self, feedback_id):
        self.calls.append(("delete", feedback_id))
        if not any(f.id == feedback_id for f in self.feedback):
            raise LangSmithNotFoundError(feedback_id)
        self.feedback = [f for f in self.feedback if f.id != feedback_id]

    def update_feedback(self, feedback_id, **kw):
        self.calls.append(("update", feedback_id, kw))

    def create_feedback(self, run_id, **kw):
        self.calls.append(("create", run_id, kw["key"], kw["session_id"]))
        self.created.append(kw)
        value = kw["value"]
        stored = (
            None if value is not None and size(value) > self.cap else json.loads(json.dumps(value))
        )
        self.feedback.append(
            fb(
                kw["key"],
                run_id,
                grader=kw["source_info"].get("grader", GRADER),
                fingerprint=kw["source_info"].get("fingerprint"),
                value=stored,
                created_at=T0 + timedelta(seconds=len(self.created)),
                id=kw["feedback_id"],
            )
        )


def listed(thread_id):
    return SimpleNamespace(extra={"metadata": {"thread_id": thread_id}} if thread_id else None)


def test_find_threads_newest_first_and_distinct():
    client = FakeClient([listed("b"), listed(None), listed("b"), listed("a"), listed("c")])
    store = LangSmithStore(client)
    since = datetime(2026, 9, 1, tzinfo=UTC)
    query = ProjectQuery("proj", since=since, metadata=(("surface", "web"),), limit=2)
    assert store.find_threads(query) == ["b", "a"]
    kw = client.calls[0][1]
    assert kw["project_name"] == "proj"
    assert kw["start_time"] == since
    assert kw["is_root"] is True
    assert "surface" in kw["filter"]
    assert store.find_threads(ProjectQuery("proj")) == ["b", "a", "c"]


def test_an_agent_environment_names_its_project():
    environments = [
        SimpleNamespace(environment="LOCAL", tracer_session_name="chess-local"),
        SimpleNamespace(environment="PRODUCTION", tracer_session_name="chess-production"),
    ]
    assert environment_project(environments, "production") == "chess-production"
    with pytest.raises(LookupError, match="'staging'"):
        environment_project(environments, "staging")
    client = SimpleNamespace(
        agents=SimpleNamespace(retrieve=lambda agent_id: SimpleNamespace(environments=environments))
    )
    assert LangSmithStore(client).agent_project("chess", "local") == "chess-local"


def test_thread_runs():
    run = SimpleNamespace(id="r1", session_id="p1", start_time=T0, outputs={"moves": []})
    client = FakeClient([run])
    assert LangSmithStore(client).thread_runs("proj", "t1") == [
        RootRun("r1", "p1", T0, {"moves": []})
    ]
    assert '"t1"' in client.calls[0][1]["filter"]


def header_and_part(generation="g1"):
    header = {"version": 2, "generation": generation, "parts": 1}
    return header, {"version": 2, "generation": generation, "part": 0}


def test_graded_reads_only_this_graders_whole_review():
    header, part = header_and_part()
    client = FakeClient(
        feedback=[
            fb(REVIEW_KEY, "r1", grader="someone", value=header),
            fb(REVIEW_KEY, "r1", value=header),
            fb(PART_KEY, "r1", value=part),
        ]
    )
    store = LangSmithStore(client)
    assert store.graded("r1") == "f1"
    assert store.graded("r2") is None
    client.feedback[2].feedback_source = None
    assert store.graded("r1") is None


@pytest.mark.parametrize(
    ("value", "graded"),
    [({"version": 1, "plies": []}, "f1"), (None, None), ({"version": 2}, None), ("x", None)],
)
def test_a_review_stored_as_null_or_without_its_parts_is_not_graded(value, graded):
    assert LangSmithStore(FakeClient(feedback=[fb(REVIEW_KEY, "r1", value=value)])).graded(
        "r1"
    ) == (graded)


def test_graded_reads_the_newest_header():
    old, old_part = header_and_part("g1")
    new, _ = header_and_part("g2")
    later = T0 + timedelta(minutes=1)
    stored = [
        fb(REVIEW_KEY, "r1", value=old, id="old"),
        fb(PART_KEY, "r1", value=old_part),
        fb(REVIEW_KEY, "r1", value=new, created_at=later, id="new"),
    ]
    assert LangSmithStore(FakeClient(feedback=stored)).graded("r1") is None


def test_feedback_is_listed_a_batch_of_runs_at_a_time():
    client = FakeClient()
    store = LangSmithStore(client)
    store.settle([RootRun(f"r{i}", "p1", T0) for i in range(60)], None)
    store.settle([], "engine died")
    assert [len(c[1]) for c in client.calls if c[0] == "list_feedback"] == [25, 25, 10]


def replace_run(entry, run):
    return Feedback(run, entry.key, entry.source_info, entry.score, entry.value)


def entries_for(run, generation="g2"):
    header, part = header_and_part(generation)
    return [
        Feedback(run, "cp_loss", source_info(GRADER_A), score=3),
        Feedback(run, PART_KEY, source_info(GRADER_A), value=part),
        Feedback(run, REVIEW_KEY, source_info(GRADER_A), value=header),
    ]


def test_replace_publishes_the_new_review_before_dropping_the_old():
    run, r0 = RootRun("r1", "p1", T0), RootRun("r0", "p1", T0)
    old, old_part = header_and_part("g1")
    client = FakeClient(
        feedback=[
            fb("cp_loss", "r0"),
            fb("cp_loss", "r1", grader="human"),
            fb(PART_KEY, "r1", value=old_part),
            fb(REVIEW_KEY, "r1", value=old),
            fb(STATUS_KEY, "r1"),
        ]
    )
    store = LangSmithStore(client, write_concurrency=1)
    store.replace([run, r0], entries_for(run))
    ops = [c[:3] if c[0] == "create" else c[:2] for c in client.calls]
    assert ops == [
        ("list_feedback", ["r1", "r0"]),
        ("delete", f"r0/cp_loss/{GRADER}"),
        ("create", "r1", "cp_loss"),
        ("create", "r1", PART_KEY),
        ("list_feedback", ["r1"]),
        ("create", "r1", REVIEW_KEY),
        ("list_feedback", ["r1"]),
        ("delete", f"r1/{PART_KEY}/{GRADER}"),
        ("delete", f"r1/{REVIEW_KEY}/{GRADER}"),
        ("delete", f"r1/{STATUS_KEY}/{GRADER}"),
    ]
    assert store.graded("r1") == GRADER_A.fingerprint
    assert [kw["extend_trace_retention"] for kw in client.created] == [True] * 3


def test_a_graded_game_round_trips_through_langsmith():
    record = game_record("t", web_game("t", ITALIAN))
    entries = feedback(record, _grade(record), GRADER_A, "g1", part_bytes=700)
    client = FakeClient()
    store = LangSmithStore(client)
    store.replace(record.runs, entries)
    assert store.graded(record.last_run.id) == GRADER_A.fingerprint
    stored = {(f.key, json.dumps(f.value)) for f in client.feedback}
    assert stored == {(e.key, json.dumps(e.value)) for e in entries}


def test_a_review_langsmith_drops_leaves_the_earlier_one_published():
    run = RootRun("r1", "p1", T0)
    old, old_part = header_and_part("g1")
    client = FakeClient(
        feedback=[fb(PART_KEY, "r1", value=old_part), fb(REVIEW_KEY, "r1", value=old)], cap=10
    )
    sleeps = []
    store = LangSmithStore(client, write_concurrency=1, sleep=sleeps.append)
    with pytest.raises(UnstoredReviewError, match=r"didn't store 1 of 1 game_review_part values"):
        store.replace([run], entries_for(run))
    assert sleeps == [1, 2, 4, 8]
    assert not any(c[0] == "create" and c[2] == REVIEW_KEY for c in client.calls)
    assert [f.value for f in client.feedback if f.key in (PART_KEY, REVIEW_KEY)] == [old_part, old]
    assert store.graded("r1") == "f1"


class HeaderDroppingClient(FakeClient):
    def create_feedback(self, run_id, **kw):
        super().create_feedback(run_id, **kw)
        if kw["key"] == REVIEW_KEY:
            self.feedback[-1].value = None


def test_a_header_langsmith_drops_is_taken_back_with_its_parts():
    run = RootRun("r1", "p1", T0)
    old, old_part = header_and_part("g1")
    client = HeaderDroppingClient(
        feedback=[fb(PART_KEY, "r1", value=old_part), fb(REVIEW_KEY, "r1", value=old)]
    )
    store = LangSmithStore(client, write_concurrency=1, sleep=lambda _: None)
    with pytest.raises(UnstoredReviewError, match="1 of 1 game_review values"):
        store.replace([run], entries_for(run))
    assert [f.value for f in client.feedback if f.key in (PART_KEY, REVIEW_KEY)] == [old_part, old]
    assert store.graded("r1") == "f1"


class StoredButFailedClient(FakeClient):
    """Stores the header, then fails the request, as a timeout after the write would."""

    def create_feedback(self, run_id, **kw):
        super().create_feedback(run_id, **kw)
        if kw["key"] == REVIEW_KEY:
            raise RuntimeError("read timed out")


def test_a_header_stored_by_a_failed_request_is_taken_back():
    run = RootRun("r1", "p1", T0)
    record = game_record("t", web_game("t", ITALIAN))
    entries = feedback(record, _grade(record), GRADER_A, "g2")
    old = [
        fb(e.key, run.id, value=e.value, id=f"old-{e.key}")
        for e in feedback(record, _grade(record), GRADER_A, "g1")
        if e.key in (PART_KEY, REVIEW_KEY)
    ]
    client = StoredButFailedClient(feedback=old)
    store = LangSmithStore(client, write_concurrency=1)
    with pytest.raises(RuntimeError, match="read timed out"):
        store.replace([run], [replace_run(e, run) for e in entries])
    assert [f for f in client.feedback if f.key in (PART_KEY, REVIEW_KEY)] == old
    assert store.graded("r1") == "f1"


class StuckHeaderClient(HeaderDroppingClient):
    """Drops the header's value, then can't delete it."""

    def delete_feedback(self, feedback_id):
        if any(f.id == feedback_id and f.key == REVIEW_KEY for f in self.feedback):
            raise RuntimeError("delete failed")
        super().delete_feedback(feedback_id)


def test_parts_stay_while_their_header_cant_be_taken_back():
    run = RootRun("r1", "p1", T0)
    client = StuckHeaderClient()
    store = LangSmithStore(client, write_concurrency=1, sleep=lambda _: None)
    with pytest.raises(RuntimeError, match="delete failed"):
        store.replace([run], entries_for(run))
    assert sorted(f.key for f in client.feedback) == ["cp_loss", REVIEW_KEY, PART_KEY]


def test_a_regrade_leaves_another_gradings_unpublished_parts():
    run = RootRun("r1", "p1", T0)
    old, old_part = header_and_part("g1")
    _, pending = header_and_part("g9")
    client = FakeClient(
        feedback=[
            fb(REVIEW_KEY, "r1", value=old),
            fb(PART_KEY, "r1", value=old_part, id="old-part"),
            fb(PART_KEY, "r1", value=pending, id="pending-part"),
            fb(PART_KEY, "r1", value=None, id="dropped-part"),
        ]
    )
    LangSmithStore(client, write_concurrency=1).replace([run], entries_for(run))
    deleted = [c[1] for c in client.calls if c[0] == "delete"]
    assert deleted == [f"r1/{REVIEW_KEY}/{GRADER}", "old-part", "dropped-part"]
    assert "pending-part" in [f.id for f in client.feedback]


def test_a_regrade_tolerates_feedback_another_deleted_first():
    run = RootRun("r1", "p1", T0)
    client = FakeClient(feedback=[fb("cp_loss", "r1"), fb(STATUS_KEY, "r1")])
    client.list_feedback = lambda **kw: [
        fb("cp_loss", "r1", id="gone"),
        *FakeClient.list_feedback(client, **kw),
    ]
    LangSmithStore(client, write_concurrency=1).replace([run], entries_for(run))
    assert ("delete", "gone") in client.calls


class LateClient(FakeClient):
    """Lists what it stored only after `lag` more listings, as an ingest queue would."""

    def __init__(self, lag, **kw):
        super().__init__(**kw)
        self.lag = lag

    def list_feedback(self, *, run_ids, feedback_key):
        listed = super().list_feedback(run_ids=run_ids, feedback_key=feedback_key)
        self.lag -= 1
        new = {kw["feedback_id"] for kw in self.created}
        return [f for f in listed if f.id not in new] if self.lag >= 0 else listed


def test_replace_waits_for_feedback_langsmith_stores_late():
    run = RootRun("r1", "p1", T0)
    sleeps = []
    store = LangSmithStore(LateClient(3), write_concurrency=1, sleep=sleeps.append)
    store.replace([run], entries_for(run))
    assert sleeps == [1, 2]
    assert store.graded("r1") == GRADER_A.fingerprint


def test_replace_without_parts_checks_only_the_header():
    run = RootRun("r1", "p1", T0)
    client = FakeClient()
    LangSmithStore(client, write_concurrency=1).replace(
        [run], [Feedback(run, REVIEW_KEY, {}, value={"version": 1})]
    )
    assert [c[0] for c in client.calls] == ["list_feedback", "create", "list_feedback"]


def test_settle_clears_or_fails_this_graders_marks():
    runs = [RootRun("r0", "p1", T0), RootRun("r1", "p1", T0)]
    marks = [fb(STATUS_KEY, "r1"), fb(STATUS_KEY, "r1", grader="human"), fb(REVIEW_KEY, "r1")]
    client = FakeClient(feedback=marks)
    store = LangSmithStore(client)
    store.settle(runs, None)
    client.feedback = list(marks)
    store.settle(runs, "engine died")
    store.settle([], "engine died")
    ops = [c for c in client.calls if c[0] != "list_feedback"]
    assert ops == [
        ("delete", f"r1/{STATUS_KEY}/{GRADER}"),
        ("update", f"r1/{STATUS_KEY}/{GRADER}", {"value": FAILED, "comment": "engine died"}),
    ]
    assert [c[1] for c in client.calls if c[0] == "list_feedback"] == [["r0", "r1"]] * 2


# batch


class FakeStore:
    def __init__(self, games, marks=None, threads=()):
        self.games = games
        self.marks = marks or {}
        self.threads = list(threads)
        self.queries = []
        self.writes = []
        self.settled = []

    def find_threads(self, query):
        self.queries.append(query)
        return self.threads

    def agent_project(self, agent_id, environment):
        if environment == "staging":
            msg = "the agent has no 'staging' environment"
            raise LookupError(msg)
        return f"{agent_id}-{environment}"

    def thread_runs(self, project, thread_id):
        return self.games.get(thread_id, [])

    def graded(self, run_id):
        return self.marks.get(run_id)

    def replace(self, runs, entries):
        self.writes.append(([r.id for r in runs], [e.key for e in entries]))

    def settle(self, runs, failure):
        self.settled.append(([r.id for r in runs], failure))


class FakePool:
    def __init__(self, log, size, fail_on=None):
        self.log, self.size, self.fail_on = log, size, fail_on

    @property
    def grader(self):
        return GRADER_A

    async def analyse(self, fen):
        self.log.append(fen)
        await asyncio.sleep(0)
        if fen == self.fail_on:
            raise RuntimeError("engine died")
        board = chess.Board(fen)
        best = min(m.uci() for m in board.legal_moves)
        return Analysis((Line(Cp(0), (best,)),))


def fake_pools(log, sizes, fail_on=None):
    @contextlib.asynccontextmanager
    async def pools(size):
        sizes.append(size)
        yield FakePool(log, size, fail_on)

    return pools


def ticks():
    now = iter(range(100))
    return lambda: float(next(now))


async def test_a_batch_grades_each_position_once_and_writes_games_in_order():
    games = {"a": web_game("a", ITALIAN), "b": web_game("b", ITALIAN[:3]), "x": []}
    store, log, sizes, events = FakeStore(games), [], [], []
    summary = await grade_batch(
        Threads("proj", ("a", "b", "a", "x")),
        store,
        fake_pools(log, sizes),
        workers=4,
        report=events.append,
        clock=ticks(),
    )
    assert summary == Summary(graded=2, skipped=1, positions=6)
    assert len(log) == len(set(log)) == 6
    assert sizes == [1, 4]
    # b's positions are a prefix of a's, so either may finish first.
    assert sorted(w[0][-1] for w in store.writes) == ["a-r2", "b-r1"]
    assert all(w[1][-1] == REVIEW_KEY for w in store.writes)
    assert events[0] == Skipped("x", "no_game")
    planned = events[1]
    assert isinstance(planned, Planned)
    assert (planned.positions, planned.workers, planned.dry_run) == (6, 4, False)
    graded = [e for e in events if isinstance(e, Graded)]
    assert sorted(g.record.thread_id for g in graded) == ["a", "b"]
    assert graded[-1].positions_done == 6
    assert [g.elapsed_s for g in graded] == [1.0, 2.0]


async def test_a_project_batch_skips_graded_games_unless_forced():
    games = {"a": web_game("a", ITALIAN), "b": web_game("b", ITALIAN[:2])}
    marks = {"a-r2": GRADER_A.fingerprint, "b-r0": "stale"}
    query = ProjectQuery("proj", limit=5)
    store, events = FakeStore(games, marks, threads=["a", "b"]), []
    summary = await grade_batch(query, store, fake_pools([], []), workers=8, report=events.append)
    assert store.queries == [query]
    assert summary == Summary(graded=1, skipped=1, positions=3)
    assert events[0] == Skipped("a", "graded")
    assert events[1].workers == 3

    forced = FakeStore(games, marks, threads=["a", "b"])
    summary = await grade_batch(query, forced, fake_pools([], []), workers=8, force=True)
    assert summary.graded == 2


async def test_a_dry_run_writes_nothing():
    store, sizes, events = FakeStore({"a": web_game("a", ITALIAN)}), [], []
    summary = await grade_batch(
        Threads("proj", ("a",)),
        store,
        fake_pools([], sizes),
        workers=2,
        dry_run=True,
        report=events.append,
    )
    assert summary == Summary(graded=0, skipped=0, positions=0)
    assert sizes == [1]
    assert store.writes == []
    assert events[0].dry_run is True


async def test_nothing_to_do():
    store = FakeStore({"a": web_game("a", ITALIAN)}, {"a-r2": GRADER_A.fingerprint})
    sizes = []
    summary = await grade_batch(Threads("p", ("a",)), store, fake_pools([], sizes), workers=2)
    assert summary == Summary(graded=0, skipped=1, positions=0)
    assert sizes == [1]
    summary = await grade_batch(Threads("p", ("zz",)), store, fake_pools([], sizes), workers=2)
    assert summary == Summary(graded=0, skipped=1, positions=0)
    assert sizes == [1]


async def test_a_failure_keeps_the_games_already_written():
    games = {"a": web_game("a", ITALIAN[:2]), "b": web_game("b", ["d2d4", "d7d5"])}
    fail_on = game_record("b", games["b"]).positions[1].fen
    store = FakeStore(games)
    with pytest.raises(RuntimeError, match="engine died"):
        await grade_batch(Threads("p", ("a", "b")), store, fake_pools([], [], fail_on), workers=1)
    assert [w[0] for w in store.writes] == [["a-r0"]]


# the sandbox job


def test_verdicts_settle_each_ungraded_game():
    record = game_record("a", web_game("a", ITALIAN[:1]))
    events = [
        Skipped("x", "no_game"),
        Skipped("y", "graded"),
        Graded(record, _grade(record), 2, 2, 0.5),
    ]
    ids = ["a", "x", "y", "z", "z"]
    assert job.verdicts(ids, events, None) == {"x": job.NO_GAME, "y": None, "z": None}
    assert job.verdicts(ids, events, "log")["z"] == "log"


def job_run(store, pools, deleted, lines, threads=("a", "x")):
    async def batch(report):
        return await grade_batch(Threads("proj", threads), store, pools, workers=1, report=report)

    return job.sandbox_job(
        Threads("proj", threads),
        store,
        batch,
        echo=lines.append,
        delete_sandbox=lambda: deleted.append(True),
    )


async def test_a_sandbox_job_settles_the_marks_then_deletes_its_sandbox():
    store = FakeStore({"a": web_game("a", ITALIAN[:2])})
    deleted, lines = [], []
    summary = await job_run(store, fake_pools([], []), deleted, lines)
    assert summary == Summary(graded=1, skipped=1, positions=3)
    assert store.settled == [([], job.NO_GAME)]
    assert deleted == [True]
    assert lines[0] == "skip x: no game in its traces"


async def test_a_failed_sandbox_job_fails_the_unwritten_games_with_the_log_tail():
    games = {"a": web_game("a", ["d2d4", "d7d5"])}
    fail_on = game_record("a", games["a"]).positions[1].fen
    store = FakeStore(games)
    deleted, lines = [], []
    with pytest.raises(RuntimeError, match="engine died"):
        await job_run(store, fake_pools([], [], fail_on), deleted, lines, threads=("a",))
    [(runs, failure)] = store.settled
    assert runs == ["a-r0"]
    assert failure.startswith("grading 1 games, 3 positions")
    assert failure.endswith("RuntimeError: engine died")
    assert deleted == [True]


# options and output


def test_search_limit_options():
    assert cli.search_limit(None, None, None) == SearchLimit("depth", 16)
    assert cli.search_limit(None, 5000, None) == SearchLimit("nodes", 5000)
    with pytest.raises(cli.OptionError, match="pick one"):
        cli.search_limit(10, None, 100)


def test_metadata_pairs():
    assert cli.metadata_pairs(["surface=web", "note=a=b"]) == (("surface", "web"), ("note", "a=b"))
    for bad in ["surface", "=web"]:
        with pytest.raises(cli.OptionError, match="key=value"):
            cli.metadata_pairs([bad])


def test_thread_ids_from_flags_and_a_file(tmp_path):
    path = tmp_path / "threads.txt"
    path.write_text("# games\nb\n\n c  # the long one\n")
    assert cli.thread_ids(["a"], path) == ("a", "b", "c")
    assert cli.thread_ids(["a"], None) == ("a",)


def test_selection():
    local = datetime(2026, 9, 1, 9)
    assert cli.selection("p", ("a",), since=None, until=None, limit=None, metadata=()) == Threads(
        "p", ("a",)
    )
    query = cli.selection("p", (), since=local, until=T0, limit=3, metadata=(("k", "v"),))
    assert query.since.tzinfo is not None
    assert query.since == local.astimezone()
    assert query.until == T0
    with pytest.raises(cli.OptionError, match="LANGSMITH_AGENT_ENVIRONMENT"):
        cli.selection(None, ("a",), since=None, until=None, limit=None, metadata=())
    with pytest.raises(cli.OptionError, match="not --thread"):
        cli.selection("p", ("a",), since=None, until=None, limit=2, metadata=())


def test_printer_lines():
    record = game_record("a", web_game("a", ITALIAN[:1]))
    lines = []
    report = cli.printer(lines.append)
    report(Skipped("x", "no_game"))
    report(Skipped("y", "graded"))
    report(Planned(GRADER_A, (), 0, 1, False))
    report(Planned(GRADER_A, (record,), 2, 2, True))
    report(Planned(GRADER_A, (record,), 2, 2, False))
    report(Graded(record, _grade(record), 2, 2, 0.5))
    report(Graded(record, _grade(record), 0, 2, 0.0))
    assert lines[:3] == [
        "skip x: no game in its traces",
        "skip y: already graded with these settings (--force redoes it)",
        "nothing to grade",
    ]
    assert lines[3] == "would grade 1 games, 2 positions"
    assert lines[4] == "  engine: 2 x FakeFish 1 (depth 1, multipv 1, threads 1, hash_mb 256)"
    assert lines[5] == "  a: 1 ply"
    assert lines[6].startswith("grading 1 games, 2 positions on 2 x FakeFish 1")
    assert lines[7] == ("graded a: 1 ply, accuracy white 100.0 black - [2/2 positions, 4.0/s]")
    assert lines[8].endswith("[0/2 positions, 0.0/s]")


# the command


def test_grade_command_end_to_end(monkeypatch, tmp_path):
    games = {"a": web_game("a", ITALIAN)}
    store = FakeStore(games)
    monkeypatch.setattr(main, "make_client", lambda: "client")
    monkeypatch.setattr("langchain_chess_cli.grade.store.LangSmithStore", lambda client: store)
    engine = fake_engine(tmp_path)
    result = CliRunner().invoke(
        app,
        ["grade", "--project", "proj", "--thread", "a", "--engine", engine, "--depth", "1"],
    )
    assert result.exit_code == 0, result.output
    assert f"x {FAKE_ENGINE_NAME} (depth 1," in result.output
    assert "done: 1 graded, 0 skipped" in result.output
    assert store.writes[0][1][-1] == REVIEW_KEY

    result = CliRunner().invoke(
        app, ["grade", "--project", "proj", "--thread", "a", "--engine", engine, "--dry-run"]
    )
    assert result.exit_code == 0, result.output
    assert "done:" not in result.output


def test_grade_command_as_a_sandbox_job(monkeypatch, tmp_path):
    store = FakeStore({"a": web_game("a", ITALIAN)})
    deleted = []
    monkeypatch.setattr(main, "make_client", lambda: "client")
    monkeypatch.setattr("langchain_chess_cli.grade.store.LangSmithStore", lambda client: store)
    monkeypatch.setattr(main, "delete_own_sandbox", lambda echo: deleted.append(echo))
    args = ["grade", "--project", "proj", "--engine", fake_engine(tmp_path), "--depth", "1"]
    result = CliRunner().invoke(app, [*args, "--thread", "a", "--thread", "b", "--sandbox-job"])
    assert result.exit_code == 0, result.output
    assert "done: 1 graded, 1 skipped" in result.output
    assert store.settled == [([], job.NO_GAME)]
    assert len(deleted) == 1

    result = CliRunner().invoke(app, [*args, "--sandbox-job"])
    assert result.exit_code == 2
    assert "grades the games" in result.output


class FakeSandboxes:
    deleted: ClassVar[list[str]] = []
    fail = False

    def delete_sandbox(self, name):
        if self.fail:
            msg = "403 forbidden"
            raise RuntimeError(msg)
        self.deleted.append(name)


def test_delete_own_sandbox(monkeypatch):
    monkeypatch.setattr("langsmith.sandbox.SandboxClient", FakeSandboxes)
    lines = []
    monkeypatch.delenv("LANGSMITH_SANDBOX_NAME", raising=False)
    main.delete_own_sandbox(lines.append)
    monkeypatch.setenv("LANGSMITH_SANDBOX_NAME", "lcchess-grade-a")
    main.delete_own_sandbox(lines.append)
    assert FakeSandboxes.deleted == ["lcchess-grade-a"]
    monkeypatch.setattr(FakeSandboxes, "fail", True)
    main.delete_own_sandbox(lines.append)
    assert lines == [
        "not in a sandbox: nothing to delete",
        "could not delete sandbox lcchess-grade-a: 403 forbidden",
    ]


def test_grade_command_finds_the_project_from_the_agent_environment(monkeypatch, tmp_path):
    store = FakeStore({"a": web_game("a", ITALIAN)}, threads=["a"])
    monkeypatch.setattr(main, "make_client", lambda: "client")
    monkeypatch.setattr("langchain_chess_cli.grade.store.LangSmithStore", lambda client: store)
    monkeypatch.setenv("LANGSMITH_AGENT_ENVIRONMENT", "local")
    args = ["grade", "--engine", fake_engine(tmp_path), "--depth", "1", "--dry-run"]
    result = CliRunner().invoke(app, args)
    assert result.exit_code == 0, result.output
    assert store.queries[0].project == "langchain-chess-local"
    result = CliRunner().invoke(app, [*args, "--environment", "staging"])
    assert result.exit_code == 2
    assert "no 'staging' environment" in result.output


def test_grade_command_rejects_bad_options():
    result = CliRunner().invoke(app, ["grade", "--project", "p", "--depth", "3", "--nodes", "9"])
    assert result.exit_code == 2
    assert "pick one" in result.output


def test_make_client(monkeypatch):
    monkeypatch.setenv("LANGSMITH_API_KEY", "lsv2_test")
    from langsmith import Client

    assert isinstance(main.make_client(), Client)


def test_help_lists_grade():
    assert "grade" in CliRunner().invoke(app, ["--help"]).output
