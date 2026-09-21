"""Types shared by move policies."""

from dataclasses import dataclass


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
