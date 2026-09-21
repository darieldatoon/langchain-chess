"""Score and Noul questions: request shape, parsing, and validation against Stockfish."""

import chess
import pytest
from langchain_typesafe import Choice, Noul, Score
from langchain_typesafe.types import NoulAnswer, Usage

from jev_chess.analysis import (
    JevRecord,
    LabelMove,
    OracleLabel,
    PositionRecord,
    RankedCandidate,
    gate_report,
    join,
    oracle_rung,
    oracle_tactic_present,
    score_report,
    tactics_calibration,
    to_record,
    white_cp,
)
from jev_chess.policies import JevConfig, JevPolicy, build_questions, parse_response
from tests.fake_jev import FakeClassifier, choice_response


def test_build_questions_all_three_primitives() -> None:
    questions = build_questions(chess.Board(), JevConfig(with_eval=True, with_nouls=True))
    assert set(questions) == {"move", "eval", "needs_calculation", "tactics_present"}
    assert isinstance(questions["move"], Choice)
    assert isinstance(questions["eval"], Score)
    assert len(questions["eval"].criteria) == 7
    calc = questions["needs_calculation"]
    assert isinstance(calc, Noul)
    assert calc.criteria is not None
    assert "calculating" in str(calc.criteria.true)
    assert "quickly on principle" in str(calc.criteria.false)
    assert "Prefer checkmate" not in str(questions["move"].instructions)


def test_build_questions_default_is_choice_only() -> None:
    assert set(build_questions(chess.Board(), JevConfig())) == {"move"}


def test_parse_response_reads_nouls_when_present() -> None:
    response = choice_response({"e2e4": 0.8, "d2d4": 0.2}, confidence=0.6, eval_score=4.2)
    response.answers["needs_calculation"] = NoulAnswer(type="noul", noul=0.72)
    response.answers["tactics_present"] = NoulAnswer(type="noul", noul=0.15)
    ranking = parse_response(response, 10.0)
    assert ranking.eval_score == 4.2
    assert ranking.needs_calculation == 0.72
    assert ranking.tactics_present == 0.15
    record = to_record(
        PositionRecord(
            id="p",
            fen=chess.STARTING_FEN,
            ply=1,
            phase="opening",
            game_id="g",
            white="a",
            black="b",
        ),
        ranking,
        "rich",
    )
    assert (record.eval_score, record.needs_calculation, record.tactics_present) == (
        4.2,
        0.72,
        0.15,
    )


def test_parse_response_without_extras_leaves_none() -> None:
    ranking = parse_response(choice_response({"e2e4": 1.0}), 0.0)
    assert ranking.eval_score is None
    assert ranking.needs_calculation is None
    assert ranking.tactics_present is None


def test_policy_sends_all_questions_when_configured() -> None:
    fake = FakeClassifier()
    JevPolicy(fake, JevConfig(with_eval=True, with_nouls=True)).rank(chess.Board())
    assert set(fake.requests[0]["questions"]) == {
        "move",
        "eval",
        "needs_calculation",
        "tactics_present",
    }


# --- validation helpers -------------------------------------------------------------------


@pytest.mark.parametrize(
    ("cp", "rung"),
    [
        (-900, 0),
        (-400, 0),
        (-399, 1),
        (-150, 1),
        (-149, 2),
        (-50, 2),
        (-49, 3),
        (0, 3),
        (49, 3),
        (50, 4),
        (149, 4),
        (150, 5),
        (399, 5),
        (400, 6),
        (5000, 6),
    ],
)
def test_oracle_rung_boundaries(cp: int, rung: int) -> None:
    assert oracle_rung(cp) == rung


def _row(
    fen: str,
    ranked: list[tuple[str, int | None, int | None]],
    probs: dict[str, float],
    confidence: float = 0.5,
    eval_score: float | None = None,
    needs_calculation: float | None = None,
    tactics_present: float | None = None,
    id_: str = "x",
):
    position = PositionRecord(
        id=id_, fen=fen, ply=10, phase="middlegame", game_id="g", white="a", black="b"
    )
    label = OracleLabel(
        id=id_, depth=16, ranked=[LabelMove(uci=u, cp=cp, mate=m) for u, cp, m in ranked]
    )
    ordered = sorted(probs.items(), key=lambda kv: -kv[1])
    ranking = JevRecord(
        id=id_,
        model="jev-test",
        style="rich",
        candidates=[RankedCandidate(uci=u, probability=p) for u, p in ordered],
        confidence=confidence,
        input_tokens=100,
        output_tokens=10,
        latency_ms=100.0,
        eval_score=eval_score,
        needs_calculation=needs_calculation,
        tactics_present=tactics_present,
    )
    return join([position], [label], [ranking])[0]


BLACK_TO_MOVE = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"


def test_white_cp_flips_for_black_and_handles_mate() -> None:
    assert white_cp(_row(chess.STARTING_FEN, [("e2e4", 30, None)], {"e2e4": 1.0})) == 30
    assert white_cp(_row(BLACK_TO_MOVE, [("e7e5", 30, None)], {"e7e5": 1.0})) == -30
    mate_for_black = _row(BLACK_TO_MOVE, [("e7e5", None, 2)], {"e7e5": 1.0})
    assert oracle_rung(white_cp(mate_for_black)) == 0


