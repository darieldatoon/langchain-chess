"""Test fakes for the evals. Not used at runtime."""

import io
import uuid
from collections.abc import Iterator, Mapping, Sequence
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from types import SimpleNamespace, TracebackType
from typing import Any, BinaryIO, Self

import chess

from langchain_chess.engine import EngineConfig, Grader
from langchain_chess.grading import Analysis, Cp, Line


def fake_analysis(fen: str, step: int = 40) -> Analysis:
    """A line per legal move in generation order, each `step` cp worse for the mover."""
    board = chess.Board(fen)
    sign = 1 if board.turn == chess.WHITE else -1
    return Analysis(
        tuple(
            Line(Cp(sign * (100 - step * index)), (move.uci(),))
            for index, move in enumerate(board.legal_moves)
        )
    )


@dataclass
class FakePool:
    """Stands in for `EnginePool`: `fake_analysis` for every position, calls recorded."""

    config: EngineConfig = field(default_factory=EngineConfig)
    workers: int = 1
    fail_on: str | None = None
    analysed: list[str] = field(default_factory=list)

    @property
    def grader(self) -> Grader:
        return Grader("FakeFish 1", self.config.settings())

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        return None

    async def analyse(self, fen: str) -> Analysis:
        self.analysed.append(fen)
        if fen == self.fail_on:
            return Analysis((Line(Cp(0), ()),))
        return fake_analysis(fen)


@dataclass
class FakeFetch:
    """Serves `urls` from memory; records every URL fetched."""

    urls: Mapping[str, bytes]
    fetched: list[str] = field(default_factory=list)

    @contextmanager
    def __call__(self, url: str) -> Iterator[BinaryIO]:
        self.fetched.append(url)
        yield io.BytesIO(self.urls[url])


@dataclass
class FakeDatasetClient:
    """The slice of `langsmith.Client` that uploads and experiments use, in memory."""

    datasets: dict[str, str] = field(default_factory=dict)
    schemas: dict[str, dict[str, Any]] = field(default_factory=dict)
    """By dataset id: `inputs` and `outputs`, None when unset."""
    patches: list[dict[str, Any]] = field(default_factory=list)
    metadata: dict[str, dict[str, Any]] = field(default_factory=dict)
    """By dataset id."""
    examples: dict[str, SimpleNamespace] = field(default_factory=dict)
    tags: dict[str, datetime] = field(default_factory=dict)
    calls: list[str] = field(default_factory=list)

    def has_dataset(self, *, dataset_name: str) -> bool:
        return dataset_name in self.datasets

    def create_dataset(
        self,
        dataset_name: str,
        *,
        description: str,
        metadata: dict,
        inputs_schema: dict | None = None,
        outputs_schema: dict | None = None,
    ) -> Any:
        self.calls.append("create_dataset")
        dataset_id = self.datasets[dataset_name] = str(uuid.uuid4())
        self.schemas[dataset_id] = {"inputs": inputs_schema, "outputs": outputs_schema}
        self.metadata[dataset_id] = metadata
        return self.read_dataset(dataset_name=dataset_name)

    def read_dataset(self, *, dataset_name: str) -> Any:
        dataset_id = self.datasets[dataset_name]
        schemas = self.schemas.get(dataset_id, {})
        return SimpleNamespace(
            id=dataset_id,
            inputs_schema=schemas.get("inputs"),
            outputs_schema=schemas.get("outputs"),
            metadata=self.metadata.get(dataset_id),
        )

    def request_with_retries(self, method: Any, pathname: str, *, request_kwargs: dict) -> Any:
        """Only the dataset PATCH an upload sends."""
        dataset_id = pathname.removeprefix("/datasets/")
        body = request_kwargs["json"]
        self.calls.append(f"{method} {sorted(body)}")
        self.patches.append(body)
        self.metadata[dataset_id] = body["metadata"]

    def _stored(self, example: Mapping[str, Any]) -> SimpleNamespace:
        return SimpleNamespace(
            id=uuid.UUID(example["id"]),
            inputs=example["inputs"],
            outputs=example["outputs"],
            metadata={**example["metadata"], "dataset_split": [example["split"]]},
        )

    def list_examples(self, **kwargs: Any) -> Iterator[Any]:
        splits = kwargs.get("splits")
        for example in self.examples.values():
            if splits is None or example.metadata["dataset_split"][0] in splits:
                yield example

    def create_examples(self, *, dataset_id: Any, examples: Sequence[dict]) -> Any:
        self.calls.append(f"create {len(examples)}")
        for example in examples:
            self.examples[example["id"]] = self._stored(example)

    def update_examples(self, *, dataset_id: Any, updates: Sequence[dict]) -> Any:
        self.calls.append(f"update {len(updates)}")
        for example in updates:
            self.examples[example["id"]] = self._stored(example)

    def delete_examples(self, example_ids: Sequence[str]) -> None:
        self.calls.append(f"delete {len(example_ids)}")
        for example_id in example_ids:
            del self.examples[example_id]

    def list_dataset_versions(self, *, dataset_id: Any, limit: int) -> Iterator[Any]:
        yield SimpleNamespace(as_of=datetime(2026, 9, 26, tzinfo=UTC))

    def update_dataset_tag(self, *, dataset_id: Any, as_of: datetime, tag: str) -> None:
        self.tags[tag] = as_of
