import asyncio
import contextlib
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import ClassVar

import chess
import click
import pytest
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
    REVIEW_KEY,
    STATUS_KEY,
    Feedback,
    RootRun,
    feedback,
    game_record,
    review,
    source_info,
)
from langchain_chess_cli.grade.store import LangSmithStore, ProjectQuery, run_filter
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
    entries = feedback(record, _grade(record), GRADER_A)
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
        ("t-r1", REVIEW_KEY),
    ]
    assert entries[0].value == "good"
    assert entries[0].source_info == {**source_info(GRADER_A), "ply": 1}
    assert entries[-1].source_info["grader"] == GRADER
    assert entries[-1].source_info["fingerprint"] == GRADER_A.fingerprint


def test_a_side_that_never_moved_gets_no_accuracy():
    record = game_record("t", web_game("t", ITALIAN[:1]))
    keys = [e.key for e in feedback(record, _grade(record), GRADER_A)]
    assert keys == ["accuracy_white", REVIEW_KEY]


def test_the_review_holds_what_the_app_draws():
    record = game_record("t", web_game("t", ITALIAN[:2]))
    value = review(record, _grade(record), GRADER_A)
    assert value["version"] == 1
    assert value["engine"] == "FakeFish 1"
    assert value["accuracy"] == {"white": 100.0, "black": 100.0}
    assert value["evals"] == [{"cp": 0}] * 3
    assert value["plies"][0] == {
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
    single = review(one, _grade(one), GRADER_A)
    assert single["accuracy"] == {"white": 100.0, "black": None}


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


def fb(key, run_id, grader=GRADER, fingerprint="f1"):
    source = SimpleNamespace(metadata={"grader": grader, "fingerprint": fingerprint})
    return SimpleNamespace(
        id=f"{run_id}/{key}/{grader}", key=key, run_id=run_id, feedback_source=source
    )


class FakeClient:
    def __init__(self, runs=(), feedback=()):
        self.runs = list(runs)
        self.feedback = list(feedback)
        self.calls = []

    def list_runs(self, **kw):
        self.calls.append(("list_runs", kw))
        return iter(self.runs)

    def list_feedback(self, *, run_ids, feedback_key):
        self.calls.append(("list_feedback", run_ids, feedback_key))
        return [f for f in self.feedback if f.run_id in run_ids and f.key in feedback_key]

    def delete_feedback(self, feedback_id):
        self.calls.append(("delete", feedback_id))

    def update_feedback(self, feedback_id, **kw):
        self.calls.append(("update", feedback_id, kw))

    def create_feedback(self, run_id, **kw):
        self.calls.append(("create", run_id, kw["key"], kw["session_id"]))


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


def test_thread_runs():
    run = SimpleNamespace(id="r1", session_id="p1", start_time=T0, outputs={"moves": []})
    client = FakeClient([run])
    assert LangSmithStore(client).thread_runs("proj", "t1") == [
        RootRun("r1", "p1", T0, {"moves": []})
    ]
    assert '"t1"' in client.calls[0][1]["filter"]


def test_graded_reads_only_this_graders_review():
    client = FakeClient(feedback=[fb(REVIEW_KEY, "r1", grader="someone"), fb(REVIEW_KEY, "r1")])
    store = LangSmithStore(client)
    assert store.graded("r1") == "f1"
    assert store.graded("r2") is None
    client.feedback[1].feedback_source = None
    assert store.graded("r1") is None


def test_replace_drops_this_graders_feedback_and_writes_the_marker_last():
    run = RootRun("r1", "p1", T0)
    client = FakeClient(
        feedback=[fb("cp_loss", "r1"), fb("cp_loss", "r1", grader="human"), fb(REVIEW_KEY, "r0")]
    )
    entries = [Feedback(run, k, {}) for k in ("cp_loss", "best_move", REVIEW_KEY)]
    LangSmithStore(client, write_concurrency=1).replace([run, RootRun("r0", "p1", T0)], entries)
    ops = [c for c in client.calls if c[0] != "list_feedback"]
    assert ops[:2] == [("delete", f"r0/{REVIEW_KEY}/{GRADER}"), ("delete", f"r1/cp_loss/{GRADER}")]
    assert ops[2:] == [
        ("create", "r1", "cp_loss", "p1"),
        ("create", "r1", "best_move", "p1"),
        ("create", "r1", REVIEW_KEY, "p1"),
    ]


def test_replace_clears_the_apps_mark_once_the_game_reads_as_graded():
    run = RootRun("r1", "p1", T0)
    client = FakeClient(feedback=[fb(STATUS_KEY, "r1"), fb(STATUS_KEY, "r1", grader="human")])
    LangSmithStore(client, write_concurrency=1).replace([run], [Feedback(run, REVIEW_KEY, {})])
    ops = [c for c in client.calls if c[0] != "list_feedback"]
    assert ops == [("create", "r1", REVIEW_KEY, "p1"), ("delete", f"r1/{STATUS_KEY}/{GRADER}")]


def test_settle_clears_or_fails_this_graders_marks():
    runs = [RootRun("r0", "p1", T0), RootRun("r1", "p1", T0)]
    marks = [fb(STATUS_KEY, "r1"), fb(STATUS_KEY, "r1", grader="human"), fb(REVIEW_KEY, "r1")]
    client = FakeClient(feedback=marks)
    store = LangSmithStore(client)
    store.settle(runs, None)
    store.settle(runs, "engine died")
    store.settle([], "engine died")
    ops = [c for c in client.calls if c[0] != "list_feedback"]
    assert ops == [
        ("delete", f"r1/{STATUS_KEY}/{GRADER}"),
        ("update", f"r1/{STATUS_KEY}/{GRADER}", {"value": FAILED, "comment": "engine died"}),
    ]
    assert [c[1] for c in client.calls if c[0] == "list_feedback"] == [["r0", "r1"]] * 2


class FlakyClient(FakeClient):
    """Deletes for real, but fails deleting the feedback keyed `broken`."""

    def __init__(self, broken, feedback):
        super().__init__(feedback=feedback)
        self.broken = broken

    def delete_feedback(self, feedback_id):
        if feedback_id.split("/")[1] == self.broken:
            msg = "delete failed"
            raise RuntimeError(msg)
        super().delete_feedback(feedback_id)
        self.feedback = [f for f in self.feedback if f.id != feedback_id]


@pytest.mark.parametrize(
    ("broken", "graded", "left"), [(REVIEW_KEY, "f1", 2), ("cp_loss", None, 1)]
)
def test_a_failed_delete_never_leaves_a_partial_game_marked_graded(broken, graded, left):
    run = RootRun("r1", "p1", T0)
    client = FlakyClient(broken, [fb("cp_loss", "r1"), fb(REVIEW_KEY, "r1")])
    store = LangSmithStore(client, write_concurrency=1)
    with pytest.raises(RuntimeError, match="delete failed"):
        store.replace([run], [Feedback(run, k, {}) for k in ("cp_loss", REVIEW_KEY)])
    assert store.graded("r1") == graded
    assert len(client.feedback) == left
    assert not any(c[0] == "create" for c in client.calls)


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
    with pytest.raises(cli.OptionError, match="LANGSMITH_PROJECT"):
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
    assert "grades the games" in click.unstyle(result.output)


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
