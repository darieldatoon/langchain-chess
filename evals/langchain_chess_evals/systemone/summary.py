"""Summary metrics over an experiment's rows. Pure.

Means are plain means over the stratified set: every rating band and phase weighs the same,
not as often as it occurs on Lichess. Every metric is reported for all rows, by band, by phase,
and by legal move count: 16 or fewer is one ranking; more is a tournament for a model capped at 16.
"""

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from statistics import fmean

from langchain_chess_evals.positions.sampling import BANDS, PHASES, Band, Phase
from langchain_chess_evals.systemone.scoring import ROW_METRICS, Scores

GATE_THRESHOLDS: tuple[float, ...] = (0.5, 0.6, 0.7, 0.8, 0.9, 0.95)
GATE_SIGNALS: tuple[str, ...] = ("margin", "confidence")
DECILES = 10
SINGLE_RANKING_MAX = 16
LEGAL_GROUPS: tuple[str, ...] = (f"legal<={SINGLE_RANKING_MAX}", f"legal>{SINGLE_RANKING_MAX}")

type Summary = dict[str, float | None]
"""`metric|group`, the group being `all`, `band=...`, `phase=...` or `legal...`."""


@dataclass(frozen=True, slots=True)
class Scored:
    scores: Scores
    band: Band
    phase: Phase
    legal_count: int
    signals: Mapping[str, float | None]
    """`margin` and `confidence`; None when the ranking failed."""

    @property
    def legal_group(self) -> str:
        return LEGAL_GROUPS[self.legal_count > SINGLE_RANKING_MAX]

    @property
    def correct(self) -> bool:
        return self.scores["recall@1"] == 1.0


def _mean(values: Sequence[float | None]) -> float | None:
    present = [v for v in values if v is not None]
    return fmean(present) if present else None


def groups(rows: Sequence[Scored]) -> dict[str, list[Scored]]:
    split: list[tuple[str, Callable[[Scored], bool]]] = [
        ("all", lambda _: True),
        *((f"band={b}", lambda r, b=b: r.band == b) for b in BANDS),
        *((f"phase={p}", lambda r, p=p: r.phase == p) for p in PHASES),
        *((g, lambda r, g=g: r.legal_group == g) for g in LEGAL_GROUPS),
    ]
    return {name: [r for r in rows if keep(r)] for name, keep in split}


def gate_table(rows: Sequence[Scored], signal: str) -> Summary:
    """Share of all moves System 1 would play alone at each threshold, and how often its move
    is the engine's best."""
    table: Summary = {}
    for threshold in GATE_THRESHOLDS:
        kept = [r for r in rows if (s := r.signals[signal]) is not None and s >= threshold]
        table[f"gate.{signal}>={threshold}.kept"] = len(kept) / len(rows) if rows else None
        table[f"gate.{signal}>={threshold}.accuracy"] = (
            _mean([float(r.correct) for r in kept]) if kept else None
        )
    return table


def calibration(rows: Sequence[Scored], signal: str) -> Summary:
    """Top-1 accuracy and row count per decile of the signal; 1.0 falls in the last decile."""
    table: Summary = {}
    for index in range(DECILES):
        low, high = index / DECILES, (index + 1) / DECILES
        members = [
            r
            for r in rows
            if (s := r.signals[signal]) is not None
            and (low <= s < high or (index == DECILES - 1 and s == 1.0))
        ]
        name = f"calibration.{signal}.{low:.1f}-{high:.1f}"
        table[f"{name}.n"] = float(len(members))
        table[f"{name}.accuracy"] = _mean([float(r.correct) for r in members])
    return table


def summarize(rows: Sequence[Scored]) -> Summary:
    summary: Summary = {}
    for group, members in groups(rows).items():
        summary[f"n|{group}"] = float(len(members))
        for metric in ROW_METRICS:
            summary[f"{metric}|{group}"] = _mean([r.scores[metric] for r in members])
        if group == "all" or group.startswith("legal"):
            for signal in GATE_SIGNALS:
                tables = gate_table(members, signal) | calibration(members, signal)
                summary |= {f"{key}|{group}": value for key, value in tables.items()}
    return summary


HEADLINE: tuple[tuple[str, str], ...] = (
    ("recall@1", "recall@1|all"),
    ("recall@5", "recall@5|all"),
    ("top-3 in top 5", "top3_in_top5|all"),
    ("human match", "human_match@1|all"),
    ("cp loss", "cp_loss|all"),
    (f"recall@1, ≤{SINGLE_RANKING_MAX} legal", f"recall@1|{LEGAL_GROUPS[0]}"),
    (f"recall@1, >{SINGLE_RANKING_MAX} legal", f"recall@1|{LEGAL_GROUPS[1]}"),
    ("finalist recall", f"finalist_recall|{LEGAL_GROUPS[1]}"),
    ("margin ≥ 0.9: kept", "gate.margin>=0.9.kept|all"),
    ("margin ≥ 0.9: top-1", "gate.margin>=0.9.accuracy|all"),
    ("requests", "requests|all"),
    ("input tokens", "input_tokens|all"),
    ("errors", "error|all"),
)
_FORMATS = {"cp loss": "{:.0f}", "requests": "{:.2f}", "input tokens": "{:,.0f}"}


def _cell(label: str, value: float | None) -> str:
    if value is None:
        return "-"
    return _FORMATS.get(label, "{:.1%}").format(value)


def headline_table(runs: Sequence[tuple[str, str | None, Summary]]) -> str:
    """Markdown: one row per `(name, url, summary)`."""
    header = "| Run | " + " | ".join(label for label, _ in HEADLINE) + " |"
    rule = "|---|" + "---|" * len(HEADLINE)
    lines = [header, rule]
    for name, url, summary in runs:
        title = f"[{name}]({url})" if url else name
        cells = " | ".join(_cell(label, summary.get(key)) for label, key in HEADLINE)
        lines.append(f"| {title} | {cells} |")
    return "\n".join(lines) + "\n"
