import json

import chess
import pytest

from langchain_chess_evals.positions.examples import LabelError
from langchain_chess_evals.positions.labels import label, load_cache
from langchain_chess_evals.positions.sampling import Game, Position
from langchain_chess_evals.testing import FakePool

GAME = Game("g", "2018-06", 1500, 1500, "600+0", "rapid", ("e2e4", "e7e5", "g1f3", "b8c6"))


def positions() -> list[Position]:
    board = chess.Board()
    found = []
    for ply, uci in enumerate(GAME.moves):
        legal = tuple(m.uci() for m in board.legal_moves)
        found.append(Position(GAME, ply, board.fen(), legal, "1200-1599", "opening"))
        board.push_uci(uci)
    return found


async def test_label_caches_every_reference(tmp_path):
    pool = FakePool()
    progress = []
    labels = await label(positions(), pool, tmp_path, report=lambda d, t: progress.append((d, t)))
    assert set(labels) == {p.fen for p in positions()}
    assert progress[-1] == (4, 4)
    cache = tmp_path / f"{pool.grader.fingerprint}.jsonl"
    assert load_cache(cache) == labels

    again = FakePool()
    assert await label(positions(), again, tmp_path) == labels
    assert again.analysed == []


async def test_label_resumes_where_it_stopped(tmp_path):
    pool = FakePool()
    first = positions()[:2]
    await label(first, pool, tmp_path)
    cache = tmp_path / f"{pool.grader.fingerprint}.jsonl"
    cache.write_text(cache.read_text() + "\n")

    resumed = FakePool()
    await label(positions(), resumed, tmp_path)
    assert resumed.analysed == [p.fen for p in positions()[2:]]
    lines = [json.loads(line) for line in cache.read_text().splitlines() if line.strip()]
    assert len(lines) == 4


async def test_label_fails_on_an_incomplete_analysis(tmp_path):
    pool = FakePool(fail_on=positions()[1].fen)
    with pytest.raises(ExceptionGroup) as info:
        await label(positions(), pool, tmp_path)
    assert info.group_contains(LabelError)


def test_load_cache_without_a_file(tmp_path):
    assert load_cache(tmp_path / "missing.jsonl") == {}
