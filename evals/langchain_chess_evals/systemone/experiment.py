"""One System 1 experiment over the positions dataset with `aevaluate`, or a grid of them."""

import json
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Protocol, cast

from langsmith import aevaluate
from langsmith.schemas import Example, Run

from langchain_chess_evals.positions.examples import Reference
from langchain_chess_evals.systemone.scoring import row_scores
from langchain_chess_evals.systemone.summary import Scored, Summary, summarize
from langchain_chess_evals.systemone.target import make_target
from langchain_chess_systemone import GatewayRanker, Ranker
from langchain_chess_systemone.describe import DescriptionStyle
from langchain_chess_systemone.settings import ChessContext, load_file

# The gateway capped SemIf at about 70 rankings a minute, then refused everything for 40 s or
# more, with no Retry-After, and may do the same to any classifier. Retry for up to ~2 minutes
# (backoff caps at 4 s): a rate limit is not a ranking failure and must not score as a miss.
MAX_CONCURRENCY = 4
MAX_ATTEMPTS = 30
STYLES: tuple[DescriptionStyle, ...] = ("rich", "terse")


@dataclass(frozen=True, slots=True)
class ExperimentSpec:
    name: str
    model: str
    style: DescriptionStyle = "rich"
    max_options: int | None = None
    """None is the model's own cap."""
    with_eval: bool = False
    with_nouls: bool = False


def grid(config: Mapping[str, Any], base: Path = Path()) -> tuple[ExperimentSpec, ...]:
    """`[[experiment]]` tables from a TOML file.

    An entry names System 1 with `model` and `style`, or with `opponent`, an opponent settings
    file relative to `base` (the TOML's directory); the eval-only controls stay in the entry.
    """
    specs = []
    for table in config["experiment"]:
        entry: dict[str, Any] = dict(table)
        if "opponent" in entry:
            if {"model", "style"} & set(entry):
                msg = f"experiment {entry['name']!r}: give `opponent` or `model`/`style`, not both"
                raise ValueError(msg)
            opponent = load_file(base / entry["opponent"])
            entry = {**entry, **ranker_settings(opponent)}
        style = entry.get("style", "rich")
        if style not in STYLES:
            msg = f"experiment {entry['name']!r}: style must be one of {STYLES}"
            raise ValueError(msg)
        specs.append(
            ExperimentSpec(
                name=entry["name"],
                model=entry["model"],
                style=style,
                max_options=entry.get("max_options"),
                with_eval=entry.get("with_eval", False),
                with_nouls=entry.get("with_nouls", False),
            )
        )
    return tuple(specs)


def ranker_settings(opponent: ChessContext) -> dict[str, Any]:
    """What an opponent file sets of System 1's ranker; its gate, the LLM and the rules don't
    apply to ranking alone."""
    return {
        "model": opponent.systemone_model,
        "style": opponent.style,
        "with_eval": opponent.with_eval,
        "with_nouls": opponent.with_nouls,
    }


def default_ranker(spec: ExperimentSpec) -> GatewayRanker:
    return GatewayRanker(
        spec.model,
        style=spec.style,
        max_options=spec.max_options,
        max_attempts=MAX_ATTEMPTS,
        with_eval=spec.with_eval,
        with_nouls=spec.with_nouls,
    )


def scored(
    inputs: Mapping[str, Any],
    outputs: Mapping[str, Any],
    reference_outputs: Mapping[str, Any],
    metadata: Mapping[str, Any],
) -> Scored:
    reference = Reference.from_json(reference_outputs)
    return Scored(
        scores=row_scores(inputs, outputs, reference, metadata["played_move"]),
        band=metadata["band"],
        phase=metadata["phase"],
        legal_count=metadata["legal_count"],
        signals={"margin": outputs["margin"], "confidence": outputs["confidence"]},
    )


def _results(scores: Mapping[str, float | None]) -> dict[str, list[dict[str, Any]]]:
    return {"results": [{"key": k, "score": v} for k, v in scores.items() if v is not None]}


def _scored_run(run: Run, example: Example) -> Scored:
    return scored(
        example.inputs or {}, run.outputs or {}, example.outputs or {}, example.metadata or {}
    )


