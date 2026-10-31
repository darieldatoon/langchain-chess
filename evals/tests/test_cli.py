import json
import re

import pytest
from typer.testing import CliRunner

from langchain_chess_evals import cli
from langchain_chess_evals.positions.build import BuildError
from langchain_chess_evals.positions.upload import UploadError
from langchain_chess_evals.systemone.experiment import Finished
from langchain_chess_evals.testing import FakeDatasetClient

runner = CliRunner()


@pytest.fixture
def dirs(tmp_path, monkeypatch):
    monkeypatch.setattr(cli, "POSITIONS_DIR", tmp_path / "positions")
    monkeypatch.setattr(cli, "CACHE_DIR", tmp_path / "cache")
    monkeypatch.setattr(cli, "git_sha", lambda: "abc")
    return tmp_path


def test_git_sha_names_the_checkout():
    assert re.fullmatch(r"[0-9a-f]{40}(-dirty)?", cli.git_sha())


def test_langsmith_client(monkeypatch):
    monkeypatch.setenv("LANGSMITH_API_KEY", "lsv2_test")
    assert cli.langsmith_client() is not None


def test_build(dirs, monkeypatch):
    seen = {}

    async def fake_build(config, *, git_sha, report):
        seen.update(config=config, git_sha=git_sha)
        report("sampled")

    monkeypatch.setattr(cli, "build", fake_build)
    result = runner.invoke(cli.app, ["positions", "build", "--workers", "2", "--depth", "12"])
    assert result.exit_code == 0, result.output
    config = seen["config"]
    assert (config.version, config.month, config.workers) == ("v1", "2018-06", 2)
    assert config.engine.settings()["depth"] == 12
    assert config.quotas.json() == {"dev": 40, "full": 400}
    assert config.out_dir == dirs / "positions"
    assert seen["git_sha"] == "abc"


def test_build_error_exits_cleanly(dirs, monkeypatch):
    async def failing(config, *, git_sha, report):
        raise BuildError("v1.jsonl exists")

    monkeypatch.setattr(cli, "build", failing)
    result = runner.invoke(cli.app, ["positions", "build"])
    assert result.exit_code == 1
    assert "error: v1.jsonl exists" in result.output


def test_upload(dirs, monkeypatch):
    positions = dirs / "positions"
    positions.mkdir()
    (positions / "v1.jsonl").write_text("")
    (positions / "v1.manifest.json").write_text(json.dumps({"rows": 0}))
    client = FakeDatasetClient()
    seen = {}

    def fake_upload(rows, manifest, client_, *, dataset, tag, renderer_url, report):
        seen.update(
            rows=rows,
            manifest=manifest,
            client=client_,
            dataset=dataset,
            tag=tag,
            renderer_url=renderer_url,
        )
        return type("Done", (), {"tag": tag})()

    monkeypatch.setattr(cli, "langsmith_client", lambda: client)
    monkeypatch.setattr(cli, "upload", fake_upload)
    result = runner.invoke(cli.app, ["positions", "upload"])
    assert result.exit_code == 0, result.output
    assert seen == {
        "rows": (),
        "manifest": {"rows": 0},
        "client": client,
        "dataset": "langchain-chess-positions",
        "tag": "v1",
        "renderer_url": None,
    }
    assert "langchain-chess-positions@v1: 0 examples" in result.output

    url = "https://chess.example.com/ui/render.html"
    result = runner.invoke(cli.app, ["positions", "upload", "--renderer-url", url])
    assert result.exit_code == 0, result.output
    assert seen["renderer_url"] == url


@pytest.fixture
def experiments(dirs, monkeypatch):
    specs = []

    async def fake_run(spec, **kwargs):
        specs.append((spec, kwargs))
        return Finished(spec, f"systemone-{spec.name}-1", "https://smith/x", {"recall@1|all": 0.25})

    monkeypatch.setattr(cli, "langsmith_client", FakeDatasetClient)
    monkeypatch.setattr(cli, "run_experiment", fake_run)
    return specs


