import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path

import pytest
import zstandard

from langchain_chess_evals.positions.build import (
    ALL_MOVES_MULTIPV,
    BuildConfig,
    BuildError,
    build,
    default_engine,
    months_from,
    progress,
)
from langchain_chess_evals.positions.lichess import BASE_URL, file_name
from langchain_chess_evals.positions.sampling import Quotas
from langchain_chess_evals.positions.upload import read_rows
from langchain_chess_evals.testing import FakeFetch, FakePool

FIXTURE = Path(__file__).parents[1] / "fixtures" / "games.pgn"


def fetch() -> FakeFetch:
    blob = zstandard.ZstdCompressor().compress(FIXTURE.read_bytes())
    sums = "".join(
        f"{hashlib.sha256(blob).hexdigest()}  {file_name(m)}\n" for m in ("2018-06", "2018-07")
    )
    return FakeFetch(
        {
            BASE_URL + "sha256sums.txt": sums.encode(),
            BASE_URL + file_name("2018-06"): blob,
            BASE_URL + file_name("2018-07"): blob,
        }
    )


def config(tmp_path: Path, **overrides) -> BuildConfig:
    settings = {"quotas": Quotas({"dev": 3, "full": 6}), "max_months": 1, **overrides}
    return BuildConfig(
        version="v0",
        month="2018-06",
        out_dir=tmp_path / "datasets",
        cache_dir=tmp_path / "cache",
        **settings,
    )


def pools(engine, workers):
    return FakePool(engine, workers)


def test_default_engine_labels_every_move():
    engine = default_engine()
    assert engine.settings() == {
        "depth": 16,
        "multipv": ALL_MOVES_MULTIPV,
        "threads": 1,
        "hash_mb": 256,
    }


def test_months_from():
    months = months_from("2018-11")
    assert [next(months) for _ in range(3)] == ["2018-11", "2018-12", "2019-01"]


async def test_build_refuses_a_short_sample(tmp_path):
    with pytest.raises(BuildError, match=r"left buckets short: .*2400\+ endgame"):
        await build(
            config(tmp_path),
            git_sha="abc",
            pools=pools,
            fetch=fetch(),
        )


class OpeningsOnly(Quotas):
    """The fixture can't fill every bucket: one full opening position per band."""

    def split_quota(self, split, phase_):
        return int(split == "full" and phase_ == "opening")


async def test_build_writes_rows_and_manifest(tmp_path):
    notes: list[str] = []
    cfg = config(tmp_path, quotas=OpeningsOnly({"dev": 0, "full": 1}))
    rows = await build(
        cfg,
        git_sha="abc",
        pools=pools,
        fetch=fetch(),
        report=notes.append,
        now=lambda: datetime(2026, 9, 26, tzinfo=UTC),
    )
    assert len(rows) == 5
    assert read_rows(cfg.rows_path) == rows
    manifest = json.loads(cfg.manifest_path.read_text())
    assert manifest["version"] == manifest["tag"] == "v0"
    assert manifest["dataset"] == "langchain-chess-positions"
    assert manifest["git_sha"] == "abc"
    assert manifest["created_at"] == "2026-09-26T00:00:00+00:00"
    assert [m["month"] for m in manifest["source"]["months"]] == ["2018-06"]
    assert manifest["engine"]["name"] == "FakeFish 1"
    assert manifest["engine"]["settings"]["multipv"] == ALL_MOVES_MULTIPV
    assert manifest["rows"] == 5
    assert sum(manifest["counts"]["full"][b]["opening"] for b in manifest["counts"]["full"]) == 5
    assert "labelled 5/5" in notes

    with pytest.raises(BuildError, match="exists"):
        await build(cfg, git_sha="abc", pools=pools, fetch=fetch())


def test_progress_reports_every_twentieth():
    notes: list[str] = []
    labelled = progress(notes.append)
    for done in range(1, 101):
        labelled(done, 100)
    assert len(notes) == 20
    assert notes[-1] == "labelled 100/100"