def systemone_row(run: Run, example: Example) -> dict[str, list[dict[str, Any]]]:
    return _results(_scored_run(run, example).scores)


def summary_evaluator(
    sink: Callable[[Summary], None],
) -> Callable[[Sequence[Run], Sequence[Example]], dict[str, list[dict[str, Any]]]]:
    def systemone_summary(
        runs: Sequence[Run], examples: Sequence[Example]
    ) -> dict[str, list[dict[str, Any]]]:
        summary = summarize(
            [_scored_run(r, e) for r, e in zip(runs, examples, strict=True) if r.outputs]
        )
        sink(summary)
        return _results(summary)

    return systemone_summary


def metadata(
    spec: ExperimentSpec, ranker: Ranker, *, dataset: str, tag: str, split: str, git_sha: str
) -> dict[str, Any]:
    return {
        "eval": "systemone",
        "model": spec.model,
        "style": spec.style,
        "max_options": ranker.max_options,
        "with_eval": spec.with_eval,
        "with_nouls": spec.with_nouls,
        "dataset": dataset,
        "dataset_version": tag,
        "split": split,
        "git_sha": git_sha,
    }


DESCRIPTION = (
    "System 1 ({model}, {style} descriptions, max_options {max_options}) ranking every legal "
    "move, scored against Stockfish's labels. Summary means weigh every rating band and phase "
    "equally, not by how often they occur on Lichess."
)


class Results(Protocol):
    @property
    def experiment_name(self) -> str: ...
    async def get_comparison_url(self) -> str | None: ...


class Evaluate(Protocol):
    async def __call__(
        self,
        target: Any,
        /,
        *,
        data: Iterable[Example],
        evaluators: Sequence[Any],
        summary_evaluators: Sequence[Any],
        metadata: dict[str, Any],
        experiment_prefix: str,
        description: str,
        max_concurrency: int,
        client: Any,
    ) -> Results: ...


class ExampleSource(Protocol):
    def list_examples(
        self, *, dataset_name: str, splits: Sequence[str], as_of: str
    ) -> Iterable[Example]: ...


AEVALUATE = cast("Evaluate", aevaluate)


@dataclass(frozen=True, slots=True)
class Finished:
    spec: ExperimentSpec
    name: str
    url: str | None
    summary: Summary


async def run_experiment(
    spec: ExperimentSpec,
    *,
    client: ExampleSource,
    dataset: str,
    tag: str,
    split: str,
    git_sha: str,
    runs_dir: Path,
    rankers: Callable[[ExperimentSpec], Ranker] = default_ranker,
    evaluate: Evaluate = AEVALUATE,
    max_concurrency: int = MAX_CONCURRENCY,
    report: Callable[[str], None] = lambda _: None,
) -> Finished:
    ranker = rankers(spec)
    examples = list(client.list_examples(dataset_name=dataset, splits=[split], as_of=tag))
    report(f"{spec.name}: {len(examples)} examples from {dataset}@{tag}, split {split}")
    summaries: list[Summary] = []
    meta = metadata(spec, ranker, dataset=dataset, tag=tag, split=split, git_sha=git_sha)
    results = await evaluate(
        make_target(ranker),
        data=examples,
        evaluators=[systemone_row],
        summary_evaluators=[summary_evaluator(summaries.append)],
        metadata=meta,
        experiment_prefix=f"systemone-{spec.name}",
        description=DESCRIPTION.format(**meta),
        max_concurrency=max_concurrency,
        client=client,
    )
    if not summaries:
        msg = f"{results.experiment_name}: the summary evaluator didn't run"
        raise RuntimeError(msg)
    summary = summaries[-1]
    url = await results.get_comparison_url()
    runs_dir.mkdir(parents=True, exist_ok=True)
    record = {
        "name": results.experiment_name,
        "url": url,
        "spec": asdict(spec),
        "metadata": meta,
        "summary": summary,
    }
    (runs_dir / f"{results.experiment_name}.json").write_text(json.dumps(record, indent=2) + "\n")
    report(f"{spec.name}: {url}")
    return Finished(spec, results.experiment_name, url, summary)
