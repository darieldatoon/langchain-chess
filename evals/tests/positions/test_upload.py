import json
from dataclasses import replace
from types import SimpleNamespace

from langchain_chess.grading import Cp
from langchain_chess_evals.positions.examples import Reference, Row
from langchain_chess_evals.positions.upload import (
    Stored,
    description,
    plan_sync,
    read_rows,
    stored,
    upload,
)
from langchain_chess_evals.testing import FakeDatasetClient

MANIFEST = {
    "source": {"months": [{"month": "2018-06"}, {"month": "2018-07"}]},
    "engine": {"name": "Stockfish 19", "settings": {"depth": 16}},
}


def row(index: int, split: str = "full") -> Row:
    return Row(
        id=f"game{index}-010",
        split=split,
        start_fen="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
        moves=(),
        legal=("e2e4", "d2d4"),
        reference=Reference({"e2e4": Cp(30), "d2d4": Cp(20)}),
        metadata={"band": "<1200", "played_move": "e2e4"},
    )


def test_stored_reads_the_split_from_metadata():
    example = SimpleNamespace(
        inputs={"a": 1}, outputs=None, metadata={"band": "x", "dataset_split": ["dev"]}
    )
    assert stored(example) == Stored({"a": 1}, {}, {"band": "x"}, "dev")
    assert stored(SimpleNamespace(inputs=None, outputs=None, metadata=None)).split is None


def test_plan_sync():
    rows = [row(1), row(2)]
    existing = {
        rows[0].example_id: stored(FakeDatasetClient()._stored(rows[0].example())),
        "gone": Stored({}, {}, {}, "dev"),
    }
    sync = plan_sync(existing, [rows[0], rows[1]])
    assert [e["id"] for e in sync.create] == [rows[1].example_id]
    assert sync.update == ()
    assert sync.delete == ("gone",)

    moved = replace(rows[0], split="dev")
    assert [e["split"] for e in plan_sync(existing, [moved]).update] == ["dev"]


def test_upload_creates_then_syncs(tmp_path):
    client = FakeDatasetClient()
    notes: list[str] = []
    first = upload([row(1), row(2)], MANIFEST, client, dataset="d", tag="v1", report=notes.append)
    assert notes[0] == "creating dataset d"
    assert len(first.sync.create) == 2
    assert len(client.examples) == 2
    assert "v1" in client.tags

    again = upload([row(1), row(2)], MANIFEST, client, dataset="d", tag="v1")
    assert again.sync.create == again.sync.update == again.sync.delete == ()
    assert client.calls.count("create_dataset") == 1

    third = upload([replace(row(1), split="dev"), row(3)], MANIFEST, client, dataset="d", tag="v2")
    assert (len(third.sync.create), len(third.sync.update), len(third.sync.delete)) == (1, 1, 1)
    assert client.calls[-3:] == ["create 1", "update 1", "delete 1"]
    assert sorted(client.tags) == ["v1", "v2"]


def test_read_rows(tmp_path):
    path = tmp_path / "v1.jsonl"
    path.write_text("".join(json.dumps(r.json()) + "\n" for r in (row(1), row(2, "dev"))))
    assert read_rows(path) == (row(1), row(2, "dev"))


def test_description():
    text = description(MANIFEST)
    assert "(2018-06, 2018-07)" in text
    assert "Stockfish 19 at depth 16" in text
