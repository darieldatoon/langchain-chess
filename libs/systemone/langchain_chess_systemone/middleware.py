"""`SystemOneMiddleware`: a System 1 model ranks the moves; a gate decides who plays.

If the gate clears, SystemOne plays its top move and the LLM never runs. Otherwise it suggests a
shortlist of candidates, and the LLM may still play any allowed move. With `threshold=0` it
always plays (System 1 alone); with `threshold=1` it never does and only suggests.

The decision is frozen per turn and replayed on every retry, so a retry can never re-rank and
flip the gate: re-ranking .60/.25/.15 over a k=2 shortlist would turn a .35 margin into .41 and
cross a .40 threshold.
"""

import hashlib
from collections.abc import Mapping
from typing import Annotated, Any, NotRequired, TypedDict

from langchain.agents.middleware.types import OmitFromInput, PrivateStateAttr, hook_config

from langchain_chess import ChessMiddleware, ChessState, PositionView
from langchain_chess.state import Call, JSONValue
from langchain_chess_systemone.describe import DescriptionStyle
from langchain_chess_systemone.ranker import CHOICE_LIMIT, GatewayRanker
from langchain_chess_systemone.types import (
    Candidate,
    DecisionStatus,
    Gate,
    MoveDistribution,
    RankedMove,
    Ranker,
    RankingFailed,
    RankRequest,
    StageResult,
    SystemOneLive,
    Tournament,
)

TOP_MOVES = 5
"""How many of System 1's best moves the telemetry keeps for display."""


class FrozenDecision(TypedDict):
    turn_id: str
    status: DecisionStatus
    model: str
    ranking: list[RankedMove]
    """The validated distribution; after a tournament, finalists only."""
    shortlist: list[RankedMove]
    fallback: str | None
    played: str | None
    gate: Gate
    signal: float | None
    confidence: float | None
    margin: float | None
    threshold_used: float | None
    tournament: Tournament | None
    error: str | None
    latency_ms: float
    calls: list[Call]
    eval_score: float | None
    needs_calculation: float | None
    tactics_present: float | None


class SystemOneState(ChessState):
    systemone_turn: NotRequired[Annotated[FrozenDecision | None, PrivateStateAttr]]
    # Not private: clients show System 1's result while the LLM is still thinking.
    systemone_live: NotRequired[Annotated[SystemOneLive | None, OmitFromInput]]


def turn_seed(agent_seed: int, turn_id: str) -> int:
    """Repeatable within a turn, not across games. Never `hash()`: it's randomized per process."""
    return int.from_bytes(hashlib.sha256(f"{agent_seed}:{turn_id}".encode()).digest(), "big")


def _ranked(candidates: tuple[Candidate, ...]) -> list[RankedMove]:
    return [RankedMove(uci=c.uci, probability=c.probability) for c in candidates]


def _live(frozen: FrozenDecision) -> SystemOneLive:
    """`ply_meta` is built from this too, so the live payload and the ply never disagree."""
    return SystemOneLive(
        turn_id=frozen["turn_id"],
        status=frozen["status"],
        model=frozen["model"],
        top=frozen["ranking"][:TOP_MOVES],
        shortlist=frozen["shortlist"],
        gate=frozen["gate"],
        signal=frozen["signal"],
        confidence=frozen["confidence"],
        margin=frozen["margin"],
        threshold_used=frozen["threshold_used"],
        finalist_conditional=frozen["tournament"] is not None,
        tournament=frozen["tournament"],
        error=frozen["error"],
        latency_ms=frozen["latency_ms"],
        eval_score=frozen["eval_score"],
        needs_calculation=frozen["needs_calculation"],
        tactics_present=frozen["tactics_present"],
        calls=list(frozen["calls"]),
    )


_LIVE_ONLY = frozenset({"turn_id", "calls"})


