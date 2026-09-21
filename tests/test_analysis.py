import random
from pathlib import Path

import chess
import pytest

from jev_chess.analysis import (
    JevRecord,
    LabelMove,
    OracleLabel,
    PositionRecord,
    RandomOpener,
    RankedCandidate,
    SampleConfig,
    calibration,
    join,
    label_one,
    label_positions,
    phase_of,
    pick_positions,
    play_game,
    rank_positions,
    read_jsonl,
    recall_report,
    sample_positions,
    to_record,
    write_jsonl,
)
from jev_chess.analysis.records import Phase
from jev_chess.engines import Oracle, OracleConfig
from jev_chess.policies import Candidate, JevConfig, JevPolicy, JevRanking
from tests.fake_jev import FakeClassifier, choice_response
from tests.fakes import FakeBackend, info


class RandomPlayer:
    def __init__(self, seed: int) -> None:
        self._rng = random.Random(seed)

    def play(self, board: chess.Board) -> chess.Move:
        return self._rng.choice(list(board.legal_moves))


def position(
    id_: str = "g0000-010", fen: str = chess.STARTING_FEN, phase: Phase = "middlegame"
) -> PositionRecord:
    return PositionRecord(
        id=id_, fen=fen, ply=10, phase=phase, game_id="g0000", white="1100", black="1500"
    )


# --- records ------------------------------------------------------------------------------


def test_jsonl_round_trip(tmp_path: Path) -> None:
    path = tmp_path / "nested" / "p.jsonl"
    records = [position("a"), position("b")]
    assert write_jsonl(path, records) == 2
    path.write_text(path.read_text() + "\n\n")
    assert list(read_jsonl(path, PositionRecord)) == records


# --- sampling -----------------------------------------------------------------------------


def test_phase_of() -> None:
    assert phase_of(chess.Board()) == "opening"
    middlegame = chess.Board(
        "r1bq1rk1/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQ1RK1 w - - 8 11"
    )
    assert phase_of(middlegame) == "middlegame"
    assert phase_of(chess.Board("4k3/8/8/8/8/8/4P3/R3K3 w - - 0 40")) == "endgame"


def test_random_opener_avoids_losing_material_and_king_moves() -> None:
    opener = RandomOpener(random.Random(1))
    board = chess.Board("r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4")
    for _ in range(20):
        move = opener.play(board)
        assert move.uci() not in {"f3e5", "c4f7", "e1e2", "e1f1", "e1g1"}


def test_random_opener_falls_back_when_every_move_is_bad() -> None:
    # Lone king: only king moves exist.
    board = chess.Board("7k/8/8/8/8/8/8/K7 w - - 0 1")
    assert RandomOpener(random.Random(1)).play(board) in board.legal_moves


def test_play_game_returns_snapshot_per_ply() -> None:
    boards = play_game(
        RandomPlayer(1), RandomPlayer(2), RandomPlayer(3), opening_plies=4, max_plies=30
    )
    assert boards[0].fen() == chess.STARTING_FEN
    assert 2 <= len(boards) <= 31
    assert all(b.move_stack == [] for b in boards)


def test_pick_positions_respects_bounds_and_ids() -> None:
    boards = play_game(RandomPlayer(1), RandomPlayer(2), RandomPlayer(3), 4, 40)
    config = SampleConfig(per_game=3, min_ply=10, max_ply=20)
    records = pick_positions(boards, random.Random(0), config, "g0007", "1100", "1900")
    assert 1 <= len(records) <= 3
    assert all(10 <= r.ply <= 20 for r in records)
    assert all(r.id == f"g0007-{r.ply:03d}" for r in records)
    assert [r.ply for r in records] == sorted(r.ply for r in records)


def test_pick_positions_handles_short_games() -> None:
    boards = [chess.Board()] * 5
    assert pick_positions(boards, random.Random(0), SampleConfig(), "g", "a", "b") == []


def test_sample_positions_is_deterministic_and_bounded() -> None:
    def players(rating: str) -> RandomPlayer:
        return RandomPlayer(int(rating))

    config = SampleConfig(n=7, per_game=3, max_plies=40, seed=3, ratings=("1", "2"))
    first = list(sample_positions(players, config))
    second = list(sample_positions(players, config))
    assert len(first) == 7
    assert first == second
    assert len({r.game_id for r in first}) >= 3


# --- labelling ----------------------------------------------------------------------------


def test_label_one_and_parallel_labelling_preserve_order() -> None:
    def open_oracle() -> Oracle:
        return Oracle(
            FakeBackend(scripted_infos=[info("e2e4", cp=30), info("d2d4", cp=20)]),
            OracleConfig(depth=6),
        )

    records = [position(f"p{i}") for i in range(5)]
    seen: list[str] = []
    labels = label_positions(
        records, open_oracle, depth=6, workers=3, progress=lambda lab: seen.append(lab.id)
    )
    assert [lab.id for lab in labels] == [r.id for r in records]
    assert labels[0].best == LabelMove(uci="e2e4", cp=30, mate=None)
    assert labels[0].depth == 6
    assert sorted(seen) == sorted(r.id for r in records)
    assert label_positions([], open_oracle, depth=6) == []
    assert label_one(open_oracle(), records[0], 6).ranked[1].uci == "d2d4"