def test_oracle_tactic_present_rules() -> None:
    italian = "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4"
    capture = _row(italian, [("f3e5", 10, None), ("d2d3", 5, None)], {"f3e5": 1.0})
    check = _row(italian, [("c4f7", 10, None), ("d2d3", 5, None)], {"c4f7": 1.0})
    quiet_close = _row(italian, [("d2d3", 10, None), ("b1c3", 5, None)], {"d2d3": 1.0})
    quiet_gap = _row(italian, [("d2d3", 300, None), ("b1c3", 5, None)], {"d2d3": 1.0})
    only_one = _row(italian, [("d2d3", 10, None)], {"d2d3": 1.0})
    assert oracle_tactic_present(capture)
    assert oracle_tactic_present(check)
    assert not oracle_tactic_present(quiet_close)
    assert oracle_tactic_present(quiet_gap)
    assert not oracle_tactic_present(only_one)


def test_score_report_and_confusion() -> None:
    rows = [
        _row(chess.STARTING_FEN, [("e2e4", 20, None)], {"e2e4": 1.0}, eval_score=3.2, id_="a"),
        _row(chess.STARTING_FEN, [("e2e4", 200, None)], {"e2e4": 1.0}, eval_score=4.4, id_="b"),
        _row(chess.STARTING_FEN, [("e2e4", -500, None)], {"e2e4": 1.0}, eval_score=3.0, id_="c"),
        _row(chess.STARTING_FEN, [("e2e4", 0, None)], {"e2e4": 1.0}, eval_score=None, id_="d"),
    ]
    report = score_report(rows)
    assert report is not None
    assert report.n == 3
    assert report.exact == pytest.approx(1 / 3)
    assert report.within_one == pytest.approx(2 / 3)
    assert report.mean_abs_error == pytest.approx((0 + 1 + 3) / 3)
    assert report.confusion == {3: {3: 1}, 5: {4: 1}, 0: {3: 1}}
    assert score_report([rows[3]]) is None


def test_gate_report_compares_signals() -> None:
    rows = [
        _row(
            chess.STARTING_FEN,
            [("e2e4", 10, None)],
            {"e2e4": 0.95, "d2d4": 0.05},
            confidence=0.95,
            needs_calculation=0.05,
            id_="hit",
        ),
        _row(
            chess.STARTING_FEN,
            [("e2e4", 10, None)],
            {"d2d4": 0.6, "e2e4": 0.4},
            confidence=0.55,
            needs_calculation=0.9,
            id_="miss",
        ),
    ]
    points = {(p.signal, p.threshold): p for p in gate_report(rows, thresholds=(0.5, 0.9))}
    assert points[("confidence", 0.5)].kept == 1.0
    assert points[("confidence", 0.5)].accuracy == 0.5
    assert points[("confidence", 0.9)].kept == 0.5
    assert points[("confidence", 0.9)].accuracy == 1.0
    assert points[("1 - needs_calculation", 0.9)].kept == 0.5
    assert points[("1 - needs_calculation", 0.9)].accuracy == 1.0
    # 0.95 - 0.05 is just under 0.9 in floating point, so check margin at the lower threshold
    assert points[("margin", 0.5)].kept == 0.5
    assert points[("margin", 0.5)].accuracy == 1.0
    # No rows carry a noul -> that signal is skipped entirely
    no_noul = [_row(chess.STARTING_FEN, [("e2e4", 10, None)], {"e2e4": 1.0})]
    assert {p.signal for p in gate_report(no_noul)} == {"confidence", "margin"}
    # Threshold nobody clears -> kept 0, accuracy None
    assert gate_report(no_noul, thresholds=(2.0,))[0].accuracy is None


def test_tactics_calibration_buckets() -> None:
    italian = "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4"
    rows = [
        _row(
            italian,
            [("f3e5", 10, None), ("d2d3", 5, None)],
            {"f3e5": 1.0},
            tactics_present=0.9,
            id_="a",
        ),
        _row(
            italian,
            [("d2d3", 10, None), ("b1c3", 5, None)],
            {"d2d3": 1.0},
            tactics_present=1.0,
            id_="b",
        ),
        _row(
            italian,
            [("d2d3", 10, None), ("b1c3", 5, None)],
            {"d2d3": 1.0},
            tactics_present=0.1,
            id_="c",
        ),
        _row(italian, [("d2d3", 10, None)], {"d2d3": 1.0}, tactics_present=None, id_="d"),
    ]
    buckets = tactics_calibration(rows)
    assert [b.count for b in buckets] == [1, 0, 0, 0, 2]
    assert buckets[0].accuracy == 0.0
    assert buckets[4].accuracy == 0.5
    assert buckets[1].accuracy is None


def test_usage_none_tokens_default_to_zero() -> None:
    response = choice_response({"e2e4": 1.0})
    response.usage = Usage(input_tokens=None, output_tokens=None)
    ranking = parse_response(response, 0.0)
    assert (ranking.input_tokens, ranking.output_tokens) == (0, 0)
