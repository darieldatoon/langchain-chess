"""`lcchess-evals`: build and upload the positions dataset, run System 1 experiments."""

import asyncio
import json
import os
import subprocess
import tomllib
from pathlib import Path
from typing import Annotated, Any, cast

import typer
from langsmith import Client

from langchain_chess.engine import EngineConfig, SearchLimit
from langchain_chess_evals.positions.build import (
    ALL_MOVES_MULTIPV,
    DATASET,
    BuildConfig,
    BuildError,
    build,
)
from langchain_chess_evals.positions.sampling import Quotas
from langchain_chess_evals.positions.upload import UploadError, read_rows, upload
from langchain_chess_evals.systemone.experiment import (
    MAX_CONCURRENCY,
    ExperimentSpec,
    Finished,
    grid,
    ranker_settings,
    run_experiment,
)
from langchain_chess_evals.systemone.summary import headline_table
from langchain_chess_systemone.settings import load_file

ROOT = Path(__file__).resolve().parents[1]
POSITIONS_DIR = ROOT / "datasets" / "positions"
CACHE_DIR = ROOT / ".cache"
BASELINE = ROOT / "experiments" / "systemone-baseline.toml"

app = typer.Typer(no_args_is_help=True, add_completion=False)
positions = typer.Typer(no_args_is_help=True, help="The labelled positions dataset.")
systemone = typer.Typer(no_args_is_help=True, help="System 1 experiments.")
app.add_typer(positions, name="positions")
app.add_typer(systemone, name="systemone")


def say(message: str) -> None:
    typer.echo(message, err=True)


def git_sha() -> str:
    def git(*args: str) -> str:
        return subprocess.run(
            ["git", *args], cwd=ROOT, capture_output=True, text=True, check=True
        ).stdout.strip()

    sha = git("rev-parse", "HEAD")
    return f"{sha}-dirty" if git("status", "--porcelain") else sha


def langsmith_client() -> Client:
    return Client()


Version = Annotated[str, typer.Option(help="Dataset version: the file name and the tag.")]


@positions.command("build")
def build_command(
    version: Version = "v1",
    month: Annotated[str, typer.Option(help="The pinned Lichess month, YYYY-MM.")] = "2018-06",
    seed: int = 7,
    max_months: Annotated[int, typer.Option(help="Months to read before giving up.")] = 3,
    workers: Annotated[int, typer.Option(help="Stockfish processes, one thread each.")] = max(
        1, (os.cpu_count() or 2) - 1
    ),
    depth: int = 16,
    dev_per_band: int = 40,
    full_per_band: int = 400,
    stockfish: str = "stockfish",
) -> None:
    """Sample positions from a Lichess month and label every legal move. One-off."""
    config = BuildConfig(
        version=version,
        month=month,
        out_dir=POSITIONS_DIR,
        cache_dir=CACHE_DIR,
        seed=seed,
        max_months=max_months,
        workers=workers,
        quotas=Quotas({"dev": dev_per_band, "full": full_per_band}),
        engine=EngineConfig(
            path=stockfish, limit=SearchLimit("depth", depth), multipv=ALL_MOVES_MULTIPV
        ),
    )
    try:
        asyncio.run(build(config, git_sha=git_sha(), report=say))
    except BuildError as e:
        say(f"error: {e}")
        raise typer.Exit(1) from e


RendererUrl = Annotated[
    str | None,
    typer.Option(
        help="The web UI's render.html, e.g. "
        "https://darieldatoon.github.io/langchain-chess/render.html: draws experiment outputs "
        "as a board in LangSmith. Omitted leaves the dataset's setting as it is."
    ),
]


