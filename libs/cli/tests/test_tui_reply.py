import chess
import pytest

from langchain_chess_cli.tui.reply import (
    FORCED,
    IN_FLIGHT,
    PIPELINES,
    GameSoFar,
    Pending,
    Played,
    Stat,
    cost_text,
    gate_line,
    latest_reply,
    live_systemone,
    llm_notes,
    money,
    move_heading,
    pace_ratio,
    rank_note,
    reply_at,
    seconds,
    so_far,
    so_far_line,
    source_label,
    sources_line,
    stage_stats,
    stage_statuses,
    stages_of,
    stat_text,
    turn_key,
)
from langchain_chess_cli.tui.view import positions

AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"


def call(kind, cost=0.001, complete=True, model="m"):
    return {"kind": kind, "model": model, "cost_usd": cost, "cost_complete": complete}


def turn(tid, status="committed", calls=(), latency=3000.0, allowed=20, illegal=0):
    return {
        "id": tid,
        "status": status,
        "calls": list(calls),
        "latency_ms": latency,
        "initial_allowed": ["x"] * allowed,
        "illegal_attempts": illegal,
    }


def meta(status="shortlist", latency=800.0, **extra):
    return {
        "status": status,
        "model": "semif",
        "top": [{"uci": "e7e5", "probability": 0.6}, {"uci": "c7c5", "probability": 0.3}],
        "shortlist": [],
        "gate": "margin",
        "signal": 0.3,
        "threshold_used": 0.9,
        "tournament": None,
        "latency_ms": latency,
        **extra,
    }


def ply(index, uci, san, source, tid=None, latency=3000.0, systemone=None, model=None):
    return {
        "ply": index,
        "uci": uci,
        "san": san,
        "source": source,
        "turn_id": tid,
        "latency_ms": latency,
        "model": model,
        "analysis": "Because." if source == "llm" else None,
        "meta": {"SystemOneMiddleware": systemone} if systemone else {},
    }


def game():
    """1. e4 (you) e5 (LLM, after System 1 shortlisted) 2. Nf3 (you) Nc6 (System 1)."""
    return {
        "moves": ["e2e4", "e7e5", "g1f3", "b8c6"],
        "plies": [
            ply(0, "e2e4", "e4", "external"),
            ply(1, "e7e5", "e5", "llm", "t1", systemone=meta(), model="glm"),
            ply(2, "g1f3", "Nf3", "external"),
            ply(
                3, "b8c6", "Nc6", "systemone", "t2", latency=500.0, systemone=meta("played", 500.0)
            ),
        ],
        "turns": [
            turn("t1", calls=[call("systemone", None), call("llm", 0.002)]),
            turn("t2", calls=[call("systemone", None)], latency=500.0),
        ],
    }


def test_stages_follow_the_policy_and_a_forced_turn_is_known_early():
    assert stages_of("hybrid", None, None) == PIPELINES["hybrid"]
    assert stages_of("hybrid", turn("t", allowed=1), None) == FORCED
    assert stages_of("llm", None, ply(0, "a", "a", "forced")) == FORCED


def test_reply_at_is_the_agent_move_before_the_position():
    values = game()
    fens = positions(values)
    assert reply_at(values, fens, 1, "hybrid") is None
    reply = reply_at(values, fens, 3, "hybrid")
    assert reply is not None
    assert reply.ply["san"] == "e5"
    assert reply.fen_before == fens[1]
    assert reply.turn["id"] == "t1"
    assert reply_at(values, fens, 4, "hybrid").ply["san"] == "Nc6"


def latest(values, fens, *, analysis="", running=False, error=None, run_from=None):
    return latest_reply(
        values,
        fens,
        "hybrid",
        analysis=analysis,
        running=running,
        error=error,
        run_from=turn_key(values) if run_from is None else run_from,
        sent_from="sent-from",
    )


def test_the_latest_reply_is_the_open_turn_while_there_is_one():
    values = game()
    fens = positions(values)
    assert latest(values, fens).ply["san"] == "Nc6"
    live = {**meta("shortlist"), "turn_id": "t3", "calls": [call("systemone", 0.0001)]}
    pending = {**values, "turns": [*values["turns"], turn("t3", "pending")], "systemone_live": live}
    reply = latest(pending, fens, analysis="So…", running=True, error="boom")
    assert isinstance(reply, Pending)
    assert (reply.systemone, reply.analysis, reply.error, reply.fen_before) == (
        live,
        "So…",
        None,
        fens[-1],
    )
    stopped = latest(pending, fens, error="boom")
    assert stopped.error == "boom"


