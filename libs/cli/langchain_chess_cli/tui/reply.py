"""The Last Reply panel: the agent's turn stage by stage, and the game so far. Pure.

Ports `stages.ts`, `turnStats.ts` and `turnText.ts` from `packages/chess-ui`, without token
details, so both apps account for a turn in the same words. "Model time" is always the recorded
`latency_ms`, never wall-clock time.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal

import chess

from langchain_chess import turn_cost
from langchain_chess.pricing import TurnCost

type Values = Mapping[str, Any]
type StageStatus = Literal["waiting", "running", "done", "skipped", "not-needed", "failed"]

SYSTEMONE_META = "SystemOneMiddleware"


@dataclass(frozen=True, slots=True)
class Stages:
    """A turn's pipeline; `forced` when its only legal move was played without either."""

    forced: bool
    systemone: bool
    llm: bool


FORCED = Stages(forced=True, systemone=False, llm=False)
PIPELINES = {
    "hybrid": Stages(forced=False, systemone=True, llm=True),
    "systemone": Stages(forced=False, systemone=True, llm=False),
    "llm": Stages(forced=False, systemone=False, llm=True),
}


@dataclass(frozen=True, slots=True)
class Played:
    """A committed agent move, with its turn and the position it was chosen in."""

    ply: Mapping[str, Any]
    turn: Mapping[str, Any] | None
    fen_before: str
    stages: Stages


@dataclass(frozen=True, slots=True)
class Pending:
    """The agent's open turn: thinking, or stopped by a failed run."""

    turn: Mapping[str, Any]
    fen_before: str
    stages: Stages
    systemone: Mapping[str, Any] | None
    """System 1's live result, once it has one."""
    analysis: str
    running: bool
    error: str | None


type ReplyState = Played | Pending | None


@dataclass(frozen=True, slots=True)
class Stat:
    """A stage's model time and cost; None wherever it's unknown, never zero."""

    model_ms: float | None
    cost: TurnCost | None


@dataclass(frozen=True, slots=True)
class StageStats:
    systemone: Stat | None
    llm: Stat | None
    summary_cost: TurnCost | None
    """The memory summaries' cost: they aren't timed separately."""


def systemone_meta(ply: Mapping[str, Any]) -> Mapping[str, Any] | None:
    meta = ply["meta"].get(SYSTEMONE_META)
    return meta if meta and isinstance(meta.get("status"), str) else None


def turn_of(ply: Mapping[str, Any], turns: Sequence[Mapping[str, Any]]) -> Mapping[str, Any] | None:
    return next((t for t in turns if t["id"] == ply["turn_id"]), None)


def stages_of(policy: str, turn: Mapping[str, Any] | None, ply: Mapping[str, Any] | None) -> Stages:
    """A forced turn is known when it opens, so the panel never switches at commit."""
    if (turn is not None and len(turn["initial_allowed"]) == 1) or (
        ply is not None and ply["source"] == "forced"
    ):
        return FORCED
    return PIPELINES[policy]


def reply_at(values: Values, fens: Sequence[str], index: int, policy: str) -> Played | None:
    """The reply that led to position `index`: the latest agent move before it."""
    turns = values.get("turns") or []
    for ply in reversed(values.get("plies") or []):
        if ply["ply"] < index and ply["source"] != "external":
            turn = turn_of(ply, turns)
            return Played(ply, turn, fens[ply["ply"]], stages_of(policy, turn, ply))
    return None


def live_systemone(values: Values) -> Mapping[str, Any] | None:
    """System 1's live result, only while its turn is the last one and still pending."""
    live = values.get("systemone_live")
    turns = values.get("turns") or []
    if live and turns and turns[-1]["status"] == "pending" and live["turn_id"] == turns[-1]["id"]:
        return live
    return None


IN_FLIGHT: Mapping[str, Any] = {
    "id": "",
    "status": "pending",
    "calls": [],
    "latency_ms": 0.0,
    "initial_allowed": [],
    "illegal_attempts": 0,
}
"""A run's turn before the server records one, as the web's `IN_FLIGHT`."""


def turn_key(values: Values) -> str:
    """The last turn and its status: a new key while a run is out means its turn landed."""
    turns = values.get("turns") or []
    return f"{turns[-1]['id']}:{turns[-1]['status']}" if turns else ""


def latest_reply(
    values: Values,
    fens: Sequence[str],
    policy: str,
    *,
    analysis: str,
    running: bool,
    error: str | None,
    run_from: str,
    sent_from: str,
) -> ReplyState:
    """The open turn while there is one, and a stand-in for it while a run is out before the
    server records it; else the latest agent move. `run_from` is `turn_key` when the run was
    sent or its turn opened, and `sent_from` the position the agent moves from."""
    turns = values.get("turns") or []
    open = turns[-1] if turns and turns[-1]["status"] == "pending" else None
    # A commit can land before the run stops: it shows at once, never the stand-in.
    landed = turn_key(values) != run_from
    if open is None and (not running or landed):
        return reply_at(values, fens, len(fens), policy)
    turn = open or IN_FLIGHT
    return Pending(
        turn=turn,
        fen_before=fens[-1] if open else sent_from,
        stages=stages_of(policy, turn, None),
        systemone=live_systemone(values),
        analysis=analysis,
        running=running,
        error=None if running else error,
    )


