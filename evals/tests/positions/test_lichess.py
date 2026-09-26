import hashlib
from pathlib import Path

import pytest
import zstandard

from langchain_chess_evals.positions.lichess import (
    BASE_URL,
    MonthFile,
    ensure_month,
    file_name,
    month_games,
    next_month,
    parse_sha256s,
    stream_games,
    urlopen,
)
from langchain_chess_evals.testing import FakeFetch

FIXTURE = Path(__file__).parents[1] / "fixtures" / "games.pgn"
SUMS = BASE_URL + "sha256sums.txt"


def compressed() -> bytes:
    return zstandard.ZstdCompressor().compress(FIXTURE.read_bytes())


def fetch_for(*months: str, data: bytes | None = None, digest: str | None = None) -> FakeFetch:
    blob = compressed() if data is None else data
    sha = digest or hashlib.sha256(blob).hexdigest()
    sums = "".join(f"{sha}  {file_name(m)}\n" for m in months)
    return FakeFetch({SUMS: sums.encode(), **{BASE_URL + file_name(m): blob for m in months}})


def test_names_and_months():
    assert file_name("2018-06") == "lichess_db_standard_rated_2018-06.pgn.zst"
    assert next_month("2018-06") == "2018-07"
    assert next_month("2018-12") == "2019-01"
    assert parse_sha256s("abc  a.zst\n\ndef  b.zst\n") == {"a.zst": "abc", "b.zst": "def"}


def test_ensure_month_downloads_once_and_checks(tmp_path):
    fetch = fetch_for("2018-06")
    notes = []
    file = ensure_month("2018-06", tmp_path, fetch=fetch, report=notes.append)
    assert file.path.read_bytes() == compressed()
    assert file.url == BASE_URL + file_name("2018-06")
    assert file.sha256 == hashlib.sha256(compressed()).hexdigest()
    assert notes == [f"downloading {file.url}", f"checking {file_name('2018-06')}"]

    again = fetch_for("2018-06")
    assert ensure_month("2018-06", tmp_path, fetch=again) == file
    assert again.fetched == [SUMS]


def test_ensure_month_rechecks_an_unmarked_copy(tmp_path):
    ensure_month("2018-06", tmp_path, fetch=fetch_for("2018-06"))
    (tmp_path / (file_name("2018-06") + ".sha256")).unlink()
    fetch = fetch_for("2018-06")
    ensure_month("2018-06", tmp_path, fetch=fetch)
    assert fetch.fetched == [SUMS]


def test_ensure_month_rejects_a_bad_download(tmp_path):
    with pytest.raises(ValueError, match="does not match"):
        ensure_month("2018-06", tmp_path, fetch=fetch_for("2018-06", digest="0" * 64))
    with pytest.raises(ValueError, match="no sha256"):
        ensure_month("2018-07", tmp_path, fetch=fetch_for("2018-06"))


def test_stream_and_chain_months(tmp_path):
    files: list[MonthFile] = []
    games = month_games(
        ["2018-06", "2018-07"],
        tmp_path,
        on_month=files.append,
        fetch=fetch_for("2018-06", "2018-07"),
    )
    first = next(games)
    assert first[0] == "2018-06"
    assert [f.month for f in files] == ["2018-06"]
    rest = list(games)
    assert len(rest) == 25
    assert [f.month for f in files] == ["2018-06", "2018-07"]
    assert len(list(stream_games(files[0].path))) == 13


def test_urlopen_reads_a_url():
    with urlopen(FIXTURE.resolve().as_uri()) as response:
        assert response.read() == FIXTURE.read_bytes()