def test_run(experiments, dirs):
    result = runner.invoke(
        cli.app,
        [
            "systemone",
            "run",
            "--model",
            "typesafe/jev-latest",
            "--style",
            "terse",
            "--max-options",
            "16",
        ],
    )
    assert result.exit_code == 0, result.output
    spec, kwargs = experiments[0]
    assert (spec.name, spec.model, spec.style, spec.max_options) == (
        "jev-latest-terse-cap16",
        "typesafe/jev-latest",
        "terse",
        16,
    )
    assert (kwargs["split"], kwargs["tag"], kwargs["git_sha"]) == ("dev", "v1", "abc")
    assert kwargs["max_concurrency"] == 4
    assert kwargs["runs_dir"] == dirs / "cache" / "runs"
    assert "[systemone-jev-latest-terse-cap16-1](https://smith/x) | 25.0% |" in result.output


def test_run_an_opponent_file(experiments, tmp_path):
    opponent = tmp_path / "jev.json"
    jev = {"version": 2, "systemone_model": "typesafe/jev-latest", "style": "terse"}
    opponent.write_text(json.dumps(jev))
    result = runner.invoke(cli.app, ["systemone", "run", "--opponent", str(opponent)])
    assert result.exit_code == 0, result.output
    spec, _ = experiments[0]
    assert (spec.name, spec.model, spec.style) == (
        "jev-latest-terse",
        "typesafe/jev-latest",
        "terse",
    )
    both = ["systemone", "run", "--opponent", str(opponent), "--model", "m"]
    assert runner.invoke(cli.app, both).exit_code == 2
    styled = ["systemone", "run", "--opponent", str(opponent), "--style", "rich"]
    assert "leave out --style" in runner.invoke(cli.app, styled).output
    opponent.write_text(json.dumps({**jev, "with_nouls": True}))
    assert runner.invoke(cli.app, ["systemone", "run", "--opponent", str(opponent)]).exit_code == 0
    assert experiments[-1][0].with_nouls is True
    assert runner.invoke(cli.app, ["systemone", "run"]).exit_code == 2
    opponent.write_text('{"k": 3}')
    assert runner.invoke(cli.app, ["systemone", "run", "--opponent", str(opponent)]).exit_code == 2


def test_run_rejects_an_unknown_style(experiments):
    result = runner.invoke(cli.app, ["systemone", "run", "--model", "m", "--style", "loud"])
    assert result.exit_code == 2
    assert experiments == []


def test_default_name():
    assert cli.default_name("typesafe/jev-latest", "rich", None) == "jev-latest-rich"


def test_baseline(experiments):
    result = runner.invoke(cli.app, ["systemone", "baseline", "--split", "dev"])
    assert result.exit_code == 0, result.output
    assert [s.name for s, _ in experiments] == [
        "jev-rich",
        "jev-terse",
        "luna-rich",
        "jev-rich-cap16",
    ]
    assert result.output.count("https://smith/x") == 4


def test_upload_error_exits_cleanly(dirs, monkeypatch):
    positions = dirs / "positions"
    positions.mkdir()
    (positions / "v1.jsonl").write_text("")
    (positions / "v1.manifest.json").write_text("{}")

    def refused(*args, **kwargs):
        raise UploadError("dataset d has other inputs or outputs schemas")

    monkeypatch.setattr(cli, "langsmith_client", FakeDatasetClient)
    monkeypatch.setattr(cli, "upload", refused)
    result = runner.invoke(cli.app, ["positions", "upload"])
    assert result.exit_code == 1
    assert "error: dataset d has other" in result.output


def test_baseline_reports_a_bad_grid(experiments, tmp_path):
    grid_file = tmp_path / "grid.toml"
    grid_file.write_text('[[experiment]]\nname = "x"\nopponent = "missing.json"\n')
    result = runner.invoke(cli.app, ["systemone", "baseline", "--config", str(grid_file)])
    assert result.exit_code == 2
    assert "can't read settings" in result.output