def stage_statuses(reply: Played | Pending) -> tuple[StageStatus | None, StageStatus | None]:
    """Where System 1 and the LLM stand; None where the turn has no such stage. A stopped turn
    whose System 1 already played keeps it done: the run can fail while finalizing."""
    stages = reply.stages
    if stages.forced:
        return None, None
    if isinstance(reply, Played):
        meta = systemone_meta(reply.ply)
        calls = reply.turn["calls"] if reply.turn else []
        ran = reply.ply["source"] == "llm" or any(c["kind"] == "llm" for c in calls)
        systemone: StageStatus = "skipped" if meta and meta["status"] == "skipped" else "done"
        llm: StageStatus = "done" if ran else "not-needed"
    else:
        live, stopped = reply.systemone, not reply.running
        if live:
            systemone = "skipped" if live["status"] == "skipped" else "done"
        else:
            systemone = "failed" if stopped else "running"
        if live and live["status"] == "played":
            llm = "not-needed"
        elif stopped:
            llm = "failed"
        else:
            llm = "waiting" if stages.systemone and not live else "running"
    return (systemone if stages.systemone else None, llm if stages.llm else None)


def _of_kind(calls: Sequence[Mapping[str, Any]], *kinds: str) -> list[Any]:
    return [c for c in calls if c["kind"] in kinds]


def stage_stats(reply: Played | Pending) -> StageStats:
    """System 1's calls join a turn only when it finalizes, so a pending turn's come from the
    live result, and a pending turn's time is only the LLM calls completed so far."""
    stages, turn = reply.stages, reply.turn
    if stages.forced:
        return StageStats(None, None, None)
    pending = isinstance(reply, Pending)
    meta = reply.systemone if isinstance(reply, Pending) else systemone_meta(reply.ply)
    systemone_ms = meta.get("latency_ms") if meta else None
    calls = turn["calls"] if turn else []
    if pending:
        systemone_calls = list(meta["calls"]) if meta and "calls" in meta else []
    else:
        systemone_calls = _of_kind(calls, "systemone")
    llm_calls = _of_kind(calls, "llm", "summary")

    def stat(stage_calls: Sequence[Any], model_ms: float | None) -> Stat:
        return Stat(model_ms, turn_cost(stage_calls)) if turn else Stat(None, None)

    if turn is None:
        llm_ms = None
    elif pending:
        # Summaries aren't timed: only a completed model call makes the time known.
        llm_ms = turn["latency_ms"] if any(c["kind"] == "llm" for c in llm_calls) else None
    elif not stages.systemone:
        llm_ms = turn["latency_ms"]
    else:
        llm_ms = None if systemone_ms is None else turn["latency_ms"] - systemone_ms
    return StageStats(
        systemone=stat(systemone_calls, systemone_ms) if stages.systemone else None,
        llm=stat(llm_calls, llm_ms) if stages.llm else None,
        summary_cost=turn_cost(_of_kind(calls, "summary")) if turn else None,
    )


@dataclass(frozen=True, slots=True)
class GameSoFar:
    cost: TurnCost | None
    agent_moves: int
    avg_model_ms: float | None
    """The average model time of the agent's moves; None before the first."""
    by_source: Mapping[str, int]
    abandoned: int


def so_far(values: Values, index: int, *, live: bool) -> GameSoFar | None:
    """Every call's cost through position `index`, plus a pending turn's live System 1 calls.
    An earlier position stops at the turn of the last agent move before it, because a turn
    records no position until it commits. None before any turn counts."""
    turns, plies = values.get("turns") or [], values.get("plies") or []
    if live:
        through = len(turns) - 1
    else:
        reply = next(
            (p for p in reversed(plies) if p["ply"] < index and p["source"] != "external"), None
        )
        turn = turn_of(reply, turns) if reply else None
        through = turns.index(turn) if turn else -1
    if through < 0:
        return None
    counted = turns[: through + 1]
    calls = [c for t in counted for c in t["calls"]]
    pending = live_systemone(values)
    if pending and any(t["id"] == pending["turn_id"] for t in counted):
        calls += pending["calls"]
    committed = {t["id"] for t in counted if t["status"] == "committed"}
    moves = [p for p in plies if p["turn_id"] in committed]
    by_source = {"systemone": 0, "llm": 0, "forced": 0, "other": 0}
    for ply in moves:
        source = ply["source"] if ply["source"] in by_source else "other"
        by_source[source] += 1
    return GameSoFar(
        cost=turn_cost(calls),
        agent_moves=len(moves),
        avg_model_ms=sum(p["latency_ms"] for p in moves) / len(moves) if moves else None,
        by_source=by_source,
        abandoned=sum(t["status"] == "abandoned" for t in counted),
    )


