"""Types shared by move policies."""

from dataclasses import dataclass
from typing import Any, Literal


@dataclass(frozen=True, slots=True)
class Candidate:
    uci: str
    probability: float


@dataclass(frozen=True, slots=True)
class JevRanking:
    """Jev's full distribution over legal moves for one position, plus call telemetry."""

    candidates: tuple[Candidate, ...]
    confidence: float
    model: str
    input_tokens: int
    output_tokens: int
    latency_ms: float
    eval_score: float | None = None
    needs_calculation: float | None = None
    tactics_present: float | None = None

    def __post_init__(self) -> None:
        if not self.candidates:
            msg = "a ranking needs at least one candidate"
            raise ValueError(msg)
        probs = [c.probability for c in self.candidates]
        if probs != sorted(probs, reverse=True):
            msg = "candidates must be sorted by descending probability"
            raise ValueError(msg)

    @property
    def top(self) -> Candidate:
        return self.candidates[0]

    def top_k(self, k: int) -> tuple[Candidate, ...]:
        return self.candidates[:k]

    def rank_of(self, uci: str) -> int | None:
        """1-based rank of a move in Jev's ordering, or None if it was not an option."""
        for index, candidate in enumerate(self.candidates, start=1):
            if candidate.uci == uci:
                return index
        return None

    @property
    def margin(self) -> float:
        """Probability gap between the top two candidates; an alternative gate to confidence."""
        if len(self.candidates) < 2:
            return self.top.probability
        return self.top.probability - self.candidates[1].probability


type MoveSource = Literal["jev", "llm", "fallback_jev", "fallback_random", "engine"]
type ReasoningEffort = Literal["low", "medium", "high"]


@dataclass(frozen=True, slots=True)
class MoveDecision:
    """One move plus everything we want to know about how it was chosen.

    Construct through `legal_decision` so a decision can never name an illegal move.
    """

    uci: str
    source: MoveSource
    model: str
    latency_ms: float
    input_tokens: int = 0
    output_tokens: int = 0
    reasoning_tokens: int = 0
    cost_usd: float | None = None
    escalated: bool = False
    illegal_attempts: int = 0
    jev_confidence: float | None = None
    jev_margin: float | None = None
    jev_top_k: tuple[Candidate, ...] | None = None
    raw_reply: str | None = None


def legal_decision(legal_moves: frozenset[str] | set[str], **fields: Any) -> MoveDecision:
    decision = MoveDecision(**fields)
    if decision.uci not in legal_moves:
        msg = f"{decision.uci} is not a legal move here"
        raise ValueError(msg)
    return decision
