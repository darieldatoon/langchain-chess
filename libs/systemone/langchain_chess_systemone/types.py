"""SystemOne's domain types and its JSON telemetry. Ranks are one-based.

The telemetry TypedDicts are mirrored by hand in `packages/chess-ui/src/types.ts`; keep them in
step.
"""

from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Literal, NotRequired, Protocol, TypedDict

from langchain_chess.state import Call

type Gate = Literal["margin", "confidence"]
type DecisionStatus = Literal["played", "shortlist", "skipped"]


class StageResult(TypedDict):
    """One move's result in one Choice."""

    round: int
    """1 is the first heats; the final is the last round."""
    heat: int | None
    """None in the final, and for a single ranking."""
    rank: int
    probability: float
    bye: bool


class TournamentMove(TypedDict):
    uci: str
    stages: list[StageResult]
    """Every stage the move reached, in order."""
    finalist: bool


class Tournament(TypedDict):
    max_options: int
    rounds: int
    """Heat rounds, recursive levels included, plus the final."""
    finalists: list[str]
    moves: list[TournamentMove]


class RankedMove(TypedDict):
    uci: str
    probability: float


class SystemOneMeta(TypedDict):
    """`Ply.meta["SystemOneMiddleware"]`."""

    status: DecisionStatus
    model: str
    top: list[RankedMove]
    """System 1's highest-ranked moves, whoever played; after a tournament, finalists only."""
    shortlist: list[RankedMove]
    followed: bool | None
    """Whether the LLM played a shortlisted move. None when SystemOne played it, or skipped."""
    gate: Gate
    signal: float | None
    """The gate's input: the margin or the confidence."""
    confidence: float | None
    margin: float | None
    """p1 - p2 of the validated distribution."""
    threshold_used: float | None
    finalist_conditional: bool
    played_move_result: list[StageResult] | None
    """Where the played move stood. After a tournament, the stages it reached (never a global
    rank); otherwise its single-ranking result."""
    tournament: Tournament | None
    error: str | None
    latency_ms: NotRequired[float]
    eval_score: NotRequired[float | None]
    needs_calculation: NotRequired[float | None]
    tactics_present: NotRequired[float | None]


@dataclass(frozen=True, slots=True)
class RankRequest:
    start_fen: str
    moves: tuple[str, ...]
    """UCI history, for context and the recent SAN."""
    options: tuple[str, ...]
    """The moves to rank (UCI)."""
    seed: int
    """Tournament shuffle seed."""


@dataclass(frozen=True, slots=True)
class Candidate:
    uci: str
    probability: float


@dataclass(frozen=True, slots=True)
class MoveDistribution:
    candidates: tuple[Candidate, ...]
    """Validated and sorted. After a tournament, finalists only."""
    confidence: float
    model: str
    latency_ms: float
    calls: tuple[Call, ...]
    """One per provider request."""
    tournament: Tournament | None = None
    eval_score: float | None = None
    needs_calculation: float | None = None
    tactics_present: float | None = None

    def __post_init__(self) -> None:
        if not self.candidates:
            msg = "a distribution needs at least one candidate"
            raise ValueError(msg)

    @property
    def top(self) -> Candidate:
        return self.candidates[0]

    @property
    def margin(self) -> float:
        if len(self.candidates) < 2:
            return self.top.probability
        return self.top.probability - self.candidates[1].probability


class RankingFailed(Exception):  # noqa: N818 - the plan's name, raised as a failure not an error
    """Ranking failed after retries, or a response was malformed."""

    def __init__(self, message: str, calls: Sequence[Call] = (), elapsed_ms: float = 0.0) -> None:
        super().__init__(message)
        self.calls: tuple[Call, ...] = tuple(calls)
        """The requests that completed before the failure."""
        self.elapsed_ms = elapsed_ms
        """How long the ranking ran before it failed."""


class Ranker(Protocol):
    max_options: int

    def rank(self, request: RankRequest) -> MoveDistribution: ...

    async def arank(self, request: RankRequest) -> MoveDistribution: ...


@dataclass(frozen=True, slots=True)
class ChoiceResult:
    """One validated Choice: its options ranked, ties broken by option order."""

    ranked: tuple[Candidate, ...]
    confidence: float


@dataclass(frozen=True, slots=True)
class Aux:
    eval_score: float | None = None
    needs_calculation: float | None = None
    tactics_present: float | None = None


@dataclass(frozen=True, slots=True)
class Answers:
    """What a batch of questions returned: validated Choices by question name."""

    choices: dict[str, ChoiceResult]
    aux: Aux = field(default_factory=Aux)