PACE_MOVES = 3


def pace_ratio(model_ms: float, game: GameSoFar) -> float | None:
    """How a move's model time compares with the game's average, when it stands out: at least
    1.5 times or at most half, once there are three agent moves."""
    if game.agent_moves < PACE_MOVES or not game.avg_model_ms:
        return None
    ratio = model_ms / game.avg_model_ms
    return ratio if ratio >= 1.5 or ratio <= 0.5 else None


# ---- words --------------------------------------------------------------------------------------


def money(usd: float) -> str:
    return f"${usd:.4f}" if usd < 0.01 else f"${usd:.3f}"


def cost_text(cost: TurnCost | None) -> str:
    """`—` when nothing was priced; `+` when the total is a lower bound."""
    if cost is None:
        return "—"
    return money(cost["usd"]) + ("" if cost["complete"] else "+")


def seconds(ms: float) -> str:
    return f"{ms / 1000:.1f} s" if ms >= 1000 else f"{round(ms)} ms"


def percent(probability: float) -> str:
    return f"{probability * 100:.0f}%"


SOURCE_LABELS = {
    "external": "Human",
    "llm": "LLM chose",
    "systemone": "System 1 played",
    "forced": "Forced move",
}


def source_label(source: str) -> str:
    return SOURCE_LABELS.get(source, source)


def move_heading(fen_before: str) -> str:
    """The move being decided, e.g. "Move 12 · Black"."""
    board = chess.Board(fen_before)
    side = "White" if board.turn == chess.WHITE else "Black"
    return f"Move {board.fullmove_number} · {side}"


def stat_text(stat: Stat) -> str:
    """A stage's model time and cost: "0.4 s · $0.0001"."""
    ms = "—" if stat.model_ms is None else seconds(stat.model_ms)
    return f"{ms} · {cost_text(stat.cost)}"


def gate_line(facts: Mapping[str, Any], played: str | None) -> str | None:
    """Why the LLM was or wasn't called. `played` is the SAN System 1 played; None when System 1
    was skipped or the metadata predates the gate's facts."""
    signal, bar = facts.get("signal"), facts.get("threshold_used")
    if facts["status"] == "skipped" or signal is None or bar is None:
        return None
    rounds = " (ranked in rounds)" if facts.get("tournament") else ""
    if bar >= 1:
        return f"Never plays alone (bar {bar:.2f}) → asked the LLM{rounds}"
    measure = f"{facts['gate']} {signal:.2f}, bar {bar:.2f}"
    if facts["status"] == "played":
        return f"Confident: {measure} → played {played or 'its top move'}{rounds}"
    return f"Not confident enough: {measure} → asked the LLM{rounds}"


def rank_note(ranking: Sequence[Mapping[str, Any]], uci: str, san: str) -> str:
    """The played move as System 1's ranking places it."""
    rank = next((i for i, m in enumerate(ranking) if m["uci"] == uci), None)
    if rank is None:
        return f"{san}: not in System 1's top {len(ranking)}"
    return f"{san}: System 1's #{rank + 1} ({percent(ranking[rank]['probability'])})"


def llm_notes(
    *,
    error: str | None,
    illegal_attempts: int,
    san: str | None,
    rank: str | None,
    summary_cost: TurnCost | None,
    summarized: bool,
) -> str | None:
    """The one line under the analysis, in order of priority."""
    notes = [error] if error else []
    if illegal_attempts:
        moves = "1 illegal move" if illegal_attempts == 1 else f"{illegal_attempts} illegal moves"
        notes.append(f"{moves} before {san}" if san else f"{moves} so far")
    if rank:
        notes.append(rank)
    if summarized:
        notes.append(f"Memory summarized · {cost_text(summary_cost)}")
    return " · ".join(notes) or None


def _plural(n: int, one: str) -> str:
    return f"{n} {one if n == 1 else one + 's'}"


def so_far_line(game: GameSoFar, pace: float | None) -> str:
    """E.g. "13 moves · avg 20.1 s model time", with the pace when this move stands out."""
    parts = [_plural(game.agent_moves, "move")]
    if game.avg_model_ms is not None:
        parts.append(f"avg {seconds(game.avg_model_ms)} model time")
    if pace is not None:
        parts.append(f"this move {pace:.1f}× avg")  # noqa: RUF001
    return " · ".join(parts)


def sources_line(game: GameSoFar) -> str:
    """The counts that aren't 0, e.g. "System 1 played 6 · LLM 7 · 1 abandoned turn"."""
    counts = game.by_source
    parts = [
        f"System 1 played {counts['systemone']}" if counts["systemone"] else "",
        f"LLM {counts['llm']}" if counts["llm"] else "",
        f"forced {counts['forced']}" if counts["forced"] else "",
        f"other {counts['other']}" if counts["other"] else "",
        _plural(game.abandoned, "abandoned turn") if game.abandoned else "",
    ]
    return " · ".join(part for part in parts if part)
