"""Recall and calibration of Jev's ranking against Stockfish labels. Pure functions.

The question this answers is whether a hybrid that hands Jev's top-k to an LLM has a
ceiling above the LLM alone: if Stockfish's best move is rarely in Jev's top-k, it does not.
"""

from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass
from statistics import median
from typing import cast

import chess

from jev_chess.analysis.records import JevRecord, OracleLabel, Phase, PositionRecord

MATE_SCORE = 100_000
# Losses beyond this are all "decisive"; without a cap, mates at ±100k swamp the mean.
CP_LOSS_CAP = 1000


@dataclass(frozen=True, slots=True)
class Joined:
    position: PositionRecord
    label: OracleLabel
    ranking: JevRecord

    @property
    def jev_top(self) -> str:
        return self.ranking.candidates[0].uci

    @property
    def jev_confidence(self) -> float:
        return self.ranking.confidence

    @property
    def jev_margin(self) -> float:
        probs = [c.probability for c in self.ranking.candidates]
        return probs[0] - probs[1] if len(probs) > 1 else probs[0]

    def jev_rank_of(self, uci: str) -> int | None:
        for index, candidate in enumerate(self.ranking.candidates, start=1):
            if candidate.uci == uci:
                return index
        return None

    def best_in_top_k(self, k: int) -> bool:
        rank = self.jev_rank_of(self.label.best.uci)
        return rank is not None and rank <= k

    def any_oracle_top3_in_top_k(self, k: int) -> bool:
        top_k = {c.uci for c in self.ranking.candidates[:k]}
        return any(m.uci in top_k for m in self.label.ranked[:3])

    def cp_loss_of_jev_top(self) -> int | None:
        """Centipawns Jev's move gives up versus the best, when Stockfish ranked it."""
        scores = {m.uci: _score(m.cp, m.mate) for m in self.label.ranked}
        if self.jev_top not in scores:
            return None
        return min(CP_LOSS_CAP, max(0, scores[self.label.best.uci] - scores[self.jev_top]))


def _score(cp: int | None, mate: int | None) -> int:
    if mate is not None:
        return MATE_SCORE - abs(mate) if mate > 0 else -MATE_SCORE + abs(mate)
    assert cp is not None
    return cp


def join(
    positions: Iterable[PositionRecord],
    labels: Iterable[OracleLabel],
    rankings: Iterable[JevRecord],
) -> list[Joined]:
    by_label = {label.id: label for label in labels}
    by_rank = {ranking.id: ranking for ranking in rankings}
    return [
        Joined(position=p, label=by_label[p.id], ranking=by_rank[p.id])
        for p in positions
        if p.id in by_label and p.id in by_rank
    ]


@dataclass(frozen=True, slots=True)
class Bucket:
    lower: float
    upper: float
    count: int
    accuracy: float | None


@dataclass(frozen=True, slots=True)
class RecallReport:
    n: int
    recall_at: dict[int, float]
    oracle_top3_hit_at: dict[int, float]
    recall_by_phase: dict[Phase, dict[int, float]]
    mean_cp_loss: float | None
    median_cp_loss: float | None
    cp_loss_coverage: float
    confidence_calibration: tuple[Bucket, ...]
    margin_calibration: tuple[Bucket, ...]
    mean_latency_ms: float
    mean_input_tokens: float


def _fraction(rows: Sequence[Joined], predicate: Callable[[Joined], bool]) -> float:
    if not rows:
        return 0.0
    return sum(1 for r in rows if predicate(r)) / len(rows)


def _recall_table(rows: Sequence[Joined], ks: Sequence[int]) -> dict[int, float]:
    return {k: _fraction(rows, lambda r, k=k: r.best_in_top_k(k)) for k in ks}


def calibration(rows: Sequence[Joined], key: str, bins: int = 10) -> tuple[Bucket, ...]:
    """Bucket a [0, 1] signal and report top-1 accuracy per bucket."""
    out: list[Bucket] = []
    for i in range(bins):
        lower, upper = i / bins, (i + 1) / bins
        in_bucket = [
            r
            for r in rows
            if lower <= getattr(r, key) < upper or (i == bins - 1 and getattr(r, key) == 1.0)
        ]
        accuracy = _fraction(in_bucket, lambda r: r.best_in_top_k(1)) if in_bucket else None
        out.append(Bucket(lower=lower, upper=upper, count=len(in_bucket), accuracy=accuracy))
    return tuple(out)


def recall_report(rows: Sequence[Joined], ks: Sequence[int] = (1, 3, 5, 8)) -> RecallReport:
    losses = [loss for r in rows if (loss := r.cp_loss_of_jev_top()) is not None]
    phases: tuple[Phase, ...] = ("opening", "middlegame", "endgame")
    return RecallReport(
        n=len(rows),
        recall_at=_recall_table(rows, ks),
        oracle_top3_hit_at={
            k: _fraction(rows, lambda r, k=k: r.any_oracle_top3_in_top_k(k)) for k in ks
        },
        recall_by_phase={
            phase: _recall_table([r for r in rows if r.position.phase == phase], ks)
            for phase in phases
        },
        mean_cp_loss=sum(losses) / len(losses) if losses else None,
        median_cp_loss=float(median(losses)) if losses else None,
        cp_loss_coverage=len(losses) / len(rows) if rows else 0.0,
        confidence_calibration=calibration(rows, "jev_confidence"),
        margin_calibration=calibration(rows, "jev_margin"),
        mean_latency_ms=sum(r.ranking.latency_ms for r in rows) / len(rows) if rows else 0.0,
        mean_input_tokens=sum(r.ranking.input_tokens for r in rows) / len(rows) if rows else 0.0,
    )


