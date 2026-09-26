"""Download a month of the Lichess games database, check it against Lichess's sha256, stream it.

Downloads are kept under the cache rather than streamed from the network: the scarce 2400+ band
may need most of a month, and a local, checked file keeps a seeded build reproducible.
"""

import hashlib
import io
import urllib.request
from collections.abc import Callable, Iterable, Iterator
from contextlib import AbstractContextManager
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO

import zstandard

from langchain_chess_evals.positions.sampling import split_games

BASE_URL = "https://database.lichess.org/standard/"
CHUNK = 1 << 20

type Fetch = Callable[[str], AbstractContextManager[BinaryIO]]


def urlopen(url: str) -> AbstractContextManager[BinaryIO]:
    return urllib.request.urlopen(url)


@dataclass(frozen=True, slots=True)
class MonthFile:
    month: str
    url: str
    sha256: str
    path: Path


def file_name(month: str) -> str:
    return f"lichess_db_standard_rated_{month}.pgn.zst"


def next_month(month: str) -> str:
    year, number = (int(part) for part in month.split("-"))
    year, number = (year + 1, 1) if number == 12 else (year, number + 1)
    return f"{year:04d}-{number:02d}"


def parse_sha256s(text: str) -> dict[str, str]:
    """`sha256sum` output: file name to digest."""
    sums: dict[str, str] = {}
    for line in text.splitlines():
        digest, _, name = line.strip().partition("  ")
        if name:
            sums[name] = digest
    return sums


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(CHUNK):
            digest.update(chunk)
    return digest.hexdigest()


def ensure_month(
    month: str,
    cache_dir: Path,
    *,
    fetch: Fetch = urlopen,
    report: Callable[[str], None] = lambda _: None,
) -> MonthFile:
    """Download the month unless a checked copy is cached. Raises on a checksum mismatch."""
    name = file_name(month)
    url = BASE_URL + name
    with fetch(BASE_URL + "sha256sums.txt") as response:
        expected = parse_sha256s(response.read().decode()).get(name)
    if expected is None:
        msg = f"Lichess publishes no sha256 for {name}"
        raise ValueError(msg)
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / name
    # Hashing 6 GB takes a while; the marker records a copy already checked at this size.
    marker = path.with_name(name + ".sha256")
    checked = f"{expected} {path.stat().st_size}" if path.exists() else None
    if checked and marker.exists() and marker.read_text() == checked:
        return MonthFile(month, url, expected, path)
    if not path.exists():
        report(f"downloading {url}")
        part = path.with_name(name + ".part")
        with fetch(url) as response, part.open("wb") as out:
            while chunk := response.read(CHUNK):
                out.write(chunk)
        part.rename(path)
    report(f"checking {name}")
    actual = _sha256(path)
    if actual != expected:
        msg = f"{name}: sha256 {actual} does not match Lichess's {expected}; delete it to retry"
        raise ValueError(msg)
    marker.write_text(f"{expected} {path.stat().st_size}")
    return MonthFile(month, url, expected, path)


def stream_games(path: Path) -> Iterator[str]:
    with path.open("rb") as raw, zstandard.ZstdDecompressor().stream_reader(raw) as reader:
        yield from split_games(io.TextIOWrapper(reader, encoding="utf-8"))


def month_games(
    months: Iterable[str],
    cache_dir: Path,
    *,
    on_month: Callable[[MonthFile], None],
    fetch: Fetch = urlopen,
    report: Callable[[str], None] = lambda _: None,
) -> Iterator[tuple[str, str]]:
    """`(month, pgn_text)` for each game; a month is fetched only once the previous one runs
    out, so a sample that fills early never downloads the next."""
    for month in months:
        file = ensure_month(month, cache_dir, fetch=fetch, report=report)
        on_month(file)
        for text in stream_games(file.path):
            yield month, text