@positions.command("upload")
def upload_command(
    version: Version = "v1", dataset: str = DATASET, renderer_url: RendererUrl = None
) -> None:
    """Create or update the LangSmith dataset from the committed JSONL, tagged with its version."""
    rows = read_rows(POSITIONS_DIR / f"{version}.jsonl")
    manifest = json.loads((POSITIONS_DIR / f"{version}.manifest.json").read_text())
    try:
        done = upload(
            rows,
            manifest,
            langsmith_client(),
            dataset=dataset,
            tag=version,
            renderer_url=renderer_url,
            report=say,
        )
    except UploadError as e:
        say(f"error: {e}")
        raise typer.Exit(1) from e
    say(f"{dataset}@{done.tag}: {len(rows)} examples")


def _run(
    spec: ExperimentSpec, *, version: str, split: str, dataset: str, concurrency: int
) -> Finished:
    return asyncio.run(
        run_experiment(
            spec,
            client=langsmith_client(),
            dataset=dataset,
            tag=version,
            split=split,
            git_sha=git_sha(),
            runs_dir=CACHE_DIR / "runs",
            max_concurrency=concurrency,
            report=say,
        )
    )


def default_name(model: str, style: str, max_options: int | None) -> str:
    name = f"{model.rsplit('/', 1)[-1]}-{style}"
    return f"{name}-cap{max_options}" if max_options else name


Split = Annotated[str, typer.Option(help="dev (200 positions) or full (2,000).")]
Concurrency = Annotated[int, typer.Option(help="Rankings in flight at once.")]


@systemone.command("run")
def run_command(
    model: Annotated[
        str | None, typer.Option(help="typesafe/jev-latest or another TypeSafe classifier.")
    ] = None,
    style: Annotated[
        str | None, typer.Option(help="rich (default) or terse move descriptions.")
    ] = None,
    opponent: Annotated[
        Path | None,
        typer.Option(
            exists=True, dir_okay=False, help="An opponent settings file, instead of --model."
        ),
    ] = None,
    max_options: Annotated[int | None, typer.Option(help="Cap per Choice.")] = None,
    split: Split = "dev",
    version: Version = "v1",
    dataset: str = DATASET,
    name: Annotated[str | None, typer.Option(help="Experiment name suffix.")] = None,
    concurrency: Concurrency = MAX_CONCURRENCY,
) -> None:
    """One experiment."""
    if (model is None) == (opponent is None):
        say("error: give --model or --opponent")
        raise typer.Exit(2)
    ranker: dict[str, Any] = {"style": style or "rich"}
    if model is not None:
        ranker["model"] = model
    elif style is not None:
        say("error: --opponent sets the style; leave out --style")
        raise typer.Exit(2)
    else:
        try:
            ranker = ranker_settings(load_file(cast("Path", opponent)))
        except ValueError as e:
            say(f"error: {e}")
            raise typer.Exit(2) from e
    chosen: str = ranker["model"]
    described: str = ranker["style"]
    if described not in ("rich", "terse"):
        say("error: --style must be rich or terse")
        raise typer.Exit(2)
    spec = ExperimentSpec(
        name=name or default_name(chosen, described, max_options),
        model=chosen,
        style=described,
        max_options=max_options,
        with_eval=ranker.get("with_eval", False),
        with_nouls=ranker.get("with_nouls", False),
    )
    done = _run(spec, version=version, split=split, dataset=dataset, concurrency=concurrency)
    typer.echo(headline_table([(done.name, done.url, done.summary)]))


@systemone.command("baseline")
def baseline_command(
    config: Path = BASELINE,
    split: Split = "full",
    version: Version = "v1",
    dataset: str = DATASET,
    concurrency: Concurrency = MAX_CONCURRENCY,
) -> None:
    """Every experiment in the grid, one after another, then their headline table."""
    try:
        specs = grid(tomllib.loads(config.read_text()), config.parent)
    except ValueError as e:
        say(f"error: {e}")
        raise typer.Exit(2) from e
    finished = [
        _run(spec, version=version, split=split, dataset=dataset, concurrency=concurrency)
        for spec in specs
    ]
    typer.echo(headline_table([(f.spec.name, f.url, f.summary) for f in finished]))