def test_a_run_out_before_its_turn_lands_shows_a_stand_in():
    values = game()
    fens = positions(values)
    sent = turn_key(values)
    reply = latest(values, fens, analysis="Hmm", running=True, run_from=sent)
    assert isinstance(reply, Pending)
    assert reply.turn == IN_FLIGHT
    assert reply.fen_before == "sent-from"
    assert stage_statuses(reply) == ("running", "waiting")
    # A commit that lands before the run stops shows at once.
    landed = {**values, "turns": [*values["turns"], turn("t3")]}
    assert isinstance(latest(landed, fens, running=True, run_from=sent), Played)
    assert turn_key({}) == ""
    assert turn_key(values) == "t2:committed"


def test_live_systemone_only_for_the_last_pending_turn():
    live = {"turn_id": "t1"}
    assert live_systemone({"turns": [turn("t1", "pending")], "systemone_live": live}) == live
    assert live_systemone({"turns": [turn("t1")], "systemone_live": live}) is None
    assert live_systemone({"turns": [turn("t2", "pending")], "systemone_live": live}) is None
    assert live_systemone({"turns": []}) is None


def played(source="llm", systemone=None, calls=(), stages="hybrid", turned=True):
    t = turn("t", calls=calls) if turned else None
    return Played(
        ply(1, "e7e5", "e5", source, "t", systemone=systemone), t, AFTER_E4, PIPELINES[stages]
    )


def pending(live=None, running=True, stages="hybrid"):
    return Pending(turn("t", "pending"), AFTER_E4, PIPELINES[stages], live, "", running, None)


@pytest.mark.parametrize(
    ("reply", "statuses"),
    [
        (played(systemone=meta()), ("done", "done")),
        (played("systemone", meta("played")), ("done", "not-needed")),
        # An LLM that ran and was overruled still ran.
        (played("book", meta(), calls=[call("llm")]), ("done", "done")),
        (played(systemone=meta("skipped")), ("skipped", "done")),
        (played(stages="llm"), (None, "done")),
        (played("systemone", meta("played"), stages="systemone"), ("done", None)),
        (
            played(turned=False, source="systemone", systemone=meta("played")),
            ("done", "not-needed"),
        ),
        (pending(), ("running", "waiting")),
        (pending(stages="llm"), (None, "running")),
        (pending(meta()), ("done", "running")),
        (pending(meta("played")), ("done", "not-needed")),
        (pending(meta("skipped")), ("skipped", "running")),
        (pending(running=False), ("failed", "failed")),
        # The run can fail while finalizing a decision System 1 already made.
        (pending(meta("played"), running=False), ("done", "not-needed")),
        (Played(ply(1, "e7e5", "e5", "forced"), None, AFTER_E4, FORCED), (None, None)),
    ],
)
def test_stage_statuses(reply, statuses):
    assert stage_statuses(reply) == statuses


def test_stage_stats_split_a_committed_turn():
    reply = played(
        systemone=meta(latency=800.0),
        calls=[call("systemone", 0.0001), call("llm", 0.002), call("summary", 0.0005)],
    )
    stats = stage_stats(reply)
    assert stats.systemone == Stat(800.0, {"usd": 0.0001, "complete": True})
    assert stats.llm.model_ms == 2200.0
    assert stats.llm.cost["usd"] == pytest.approx(0.0025)
    assert stats.summary_cost == {"usd": 0.0005, "complete": True}
    # Without System 1's time, the LLM's share is unknown.
    no_time = {**meta(), "latency_ms": None}
    assert stage_stats(played(systemone=no_time)).llm.model_ms is None
    assert stage_stats(played(stages="llm")).llm.model_ms == 3000.0
    assert stage_stats(played(turned=False, systemone=meta())).llm == Stat(None, None)


def test_stage_stats_of_a_pending_turn():
    live = {**meta(), "calls": [call("systemone", 0.0001)]}
    stats = stage_stats(pending(live))
    assert stats.systemone == Stat(800.0, {"usd": 0.0001, "complete": True})
    # No LLM call has finished, so its time isn't known yet.
    assert stats.llm.model_ms is None
    done = Pending(
        turn("t", "pending", calls=[call("llm")], latency=1200.0),
        AFTER_E4,
        PIPELINES["hybrid"],
        None,
        "",
        True,
        None,
    )
    assert stage_stats(done).llm.model_ms == 1200.0
    assert stage_stats(done).systemone == Stat(None, None)
    forced = Played(ply(1, "e7e5", "e5", "forced"), None, AFTER_E4, FORCED)
    assert stage_stats(forced).llm is None