# --- Score and Noul validation ------------------------------------------------------------

# Stockfish centipawns (White's view) to the seven EVAL_RUNGS. Boundaries are symmetric.
RUNG_BOUNDS_CP: tuple[int, int, int] = (50, 150, 400)
EQUAL_RUNG = 3
FORCING_GAP_CP = 150


def white_cp(row: Joined) -> int:
    """Stockfish's best-line score converted to White's point of view."""
    best = row.label.best
    score = _score(best.cp, best.mate)
    return score if chess.Board(row.position.fen).turn == chess.WHITE else -score


def oracle_rung(cp_white: int) -> int:
    slight, clear, decisive = RUNG_BOUNDS_CP
    if cp_white <= -decisive:
        return 0
    if cp_white <= -clear:
        return 1
    if cp_white <= -slight:
        return 2
    if cp_white < slight:
        return EQUAL_RUNG
    if cp_white < clear:
        return 4
    if cp_white < decisive:
        return 5
    return 6


def oracle_tactic_present(row: Joined) -> bool:
    """Ground truth for `tactics_present`: the best move is forcing or far ahead of the rest."""
    board = chess.Board(row.position.fen)
    best = chess.Move.from_uci(row.label.best.uci)
    if board.is_capture(best) or board.gives_check(best):
        return True
    if len(row.label.ranked) < 2:
        return False
    second = row.label.ranked[1]
    gap = _score(row.label.best.cp, row.label.best.mate) - _score(second.cp, second.mate)
    return gap >= FORCING_GAP_CP


@dataclass(frozen=True, slots=True)
class ScoreReport:
    n: int
    exact: float
    within_one: float
    mean_abs_error: float
    confusion: dict[int, dict[int, int]]  # oracle rung -> jev rung -> count


def score_report(rows: Sequence[Joined]) -> ScoreReport | None:
    scored = [r for r in rows if r.ranking.eval_score is not None]
    if not scored:
        return None
    pairs = [(oracle_rung(white_cp(r)), round(cast("float", r.ranking.eval_score))) for r in scored]
    confusion: dict[int, dict[int, int]] = {}
    for truth, guess in pairs:
        confusion.setdefault(truth, {})
        confusion[truth][guess] = confusion[truth].get(guess, 0) + 1
    return ScoreReport(
        n=len(pairs),
        exact=sum(1 for t, g in pairs if t == g) / len(pairs),
        within_one=sum(1 for t, g in pairs if abs(t - g) <= 1) / len(pairs),
        mean_abs_error=sum(abs(t - g) for t, g in pairs) / len(pairs),
        confusion=confusion,
    )


@dataclass(frozen=True, slots=True)
class GatePoint:
    """What happens if Jev plays alone whenever `signal` clears `threshold`."""

    signal: str
    threshold: float
    kept: float
    accuracy: float | None


type GateSignal = Callable[[Joined], float | None]

GATE_SIGNALS: dict[str, GateSignal] = {
    "confidence": lambda r: r.jev_confidence,
    "margin": lambda r: r.jev_margin,
    "1 - needs_calculation": lambda r: (
        None if r.ranking.needs_calculation is None else 1.0 - r.ranking.needs_calculation
    ),
}

GATE_THRESHOLDS: tuple[float, ...] = (0.5, 0.6, 0.7, 0.8, 0.9, 0.95)


def gate_report(
    rows: Sequence[Joined],
    signals: dict[str, GateSignal] | None = None,
    thresholds: Sequence[float] = GATE_THRESHOLDS,
) -> tuple[GatePoint, ...]:
    """For each gate signal and threshold: share of moves Jev keeps, and how often it's right."""
    out: list[GatePoint] = []
    for name, signal in (signals or GATE_SIGNALS).items():
        valued = [(r, s) for r in rows if (s := signal(r)) is not None]
        if not valued:
            continue
        for threshold in thresholds:
            kept = [r for r, s in valued if s >= threshold]
            out.append(
                GatePoint(
                    signal=name,
                    threshold=threshold,
                    kept=len(kept) / len(valued),
                    accuracy=_fraction(kept, lambda r: r.best_in_top_k(1)) if kept else None,
                )
            )
    return tuple(out)


def tactics_calibration(rows: Sequence[Joined], bins: int = 5) -> tuple[Bucket, ...]:
    """Bucket the tactics Noul; `accuracy` is the share of each bucket with a real tactic."""
    valued = [r for r in rows if r.ranking.tactics_present is not None]
    out: list[Bucket] = []
    for i in range(bins):
        lower, upper = i / bins, (i + 1) / bins
        in_bucket = [
            r
            for r in valued
            if lower <= cast("float", r.ranking.tactics_present) < upper
            or (i == bins - 1 and r.ranking.tactics_present == 1.0)
        ]
        rate = _fraction(in_bucket, oracle_tactic_present) if in_bucket else None
        out.append(Bucket(lower=lower, upper=upper, count=len(in_bucket), accuracy=rate))
    return tuple(out)
