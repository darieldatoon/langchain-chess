from pathlib import Path

import chess
import chess.engine
import pytest

from jev_chess.engines import (
    EloLimit,
    EngineNotFoundError,
    MaiaOpponent,
    Oracle,
    OracleConfig,
    RankedMove,
    SkillLimit,
    StockfishOpponent,
    popen_uci,
    resolve_binary,
    weights_path,
)
from jev_chess.engines import paths as paths_module
from tests.fakes import FakeBackend, info


def test_oracle_ranks_from_side_to_move_and_computes_cp_loss() -> None:
    backend = FakeBackend(
        scripted_infos=[info("e2e4", cp=30), info("d2d4", cp=25), info("a2a3", cp=-10)]
    )
    oracle = Oracle(backend, OracleConfig(depth=12, multipv=3, hash_mb=64))
    evaluation = oracle.evaluate(chess.Board())
    assert backend.options == {"Threads": 1, "Hash": 64}
    assert backend.limits[0].depth == 12
    assert [m.uci for m in evaluation.ranked] == ["e2e4", "d2d4", "a2a3"]
    assert evaluation.best.cp == 30
    assert evaluation.cp_loss("d2d4") == 5
    assert evaluation.cp_loss("a2a3") == 40
    assert evaluation.cp_loss("h2h4") is None


def test_oracle_pov_flips_for_black_and_multipv_override() -> None:
    board = chess.Board("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1")
    backend = FakeBackend(scripted_infos=[info("e7e5", cp=20), info("c7c5", cp=35)])
    evaluation = Oracle(backend).evaluate(board, multipv=1)
    assert len(evaluation.ranked) == 1
    assert evaluation.best.cp == -20


def test_mates_sort_above_material() -> None:
    backend = FakeBackend(
        scripted_infos=[info("a1a2", cp=900), info("a1a8", mate=1), info("a1a3", mate=-2)]
    )
    evaluation = Oracle(backend).evaluate(chess.Board("6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1"))
    assert [m.uci for m in evaluation.ranked] == ["a1a8", "a1a2", "a1a3"]
    assert evaluation.best.mate == 1
    assert evaluation.cp_loss("a1a2") == 100_000 - 1 - 900


def test_ranked_move_score_cp_for_being_mated() -> None:
    assert RankedMove("a1a2", cp=None, mate=-3).score_cp == -99_997


def test_oracle_open_uses_opener_and_closes_on_exit(monkeypatch: pytest.MonkeyPatch) -> None:
    backend = FakeBackend(scripted_infos=[info("e2e4", cp=10)])
    monkeypatch.setattr(paths_module.shutil, "which", lambda name: f"/bin/{name}")
    with Oracle.open(None, opener=lambda path: backend) as oracle:
        assert oracle.evaluate(chess.Board()).best.uci == "e2e4"
    assert backend.quit_called


def test_stockfish_opponent_configures_strength_and_plays() -> None:
    backend = FakeBackend(scripted_move=chess.Move.from_uci("e2e4"))
    opponent = StockfishOpponent(backend, EloLimit(1500), move_time_s=0.2)
    assert backend.options == {"Threads": 1, "UCI_LimitStrength": True, "UCI_Elo": 1500}
    assert opponent.play(chess.Board()).uci() == "e2e4"
    assert backend.limits[0].time == 0.2


def test_stockfish_opponent_skill_level_and_open(monkeypatch: pytest.MonkeyPatch) -> None:
    backend = FakeBackend(scripted_move=chess.Move.from_uci("d2d4"))
    monkeypatch.setattr(paths_module.shutil, "which", lambda name: f"/bin/{name}")
    with StockfishOpponent.open(SkillLimit(0), opener=lambda path: backend) as opponent:
        assert backend.options["Skill Level"] == 0
        assert opponent.play(chess.Board()).uci() == "d2d4"
    assert backend.quit_called


@pytest.mark.parametrize("elo", [1319, 3191])
def test_elo_limit_bounds(elo: int) -> None:
    with pytest.raises(ValueError, match="UCI_Elo"):
        EloLimit(elo)


@pytest.mark.parametrize("level", [-1, 21])
def test_skill_limit_bounds(level: int) -> None:
    with pytest.raises(ValueError, match="Skill Level"):
        SkillLimit(level)


def test_maia_opens_with_weights_and_plays_one_node(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    (tmp_path / "maia-1100.pb.gz").write_bytes(b"")
    backend = FakeBackend(scripted_move=chess.Move.from_uci("g1f3"))
    monkeypatch.setattr(paths_module.shutil, "which", lambda name: f"/bin/{name}")
    with MaiaOpponent.open(1100, tmp_path, opener=lambda path: backend) as maia:
        assert backend.options == {"WeightsFile": str(tmp_path / "maia-1100.pb.gz")}
        assert maia.rating == 1100
        assert maia.play(chess.Board()).uci() == "g1f3"
    assert backend.limits[0].nodes == 1
    assert backend.quit_called


def test_missing_maia_weights(tmp_path: Path) -> None:
    with pytest.raises(EngineNotFoundError, match="Maia weights not found"):
        weights_path(tmp_path, 1500)


def test_resolve_binary_prefers_configured_path(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    exe = tmp_path / "sf"
    exe.write_text("#!/bin/sh\n")
    exe.chmod(0o755)
    monkeypatch.setattr(paths_module.shutil, "which", lambda name: None)
    assert resolve_binary("stockfish", str(exe)) == str(exe)


def test_resolve_binary_falls_back_to_path(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(paths_module.shutil, "which", lambda name: "/usr/bin/stockfish")
    assert resolve_binary("stockfish", None) == "/usr/bin/stockfish"


def test_resolve_binary_missing(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(paths_module.shutil, "which", lambda name: None)
    with pytest.raises(EngineNotFoundError, match="brew install lc0"):
        resolve_binary("lc0", str(tmp_path / "nope"))


def test_popen_uci_delegates_to_python_chess(monkeypatch: pytest.MonkeyPatch) -> None:
    sentinel = FakeBackend()
    monkeypatch.setattr(
        chess.engine.SimpleEngine, "popen_uci", classmethod(lambda cls, path: sentinel)
    )
    assert popen_uci("/bin/stockfish") is sentinel


@pytest.mark.live
def test_live_stockfish_oracle_finds_mate() -> None:
    with Oracle.open(config=OracleConfig(depth=10, multipv=2)) as oracle:
        evaluation = oracle.evaluate(chess.Board("6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1"))
    assert evaluation.best.uci == "a1a8"
    assert evaluation.best.mate == 1


@pytest.mark.live
def test_live_maia_plays_a_legal_move() -> None:
    board = chess.Board()
    with MaiaOpponent.open(1100, Path("engines/maia")) as maia:
        assert maia.play(board) in board.legal_moves
