import json
import tomllib
from pathlib import Path
from types import SimpleNamespace

import chess
import pytest

from langchain_chess.grading import Cp
from langchain_chess_evals.positions.examples import Reference, Row
from langchain_chess_evals.systemone.experiment import (
    ExperimentSpec,
    default_ranker,
    grid,
    run_experiment,
    summary_evaluator,
    systemone_row,
)
from langchain_chess_evals.testing import FakeDatasetClient
from langchain_chess_systemone.testing import FakeRanker, by_option_order, distribution

BASELINE = Path(__file__).parents[2] / "experiments" / "systemone-baseline.toml"


def test_the_baseline_grid():
    specs = grid(tomllib.loads(BASELINE.read_text()), BASELINE.parent)
    assert [(s.model, s.style, s.max_options) for s in specs] == [
        ("typesafe/jev-latest", "rich", None),
        ("typesafe/jev-latest", "terse", None),
        ("typesafe/jev-latest", "rich", 16),
    ]
    with pytest.raises(ValueError, match="style must be"):
        grid({"experiment": [{"name": "x", "model": "m", "style": "loud"}]})


def test_an_entry_may_name_an_opponent_file(tmp_path):
    (tmp_path / "jev.json").write_text('{"version": 2, "systemone_model": "typesafe/jev-latest"}')
    entry = {"name": "jev", "opponent": "jev.json", "max_options": 8}
    (spec,) = grid({"experiment": [entry]}, tmp_path)
    assert (spec.model, spec.style, spec.max_options) == ("typesafe/jev-latest", "rich", 8)
    assert (spec.with_eval, spec.with_nouls) == (False, False)
    ranker = default_ranker(ExperimentSpec("x", "typesafe/jev-latest", with_eval=True))
    assert ranker.with_eval
    with pytest.raises(ValueError, match="not both"):
        grid({"experiment": [{**entry, "style": "terse"}]}, tmp_path)
    with pytest.raises(ValueError, match="can't read settings"):
        grid({"experiment": [{**entry, "opponent": "missing.json"}]}, tmp_path)


def test_default_ranker_takes_the_spec():
    ranker = default_ranker(ExperimentSpec("x", "typesafe/jev-latest", "terse", 16))
    assert (ranker.model, ranker.style, ranker.max_options) == ("typesafe/jev-latest", "terse", 16)
    assert default_ranker(ExperimentSpec("y", "typesafe/jev-latest")).max_options == 255
    assert ranker.max_attempts == 30


def row(index: int, split: str) -> Row:
    return Row(
        id=f"g{index}-010",
        split=split,
        start_fen=chess.STARTING_FEN,
        moves=(),
        legal=("e2e4", "d2d4", "g1f3"),
        reference=Reference({"d2d4": Cp(40), "e2e4": Cp(30), "g1f3": Cp(0)}),
        metadata={
            "band": "1600-1999",
            "phase": "opening",
            "legal_count": 3,
            "played_move": "e2e4",
        },
    )


def client() -> FakeDatasetClient:
    fake = FakeDatasetClient()
    for index, split in enumerate(("dev", "dev", "full")):
        example = row(index, split).example()
        fake.examples[example["id"]] = fake._stored(example)
    return fake


def comparison_url(url):
    async def get():
        return url

    return get


async def fake_evaluate(target, /, *, data, evaluators, summary_evaluators, **kwargs):
    runs = [SimpleNamespace(outputs=await target(example.inputs)) for example in data]
    runs.append(SimpleNamespace(outputs=None))
    examples = [*data, data[0]]
    feedback = [evaluators[0](r, e) for r, e in zip(runs[:-1], examples, strict=False)]
    for evaluate in summary_evaluators:
        evaluate(runs, examples)
    return SimpleNamespace(
        experiment_name=f"{kwargs['experiment_prefix']}-1234",
        get_comparison_url=comparison_url("https://smith/compare"),
        feedback=feedback,
        kwargs=kwargs,
    )


async def test_run_experiment(tmp_path):
    ranker = FakeRanker(lambda r: distribution(by_option_order("move", list(r.options))))
    notes: list[str] = []
    captured = {}

    async def evaluate(target, /, **kwargs):
        captured["result"] = await fake_evaluate(target, **kwargs)
        return captured["result"]

    done = await run_experiment(
        ExperimentSpec("jev-rich", "typesafe/jev-latest"),
        client=client(),
        dataset="d",
        tag="v1",
        split="dev",
        git_sha="abc",
        runs_dir=tmp_path,
        rankers=lambda spec: ranker,
        evaluate=evaluate,
        report=notes.append,
    )
    assert len(ranker.requests) == 2
    assert done.name == "systemone-jev-rich-1234"
    assert done.summary["recall@1|all"] == 0.0
    assert done.summary["human_match@1|all"] == 1.0
    kwargs = captured["result"].kwargs
    assert kwargs["metadata"] == {
        "eval": "systemone",
        "model": "typesafe/jev-latest",
        "style": "rich",
        "max_options": 16,
        "with_eval": False,
        "with_nouls": False,
        "dataset": "d",
        "dataset_version": "v1",
        "split": "dev",
        "git_sha": "abc",
    }
    assert kwargs["max_concurrency"] == 4
    assert "weigh every rating band and phase" in kwargs["description"]
    feedback = captured["result"].feedback[0]["results"]
    assert {"key": "recall@3", "score": 1.0} in feedback
    assert all(f["key"] != "finalist_recall" for f in feedback)
    record = json.loads((tmp_path / f"{done.name}.json").read_text())
    assert record["url"] == "https://smith/compare"
    assert record["summary"]["n|all"] == 2.0
    assert notes[0] == "jev-rich: 2 examples from d@v1, split dev"


async def test_run_experiment_requires_a_summary(tmp_path):
    async def no_summary(target, /, **kwargs):
        return SimpleNamespace(experiment_name="e")

    with pytest.raises(RuntimeError, match="summary evaluator didn't run"):
        await run_experiment(
            ExperimentSpec("x", "typesafe/jev-latest"),
            client=client(),
            dataset="d",
            tag="v1",
            split="full",
            git_sha="abc",
            runs_dir=tmp_path,
            rankers=lambda spec: FakeRanker([]),
            evaluate=no_summary,
        )


def test_evaluators_skip_scores_that_do_not_apply():
    example = next(iter(client().examples.values()))
    run = SimpleNamespace(
        outputs={
            "ranked": [],
            "finalists": None,
            "error": "down",
            "requests": 1,
            "latency_ms": 5.0,
            "input_tokens": None,
            "margin": None,
            "confidence": None,
        }
    )
    keys = {r["key"] for r in systemone_row(run, example)["results"]}
    assert "cp_loss" not in keys
    assert "error" in keys
    sink = []
    summary_evaluator(sink.append)([run], [example])
    assert sink[0]["error|all"] == 1.0
