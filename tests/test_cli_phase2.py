import random
from pathlib import Path

import chess
import pytest
from typer.testing import CliRunner

from jev_chess import cli
from jev_chess.analysis import (
    JevRecord,
    LabelMove,
    OracleLabel,
    PositionRecord,
    RankedCandidate,
    read_jsonl,
    write_jsonl,
)
from jev_chess.cli import app
from jev_chess.engines import MaiaOpponent, Oracle
from jev_chess.policies import JevConfig, JevPolicy
from jev_chess.policies import jev as jev_module
from jev_chess.settings import EngineSettings
from tests.fake_jev import FakeClassifier, choice_response
from tests.fakes import FakeBackend, info

runner = CliRunner()
ITALIAN = "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4"


@pytest.fixture
def fake_policy(monkeypatch: pytest.MonkeyPatch) -> FakeClassifier:
    fake = FakeClassifier(
        scripted=choice_response({"e1g1": 0.5, "b1c3": 0.3, "d2d4": 0.2}, 0.6, eval_score=3.0)
    )
    monkeypatch.setattr(
        JevPolicy,
        "from_settings",
        classmethod(lambda cls, settings=None, config=None: JevPolicy(fake, config or JevConfig())),
    )
    return fake


def test_jev_command_prints_distribution(fake_policy: FakeClassifier) -> None:
    result = runner.invoke(app, ["jev", ITALIAN, "--top", "2", "--with-eval"])
    assert result.exit_code == 0, result.output
    assert "O-O" in result.output
    assert "0.500" in result.output
    assert "eval 3.0" in result.output
    assert "d2d4" not in result.output


def test_jev_command_rejects_bad_style(fake_policy: FakeClassifier) -> None:
    assert runner.invoke(app, ["jev", ITALIAN, "--style", "loud"]).exit_code != 0


class ScriptedMaia:
    def __init__(self, seed: int) -> None:
        self._rng = random.Random(seed)
        self.closed = False

    def play(self, board: chess.Board) -> chess.Move:
        return self._rng.choice(list(board.legal_moves))

    def close(self) -> None:
        self.closed = True


