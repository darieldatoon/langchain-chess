import asyncio

import chess
import chess.engine
import pytest

from langchain_chess.engine import (
    EngineConfig,
    EnginePool,
    Grader,
    SearchLimit,
    analysis_from,
    eval_from,
)
from langchain_chess.grading import Cp, Mate
from langchain_chess.testing import FAKE_ENGINE_NAME, fake_engine

MATE_IN_ONE = "rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2"


def test_search_limits():
    assert SearchLimit("depth", 12).to_engine() == chess.engine.Limit(depth=12)
    assert SearchLimit("nodes", 5000).to_engine() == chess.engine.Limit(nodes=5000)
    assert SearchLimit("movetime", 250).to_engine() == chess.engine.Limit(time=0.25)
    with pytest.raises(ValueError, match="depth must be at least 1"):
        SearchLimit("depth", 0)


def test_config_settings_leave_out_the_path():
    config = EngineConfig(path="/opt/sf", limit=SearchLimit("nodes", 1000), multipv=3)
    assert config.settings() == {"nodes": 1000, "multipv": 3, "threads": 1, "hash_mb": 256}
    assert EngineConfig().limit == SearchLimit("depth", 16)
    with pytest.raises(ValueError, match="hash_mb must be at least 1"):
        EngineConfig(hash_mb=0)


def test_fingerprint_tracks_engine_and_settings():
    a = Grader("Stockfish 19", {"depth": 16})
    assert a.fingerprint == Grader("Stockfish 19", {"depth": 16}).fingerprint
    assert a.fingerprint != Grader("Stockfish 18", {"depth": 16}).fingerprint
    assert a.fingerprint != Grader("Stockfish 19", {"depth": 18}).fingerprint


def test_scores_are_from_whites_side():
    assert eval_from(chess.engine.PovScore(chess.engine.Cp(30), chess.BLACK)) == Cp(-30)
    assert eval_from(chess.engine.PovScore(chess.engine.Mate(2), chess.BLACK)) == Mate(2, "black")
    assert eval_from(chess.engine.PovScore(chess.engine.Mate(-3), chess.BLACK)) == Mate(3, "white")


def test_a_mated_side_loses_from_either_perspective():
    assert eval_from(chess.engine.PovScore(chess.engine.Mate(0), chess.BLACK)) == Mate(0, "white")
    assert eval_from(chess.engine.PovScore(chess.engine.Mate(0), chess.WHITE)) == Mate(0, "black")


def test_an_analysis_needs_a_score():
    with pytest.raises(chess.engine.EngineError, match="no score"):
        analysis_from([{"depth": 1}])
    only = analysis_from([{"depth": 1}, {"score": chess.engine.PovScore(chess.engine.Cp(5), True)}])
    assert only.lines[0].pv == ()


def test_workers_must_be_positive():
    with pytest.raises(ValueError, match="workers"):
        EnginePool(EngineConfig(), 0)


async def test_the_pool_analyses_on_every_engine(tmp_path):
    config = EngineConfig(path=fake_engine(tmp_path), limit=SearchLimit("depth", 1), multipv=2)
    async with EnginePool(config, 3) as pool:
        assert pool.grader == Grader(FAKE_ENGINE_NAME, config.settings())
        results = await asyncio.gather(
            *(pool.analyse(MATE_IN_ONE) for _ in range(5)), pool.analyse(chess.STARTING_FEN)
        )
    mate = results[0]
    assert mate.eval == Mate(1, "black")
    assert mate.best_move == "d8h4"
    assert len(mate.lines) == 2
    assert results[-1].eval == Cp(0)
    assert pool._engines == []


async def test_a_failed_start_quits_the_engines_already_running(tmp_path):
    started = []
    real = chess.engine.popen_uci

    async def popen(path):
        if started:
            raise FileNotFoundError(path)
        transport, engine = await real(path)
        started.append(engine)
        return transport, engine

    pool = EnginePool(EngineConfig(path=fake_engine(tmp_path)), 2)
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(chess.engine, "popen_uci", popen)
        with pytest.raises(FileNotFoundError):
            await pool.__aenter__()
    await started[0].returncode
    assert pool._engines == []


async def test_an_engine_that_died_is_skipped_on_exit(tmp_path):
    pool = EnginePool(EngineConfig(path=fake_engine(tmp_path)), 1)
    async with pool:
        engine = pool._engines[0]
        engine.send_line("quit")
        await engine.returncode


async def test_an_unresponsive_engine_is_killed_on_exit(tmp_path):
    pool = EnginePool(EngineConfig(path=fake_engine(tmp_path, quits=False)), 2, quit_timeout=0.05)
    async with pool:
        engines = list(pool._engines)
    assert all(engine.returncode.done() for engine in engines)
    assert pool._engines == []


async def test_a_cancelled_exit_finishes_cleanup_before_it_propagates(tmp_path):
    pool = EnginePool(EngineConfig(path=fake_engine(tmp_path, quits=False)), 3, quit_timeout=0.1)
    await pool.__aenter__()
    engines = list(pool._engines)
    exiting = asyncio.create_task(pool.__aexit__(None, None, None))
    await asyncio.sleep(0)
    again = asyncio.create_task(pool.__aexit__(None, None, None))
    exiting.cancel()
    await asyncio.sleep(0)
    exiting.cancel()
    await again
    assert all(engine.returncode.done() for engine in engines)
    with pytest.raises(asyncio.CancelledError):
        await exiting
    assert pool._engines == []