# --- ranking ------------------------------------------------------------------------------


async def test_rank_positions_uses_policy_concurrently() -> None:
    fake = FakeClassifier(scripted=choice_response({"e2e4": 0.7, "d2d4": 0.3}, confidence=0.6))
    policy = JevPolicy(fake, JevConfig(style="terse"))
    records = [position(f"p{i}") for i in range(4)]
    done: list[str] = []
    out = await rank_positions(records, policy, concurrency=2, progress=lambda r: done.append(r.id))
    assert [r.id for r in out] == [r.id for r in records]
    assert out[0].style == "terse"
    assert out[0].candidates[0] == RankedCandidate(uci="e2e4", probability=0.7)
    assert sorted(done) == sorted(r.id for r in records)


def test_to_record_copies_telemetry() -> None:
    ranking = JevRanking((Candidate("e2e4", 1.0),), 0.9, "jev-x", 120, 30, 250.0)
    record = to_record(position(), ranking, "rich")
    assert (record.model, record.input_tokens, record.output_tokens, record.latency_ms) == (
        "jev-x",
        120,
        30,
        250.0,
    )


# --- recall -------------------------------------------------------------------------------


def label(id_: str, *moves: tuple[str, int | None, int | None]) -> OracleLabel:
    return OracleLabel(
        id=id_, depth=16, ranked=[LabelMove(uci=u, cp=cp, mate=m) for u, cp, m in moves]
    )


def ranking(id_: str, probs: dict[str, float], confidence: float) -> JevRecord:
    ordered = sorted(probs.items(), key=lambda kv: -kv[1])
    return JevRecord(
        id=id_,
        model="jev-test",
        style="rich",
        candidates=[RankedCandidate(uci=u, probability=p) for u, p in ordered],
        confidence=confidence,
        input_tokens=100,
        output_tokens=10,
        latency_ms=200.0,
    )


def test_join_and_recall_report() -> None:
    positions = [
        position("a", phase="opening"),
        position("b", phase="middlegame"),
        position("c", phase="endgame"),
        position("orphan"),
    ]
    labels = [
        label("a", ("e2e4", 30, None), ("d2d4", 20, None), ("c2c4", 10, None)),
        label("b", ("a1a8", None, 1), ("a1a2", 900, None)),
        label("c", ("g1f3", 5, None), ("b1c3", 0, None)),
    ]
    rankings = [
        ranking("a", {"e2e4": 0.6, "d2d4": 0.4}, confidence=0.95),  # top-1 hit, no loss
        ranking("b", {"a1a2": 0.5, "a1a8": 0.3, "h2h4": 0.2}, confidence=0.45),  # best at rank 2
        ranking("c", {"h2h4": 0.9, "g1f3": 0.1}, confidence=1.0),  # top move unknown to oracle
    ]
    rows = join(positions, labels, rankings)
    assert [r.position.id for r in rows] == ["a", "b", "c"]
    assert rows[1].jev_margin == pytest.approx(0.2)

    report = recall_report(rows, ks=(1, 2))
    assert report.n == 3
    assert report.recall_at == {1: pytest.approx(1 / 3), 2: 1.0}
    assert report.oracle_top3_hit_at[1] == pytest.approx(2 / 3)
    assert report.recall_by_phase["opening"] == {1: 1.0, 2: 1.0}
    assert report.recall_by_phase["endgame"] == {1: 0.0, 2: 1.0}
    assert report.mean_cp_loss == pytest.approx((0 + (100_000 - 1 - 900)) / 2)
    assert report.cp_loss_coverage == pytest.approx(2 / 3)
    assert report.mean_latency_ms == 200.0
    assert report.mean_input_tokens == 100.0
    top_bucket = report.confidence_calibration[-1]
    assert (top_bucket.count, top_bucket.accuracy) == (2, 0.5)
    assert report.confidence_calibration[4].count == 1
    assert report.confidence_calibration[0].accuracy is None


def test_recall_report_on_empty_input() -> None:
    report = recall_report([], ks=(1,))
    assert report.n == 0
    assert report.recall_at == {1: 0.0}
    assert report.mean_cp_loss is None
    assert report.cp_loss_coverage == 0.0
    assert all(b.count == 0 for b in calibration([], "jev_confidence"))


def test_joined_helpers() -> None:
    rows = join(
        [position("x")], [label("x", ("e2e4", 10, None))], [ranking("x", {"e2e4": 1.0}, 0.9)]
    )
    row = rows[0]
    assert row.jev_top == "e2e4"
    assert row.jev_margin == 1.0
    assert row.jev_rank_of("zzz") is None
    assert row.cp_loss_of_jev_top() == 0
    mated = join(
        [position("y")],
        [label("y", ("a1a8", None, 1), ("a1a2", None, -2))],
        [ranking("y", {"a1a2": 0.8, "a1a8": 0.2}, 0.5)],
    )[0]
    assert mated.cp_loss_of_jev_top() == (100_000 - 1) - (-100_000 + 2)