def test_sample_positions_command(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    opened: list[ScriptedMaia] = []

    def fake_open(cls: type, rating: int, weights_dir: Path, lc0_path: str | None) -> ScriptedMaia:
        engine = ScriptedMaia(rating)
        opened.append(engine)
        return engine

    monkeypatch.setattr(MaiaOpponent, "open", classmethod(fake_open))
    monkeypatch.setattr(cli, "EngineSettings", lambda: EngineSettings(_env_file=None))
    out = tmp_path / "positions.jsonl"
    result = runner.invoke(
        app, ["sample-positions", "--out", str(out), "--n", "6", "--per-game", "3", "--seed", "1"]
    )
    assert result.exit_code == 0, result.output
    records = list(read_jsonl(out, PositionRecord))
    assert len(records) == 6
    assert all(e.closed for e in opened)
    assert len(opened) <= 3


def test_label_positions_command(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    positions = tmp_path / "positions.jsonl"
    write_jsonl(
        positions,
        [
            PositionRecord(
                id=f"p{i}",
                fen=chess.STARTING_FEN,
                ply=10,
                phase="opening",
                game_id="g",
                white="1100",
                black="1100",
            )
            for i in range(3)
        ],
    )
    monkeypatch.setattr(cli, "EngineSettings", lambda: EngineSettings(_env_file=None))
    monkeypatch.setattr(
        Oracle,
        "open",
        classmethod(
            lambda cls, path, config: Oracle(
                FakeBackend(scripted_infos=[info("e2e4", cp=20)]), config
            )
        ),
    )
    out = tmp_path / "labels.jsonl"
    result = runner.invoke(
        app,
        [
            "label-positions",
            "--positions",
            str(positions),
            "--out",
            str(out),
            "--depth",
            "6",
            "--workers",
            "2",
        ],
    )
    assert result.exit_code == 0, result.output
    labels = list(read_jsonl(out, OracleLabel))
    assert [lab.id for lab in labels] == ["p0", "p1", "p2"]
    assert labels[0].depth == 6


def test_jev_rank_command(fake_policy: FakeClassifier, tmp_path: Path) -> None:
    positions = tmp_path / "positions.jsonl"
    write_jsonl(
        positions,
        [
            PositionRecord(
                id="p0",
                fen=ITALIAN,
                ply=10,
                phase="opening",
                game_id="g",
                white="1100",
                black="1100",
            )
        ],
    )
    out = tmp_path / "jev.jsonl"
    result = runner.invoke(
        app,
        [
            "jev-rank",
            "--positions",
            str(positions),
            "--out",
            str(out),
            "--style",
            "terse",
            "--concurrency",
            "2",
        ],
    )
    assert result.exit_code == 0, result.output
    records = list(read_jsonl(out, JevRecord))
    assert records[0].candidates[0].uci == "e1g1"
    assert records[0].style == "terse"


def test_recall_report_command(tmp_path: Path) -> None:
    positions = tmp_path / "p.jsonl"
    labels = tmp_path / "l.jsonl"
    rankings = tmp_path / "r.jsonl"
    write_jsonl(
        positions,
        [
            PositionRecord(
                id="a",
                fen=chess.STARTING_FEN,
                ply=10,
                phase="opening",
                game_id="g",
                white="1100",
                black="1100",
            )
        ],
    )
    write_jsonl(
        labels,
        [
            OracleLabel(
                id="a",
                depth=16,
                ranked=[
                    LabelMove(uci="e2e4", cp=30, mate=None),
                    LabelMove(uci="d2d4", cp=20, mate=None),
                ],
            )
        ],
    )
    write_jsonl(
        rankings,
        [
            JevRecord(
                id="a",
                model="jev-test",
                style="rich",
                candidates=[
                    RankedCandidate(uci="d2d4", probability=0.6),
                    RankedCandidate(uci="e2e4", probability=0.4),
                ],
                confidence=0.55,
                input_tokens=100,
                output_tokens=10,
                latency_ms=200.0,
            )
        ],
    )
    result = runner.invoke(
        app,
        [
            "recall-report",
            "--positions",
            str(positions),
            "--labels",
            str(labels),
            "--rankings",
            str(rankings),
            "--k",
            "1,2",
        ],
    )
    assert result.exit_code == 0, result.output
    assert "1 positions" in result.output
    assert "100.0%" in result.output  # recall@2
    assert "mean 10 cp, median 10 cp" in result.output
    assert (
        runner.invoke(
            app,
            [
                "recall-report",
                "--positions",
                str(positions),
                "--labels",
                str(labels),
                "--rankings",
                str(rankings),
                "--k",
                "x",
            ],
        ).exit_code
        != 0
    )
    assert (
        runner.invoke(
            app,
            [
                "recall-report",
                "--positions",
                str(positions),
                "--labels",
                str(labels),
                "--rankings",
                str(rankings),
                "--k",
                "0",
            ],
        ).exit_code
        != 0
    )


def test_jev_module_exports_typesafe_classifier() -> None:
    assert jev_module.TypeSafeClassifier is not None


def test_jev_command_prints_nouls(monkeypatch: pytest.MonkeyPatch) -> None:
    from langchain_typesafe.types import NoulAnswer

    response = choice_response({"e1g1": 0.5, "b1c3": 0.5}, 0.6, eval_score=3.0)
    response.answers["needs_calculation"] = NoulAnswer(type="noul", noul=0.25)
    response.answers["tactics_present"] = NoulAnswer(type="noul", noul=0.75)
    fake = FakeClassifier(scripted=response)
    monkeypatch.setattr(
        JevPolicy,
        "from_settings",
        classmethod(lambda cls, settings=None, config=None: JevPolicy(fake, config)),
    )
    result = runner.invoke(app, ["jev", ITALIAN, "--with-eval", "--with-nouls"])
    assert result.exit_code == 0, result.output
    assert "needs_calculation 0.25" in result.output
    assert "tactics_present 0.75" in result.output
    assert set(fake.requests[0]["questions"]) == {
        "move",
        "eval",
        "needs_calculation",
        "tactics_present",
    }


def test_jev_rank_command_passes_flags(fake_policy: FakeClassifier, tmp_path: Path) -> None:
    positions = tmp_path / "positions.jsonl"
    write_jsonl(
        positions,
        [
            PositionRecord(
                id="p0",
                fen=ITALIAN,
                ply=10,
                phase="opening",
                game_id="g",
                white="1100",
                black="1100",
            )
        ],
    )
    out = tmp_path / "jev.jsonl"
    result = runner.invoke(
        app,
        [
            "jev-rank",
            "--positions",
            str(positions),
            "--out",
            str(out),
            "--with-eval",
            "--with-nouls",
        ],
    )
    assert result.exit_code == 0, result.output
    assert set(fake_policy.requests[0]["questions"]) >= {"eval", "needs_calculation"}
    assert next(iter(read_jsonl(out, JevRecord))).eval_score == 3.0


def test_recall_report_prints_score_gate_and_tactics_tables(tmp_path: Path) -> None:
    positions = tmp_path / "p.jsonl"
    labels = tmp_path / "l.jsonl"
    rankings = tmp_path / "r.jsonl"
    write_jsonl(
        positions,
        [
            PositionRecord(
                id="a", fen=ITALIAN, ply=10, phase="opening", game_id="g", white="1", black="1"
            )
        ],
    )
    write_jsonl(
        labels,
        [
            OracleLabel(
                id="a",
                depth=16,
                ranked=[
                    LabelMove(uci="f3e5", cp=30, mate=None),
                    LabelMove(uci="d2d3", cp=20, mate=None),
                ],
            )
        ],
    )
    write_jsonl(
        rankings,
        [
            JevRecord(
                id="a",
                model="jev-test",
                style="rich",
                candidates=[
                    RankedCandidate(uci="f3e5", probability=0.9),
                    RankedCandidate(uci="d2d3", probability=0.1),
                ],
                confidence=0.95,
                input_tokens=100,
                output_tokens=10,
                latency_ms=200.0,
                eval_score=3.1,
                needs_calculation=0.2,
                tactics_present=0.8,
            )
        ],
    )
    result = runner.invoke(
        app,
        [
            "recall-report",
            "--positions",
            str(positions),
            "--labels",
            str(labels),
            "--rankings",
            str(rankings),
        ],
        env={"COLUMNS": "200"},  # rich wraps table cells at the 80-column test default
    )
    assert result.exit_code == 0, result.output
    assert "Score vs Stockfish rung" in result.output
    assert "exact 100.0%" in result.output
    assert "1 - needs_calculation" in result.output
    assert "tactic truly present" in result.output


def test_jev_rank_resumes_and_appends(fake_policy: FakeClassifier, tmp_path: Path) -> None:
    positions = tmp_path / "positions.jsonl"
    write_jsonl(
        positions,
        [
            PositionRecord(
                id=f"p{i}", fen=ITALIAN, ply=10, phase="opening", game_id="g", white="1", black="1"
            )
            for i in range(3)
        ],
    )
    out = tmp_path / "jev.jsonl"
    write_jsonl(
        out,
        [
            JevRecord(
                id="p1",
                model="old",
                style="rich",
                candidates=[RankedCandidate(uci="e1g1", probability=1.0)],
                confidence=1.0,
                input_tokens=1,
                output_tokens=1,
                latency_ms=1.0,
            )
        ],
    )
    result = runner.invoke(app, ["jev-rank", "--positions", str(positions), "--out", str(out)])
    assert result.exit_code == 0, result.output
    assert "2 new rankings appended" in result.output
    assert "(1 were already done)" in result.output
    records = list(read_jsonl(out, JevRecord))
    assert sorted(r.id for r in records) == ["p0", "p1", "p2"]
    assert next(r for r in records if r.id == "p1").model == "old"
    assert len(fake_policy.requests) == 2
