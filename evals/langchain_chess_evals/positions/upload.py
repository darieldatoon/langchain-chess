"""Sync a committed `vN.jsonl` into a LangSmith dataset and tag the resulting version `vN`.

Example ids derive from row ids, so uploading again creates nothing new: rows that changed are
updated, and examples no longer in the file are deleted. Only the tag pins a version. The
dataset is created with the inputs and outputs schemas, so LangSmith rejects any row that breaks
them.
"""

import json
from collections.abc import Callable, Iterator, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Protocol

from langchain_chess_evals.positions.examples import Row
from langchain_chess_evals.positions.schema import INPUTS_SCHEMA, OUTPUTS_SCHEMA

BATCH = 500


class DatasetClient(Protocol):
    """The slice of `langsmith.Client` an upload uses."""

    def has_dataset(self, *, dataset_name: str) -> bool: ...
    def create_dataset(
        self,
        dataset_name: str,
        *,
        description: str,
        inputs_schema: dict,
        outputs_schema: dict,
        metadata: dict,
    ) -> Any: ...
    def read_dataset(self, *, dataset_name: str) -> Any: ...
    def list_examples(self, *, dataset_id: Any) -> Iterator[Any]: ...
    def create_examples(self, *, dataset_id: Any, examples: Sequence[dict]) -> Any: ...
    def update_examples(self, *, dataset_id: Any, updates: Sequence[dict]) -> Any: ...
    def delete_examples(self, example_ids: Sequence[str]) -> None: ...
    def list_dataset_versions(self, *, dataset_id: Any, limit: int) -> Iterator[Any]: ...
    def update_dataset_tag(self, *, dataset_id: Any, as_of: datetime, tag: str) -> None: ...
    def request_with_retries(self, method: Any, pathname: str, *, request_kwargs: dict) -> Any: ...


def _patch_dataset(client: DatasetClient, dataset_id: Any, fields: Mapping[str, Any]) -> None:
    """The SDK has no dataset update; description and metadata go through the REST API."""
    client.request_with_retries(
        "PATCH", f"/datasets/{dataset_id}", request_kwargs={"json": dict(fields)}
    )


@dataclass(frozen=True, slots=True)
class Stored:
    """An example as LangSmith returns it, reduced to what an upload compares."""

    inputs: Mapping[str, Any]
    outputs: Mapping[str, Any]
    metadata: Mapping[str, Any]
    split: str | None


def stored(example: Any) -> Stored:
    metadata = dict(example.metadata or {})
    splits = metadata.pop("dataset_split", None) or [None]
    return Stored(example.inputs or {}, example.outputs or {}, metadata, splits[0])


@dataclass(frozen=True, slots=True)
class Sync:
    create: tuple[dict[str, Any], ...]
    update: tuple[dict[str, Any], ...]
    delete: tuple[str, ...]


def plan_sync(existing: Mapping[str, Stored], rows: Sequence[Row]) -> Sync:
    create: list[dict[str, Any]] = []
    update: list[dict[str, Any]] = []
    for row in rows:
        wanted = row.example()
        have = existing.get(wanted["id"])
        if have is None:
            create.append(wanted)
        elif have != Stored(
            wanted["inputs"], wanted["outputs"], wanted["metadata"], wanted["split"]
        ):
            update.append(wanted)
    keep = {row.example_id for row in rows}
    return Sync(tuple(create), tuple(update), tuple(i for i in existing if i not in keep))


def read_rows(path: Path) -> tuple[Row, ...]:
    return tuple(Row.from_json(json.loads(line)) for line in path.read_text().splitlines())


def _batches[T](items: Sequence[T]) -> Iterator[Sequence[T]]:
    for start in range(0, len(items), BATCH):
        yield items[start : start + BATCH]


def description(manifest: Mapping[str, Any]) -> str:
    months = ", ".join(m["month"] for m in manifest["source"]["months"])
    settings = manifest["engine"]["settings"]
    return (
        f"Positions from rated Lichess rapid and classical games ({months}), every legal move "
        f"labelled by {manifest['engine']['name']} at depth {settings.get('depth')}. Equal "
        "quotas per rating band and phase. Built by langchain-chess evals/."
    )


class UploadError(RuntimeError):
    """Shown to the user without a traceback."""


@dataclass(frozen=True, slots=True)
class Uploaded:
    dataset_id: str
    tag: str
    sync: Sync


def upload(
    rows: Sequence[Row],
    manifest: Mapping[str, Any],
    client: DatasetClient,
    *,
    dataset: str,
    tag: str,
    report: Callable[[str], None] = lambda _: None,
) -> Uploaded:
    about = {"description": description(manifest), "metadata": {"manifest": dict(manifest)}}
    if client.has_dataset(dataset_name=dataset):
        info = client.read_dataset(dataset_name=dataset)
        if (info.inputs_schema, info.outputs_schema) != (INPUTS_SCHEMA, OUTPUTS_SCHEMA):
            # Do not patch the schemas instead: LangSmith re-checks every stored example in one
            # request, which fails with a 500 on a full dataset.
            msg = (
                f"dataset {dataset} has other inputs or outputs schemas; delete it in LangSmith "
                "(its experiments go with it) or pass another --dataset, then upload again"
            )
            raise UploadError(msg)
        # Merge, never replace: the metadata also holds UI settings such as `iframe_config`.
        about["metadata"] = {**(info.metadata or {}), "manifest": dict(manifest)}
    else:
        report(f"creating dataset {dataset}")
        info = client.create_dataset(
            dataset, inputs_schema=INPUTS_SCHEMA, outputs_schema=OUTPUTS_SCHEMA, **about
        )
    existing = {str(e.id): stored(e) for e in client.list_examples(dataset_id=info.id)}
    sync = plan_sync(existing, rows)
    report(
        f"{len(sync.create)} to create, {len(sync.update)} to update, {len(sync.delete)} to delete"
    )
    for batch in _batches(sync.create):
        client.create_examples(dataset_id=info.id, examples=batch)
    for batch in _batches(sync.update):
        client.update_examples(dataset_id=info.id, updates=batch)
    for ids in _batches(sync.delete):
        client.delete_examples(ids)
    _patch_dataset(client, info.id, about)
    latest = next(iter(client.list_dataset_versions(dataset_id=info.id, limit=1)))
    client.update_dataset_tag(dataset_id=info.id, as_of=latest.as_of, tag=tag)
    report(f"tagged {dataset} as {tag}")
    return Uploaded(str(info.id), tag, sync)