def test_so_far_counts_every_call_through_the_position():
    values = game()
    live = so_far(values, 4, live=True)
    assert live == GameSoFar(
        cost={"usd": 0.002, "complete": False},
        agent_moves=2,
        avg_model_ms=1750.0,
        by_source={"systemone": 1, "llm": 1, "forced": 0, "other": 0},
        abandoned=0,
    )
    # Before Nc6, only e5's turn counts.
    earlier = so_far(values, 3, live=False)
    assert earlier is not None
    assert earlier.agent_moves == 1
    assert so_far(values, 1, live=False) is None
    assert so_far({}, 0, live=True) is None


def test_so_far_adds_a_pending_turns_live_calls_and_names_the_rest():
    values = game()
    values["turns"] += [turn("t3", "abandoned"), turn("t4", "pending")]
    values["plies"].append(ply(4, "a2a3", "a3", "book", "t1"))
    values["systemone_live"] = {"turn_id": "t4", "calls": [call("systemone", 0.01)]}
    result = so_far(values, 5, live=True)
    assert result is not None
    assert result.cost["usd"] == pytest.approx(0.012)
    assert result.by_source["other"] == 1
    assert result.abandoned == 1
    assert sources_line(result) == "System 1 played 1 · LLM 1 · other 1 · 1 abandoned turn"


def test_pace_stands_out_only_after_three_moves():
    def so(moves, avg):
        return GameSoFar(None, moves, avg, {}, 0)

    assert pace_ratio(3000.0, so(2, 1000.0)) is None
    assert pace_ratio(3000.0, so(3, 1000.0)) == 3.0
    assert pace_ratio(400.0, so(3, 1000.0)) == 0.4
    assert pace_ratio(1000.0, so(3, 1000.0)) is None
    assert pace_ratio(1000.0, so(3, 0.0)) is None


def test_words():
    assert money(0.00125) == "$0.0013"
    assert money(0.125) == "$0.125"
    assert cost_text(None) == "—"
    assert cost_text({"usd": 0.001, "complete": False}) == "$0.0010+"
    assert seconds(1530) == "1.5 s"
    assert seconds(412.4) == "412 ms"
    assert source_label("systemone") == "System 1 played"
    assert source_label("book") == "book"
    assert move_heading(AFTER_E4) == "Move 1 · Black"
    assert move_heading(chess.STARTING_FEN) == "Move 1 · White"
    assert stat_text(Stat(None, None)) == "— · —"
    assert stat_text(Stat(400.0, {"usd": 0.0001, "complete": True})) == "400 ms · $0.0001"


def test_gate_line():
    assert gate_line(meta(), None) == "Not confident enough: margin 0.30, bar 0.90 → asked the LLM"
    assert gate_line(meta("played", signal=0.95), "e5") == (
        "Confident: margin 0.95, bar 0.90 → played e5"
    )
    assert gate_line(meta("played", signal=0.95), None).endswith("played its top move")
    assert gate_line(meta(threshold_used=1.0, tournament={}), None) == (
        "Never plays alone (bar 1.00) → asked the LLM"
    )
    assert gate_line(meta(tournament={"rounds": 2}), None).endswith("(ranked in rounds)")
    assert gate_line(meta("skipped"), None) is None
    assert gate_line(meta(signal=None), None) is None


def test_rank_note_and_llm_notes():
    ranking = meta()["top"]
    assert rank_note(ranking, "c7c5", "c5") == "c5: System 1's #2 (30%)"
    assert rank_note(ranking, "d7d5", "d5") == "d5: not in System 1's top 2"
    assert (
        llm_notes(
            error=None, illegal_attempts=0, san=None, rank=None, summary_cost=None, summarized=False
        )
        is None
    )
    assert (
        llm_notes(
            error="timeout",
            illegal_attempts=2,
            san=None,
            rank=None,
            summary_cost=None,
            summarized=False,
        )
        == "timeout · 2 illegal moves so far"
    )
    assert (
        llm_notes(
            error=None,
            illegal_attempts=1,
            san="e5",
            rank="e5: System 1's #1 (60%)",
            summary_cost={"usd": 0.0002, "complete": True},
            summarized=True,
        )
        == "1 illegal move before e5 · e5: System 1's #1 (60%) · Memory summarized · $0.0002"
    )


def test_so_far_line():
    assert so_far_line(GameSoFar(None, 1, 1530.0, {}, 0), None) == "1 move · avg 1.5 s model time"
    assert so_far_line(GameSoFar(None, 0, None, {}, 0), None) == "0 moves"
    assert so_far_line(GameSoFar(None, 3, 1000.0, {}, 0), 2.0).endswith("this move 2.0× avg")  # noqa: RUF001
    forced = GameSoFar(None, 1, 1.0, {"systemone": 0, "llm": 0, "forced": 1, "other": 0}, 0)
    assert sources_line(forced) == "forced 1"