class SystemOneMiddleware(ChessMiddleware):
    state_schema = SystemOneState

    def __init__(
        self,
        model: str,
        *,
        style: DescriptionStyle = "rich",
        gate: Gate = "margin",
        threshold: float = 0.9,
        tournament_threshold: float | None = None,
        k: int = 5,
        top_p: float | None = None,
        with_eval: bool = False,
        with_nouls: bool = False,
        has_model: bool = True,
        ranker: Ranker | None = None,
    ) -> None:
        if not 1 <= k <= CHOICE_LIMIT:
            msg = f"k must be within 1..{CHOICE_LIMIT}, got {k}"
            raise ValueError(msg)
        if top_p is not None and not 0.0 < top_p <= 1.0:
            msg = f"top_p must be within (0, 1], got {top_p}"
            raise ValueError(msg)
        for label, value in (
            ("threshold", threshold),
            ("tournament_threshold", tournament_threshold),
        ):
            if value is not None and not 0.0 <= value <= 1.0:
                msg = f"{label} must be within [0, 1], got {value}"
                raise ValueError(msg)
        self.model = model
        self.gate: Gate = gate
        self.threshold = threshold
        self.tournament_threshold = tournament_threshold
        self.k = k
        self.top_p = top_p
        self.has_model = has_model
        self.ranker: Ranker = ranker or GatewayRanker(
            model, style=style, with_eval=with_eval, with_nouls=with_nouls
        )

    # ---- the decision -------------------------------------------------------------------------

    def _shortlist(self, candidates: tuple[Candidate, ...]) -> tuple[Candidate, ...]:
        """Top-k, or the smallest prefix reaching `top_p` probability mass (capped at k)."""
        top = candidates[: self.k]
        if self.top_p is None:
            return top
        mass = 0.0
        for index, candidate in enumerate(top, start=1):
            mass += candidate.probability
            if mass >= self.top_p:
                return top[:index]
        return top

    def _freeze(self, distribution: MoveDistribution, turn_id: str) -> FrozenDecision:
        tournament = distribution.tournament
        signal = distribution.margin if self.gate == "margin" else distribution.confidence
        threshold = self.threshold
        if tournament is not None and self.tournament_threshold is not None:
            # A final over fewer moves inflates the margin, and confidence can depend on
            # the option count, so a tournament gets its own threshold.
            threshold = self.tournament_threshold
        plays = threshold < 1.0 and signal >= threshold
        return FrozenDecision(
            turn_id=turn_id,
            status="played" if plays else "shortlist",
            model=self.model,
            ranking=_ranked(distribution.candidates),
            shortlist=[] if plays else _ranked(self._shortlist(distribution.candidates)),
            fallback=distribution.top.uci,
            played=distribution.top.uci if plays else None,
            gate=self.gate,
            signal=signal,
            confidence=distribution.confidence,
            margin=distribution.margin,
            threshold_used=threshold,
            tournament=tournament,
            error=None,
            latency_ms=distribution.latency_ms,
            calls=list(distribution.calls),
            eval_score=distribution.eval_score,
            needs_calculation=distribution.needs_calculation,
            tactics_present=distribution.tactics_present,
        )

    def _skipped(self, error: RankingFailed, turn_id: str) -> FrozenDecision:
        return FrozenDecision(
            turn_id=turn_id,
            status="skipped",
            model=self.model,
            ranking=[],
            shortlist=[],
            fallback=None,
            played=None,
            gate=self.gate,
            signal=None,
            confidence=None,
            margin=None,
            threshold_used=None,
            tournament=None,
            error=str(error),
            latency_ms=error.elapsed_ms,
            calls=list(error.calls),
            eval_score=None,
            needs_calculation=None,
            tactics_present=None,
        )

    def _replay(self, frozen: FrozenDecision, view: PositionView) -> dict[str, Any]:
        """Monotone: `current allowed ∩ frozen`, so a later narrowing is never undone."""
        allowed = set(view.allowed)
        update: dict[str, Any] = {}
        if frozen["fallback"] in allowed:
            update["fallback_move"] = frozen["fallback"]
        if frozen["status"] == "played":
            if frozen["played"] in allowed:
                meta: dict[str, JSONValue] = {"model": frozen["model"]}
                update |= self.propose(str(frozen["played"]), source="systemone", meta=meta)
        elif frozen["status"] == "shortlist":
            update["candidates"] = [m["uci"] for m in frozen["shortlist"] if m["uci"] in allowed]
        return update

    def _current(self, state: Mapping[str, Any]) -> FrozenDecision | None:
        frozen = state.get("systemone_turn")
        turns = state.get("turns") or []
        if frozen is None or not turns or frozen["turn_id"] != turns[-1]["id"]:
            return None
        return frozen

    def _request(self, view: PositionView) -> RankRequest:
        return RankRequest(
            start_fen=view.start_fen,
            moves=view.moves,
            options=view.allowed,
            seed=turn_seed(self.agent_seed, view.turn_id),
        )

    def _after_ranking(
        self, view: PositionView, distribution: MoveDistribution | RankingFailed
    ) -> dict[str, Any] | None:
        if isinstance(distribution, RankingFailed):
            if not self.has_model:
                raise distribution
            skipped = self._skipped(distribution, view.turn_id)
            return {"systemone_turn": skipped, "systemone_live": _live(skipped)}
        frozen = self._freeze(distribution, view.turn_id)
        return {
            "systemone_turn": frozen,
            "systemone_live": _live(frozen),
            **self._replay(frozen, view),
        }

    @hook_config(can_jump_to=["end"])
    def before_model(self, state: Any, runtime: Any) -> dict[str, Any] | None:
        view = self.position(state)
        if (frozen := self._current(state)) is not None:
            return self._replay(frozen, view) or None
        try:
            distribution: MoveDistribution | RankingFailed = self.ranker.rank(self._request(view))
        except RankingFailed as e:
            distribution = e
        return self._after_ranking(view, distribution)

    @hook_config(can_jump_to=["end"])
    async def abefore_model(self, state: Any, runtime: Any) -> dict[str, Any] | None:
        view = self.position(state)
        if (frozen := self._current(state)) is not None:
            return self._replay(frozen, view) or None
        try:
            distribution: MoveDistribution | RankingFailed = await self.ranker.arank(
                self._request(view)
            )
        except RankingFailed as e:
            distribution = e
        return self._after_ranking(view, distribution)

    # ---- telemetry ----------------------------------------------------------------------------

    def _played_result(self, frozen: FrozenDecision, uci: str) -> list[StageResult] | None:
        """Its tournament stages, or its single-ranking result; None if it wasn't an option."""
        if frozen["tournament"] is not None:
            stages = {move["uci"]: move["stages"] for move in frozen["tournament"]["moves"]}
            return list(stages.get(uci, [])) or None
        return [
            StageResult(round=1, heat=None, rank=rank, probability=move["probability"], bye=False)
            for rank, move in enumerate(frozen["ranking"], start=1)
            if move["uci"] == uci
        ] or None

    def ply_meta(self, state: Mapping[str, Any]) -> dict[str, JSONValue] | None:
        frozen = self._current(state)
        if frozen is None:
            return None
        proposal = state.get("proposal") or {}
        uci = proposal.get("uci")
        skipped = frozen["status"] == "skipped"
        by_systemone = proposal.get("source") == "systemone"
        shared = {k: v for k, v in _live(frozen).items() if k not in _LIVE_ONLY}
        meta = {
            **shared,
            "followed": None
            if skipped or by_systemone
            else uci in {m["uci"] for m in frozen["shortlist"]},
            "played_move_result": None
            if skipped or uci is None
            else self._played_result(frozen, uci),
        }
        return meta  # ty: ignore[invalid-return-type]

    def turn_calls(self, state: Mapping[str, Any]) -> list[Call]:
        frozen = self._current(state)
        return list(frozen["calls"]) if frozen is not None else []

    def turn_latency_ms(self, state: Mapping[str, Any]) -> float:
        frozen = self._current(state)
        return frozen["latency_ms"] if frozen is not None else 0.0


class NoSystemOne(ChessMiddleware):
    """Keeps SystemOne's node and state keys when it is off, so the graph keeps its shape."""

    state_schema = SystemOneState

    @property
    def name(self) -> str:
        return SystemOneMiddleware.__name__

    @hook_config(can_jump_to=["end"])
    def before_model(self, state: Any, runtime: Any) -> dict[str, Any] | None:
        return None

    @hook_config(can_jump_to=["end"])
    async def abefore_model(self, state: Any, runtime: Any) -> dict[str, Any] | None:
        return None
