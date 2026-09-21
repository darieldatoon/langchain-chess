"""Per-player summary over games, plies, and grades. Pure functions over records."""

from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from statistics import mean, median

from jev_chess.analysis.elo import anchor_rating, fit_elo, pairings
from jev_chess.analysis.grade import GradeRecord
from jev_chess.runner.game import GameRecord, PlyRecord


@dataclass
class PlayerSummary:
    player: str
    games: int = 0
    wins: int = 0
    draws: int = 0
    losses: int = 0
    plies: int = 0
    latency_ms: list[float] = field(default_factory=list)
    cost_usd: float = 0.0
    cost_known: bool = True
    escalations: int = 0
    fallbacks: int = 0
    illegal_attempts: int = 0
    cp_losses: list[int] = field(default_factory=list)
    blunders: int = 0
    mistakes: int = 0
    overrides: int = 0
    override_gains: list[int] = field(default_factory=list)
    elo: float | None = None

    @property
    def score(self) -> float:
        return (self.wins + 0.5 * self.draws) / self.games if self.games else 0.0

    @property
    def mean_latency_ms(self) -> float:
        return mean(self.latency_ms) if self.latency_ms else 0.0

    @property
    def median_latency_ms(self) -> float:
        return median(self.latency_ms) if self.latency_ms else 0.0

    @property
    def cost_per_game(self) -> float:
        return self.cost_usd / self.games if self.games else 0.0

    @property
    def acpl(self) -> float | None:
        return mean(self.cp_losses) if self.cp_losses else None

    @property
    def blunder_rate(self) -> float | None:
        return self.blunders / len(self.cp_losses) if self.cp_losses else None

    @property
    def escalation_rate(self) -> float:
        return self.escalations / self.plies if self.plies else 0.0

    @property
    def override_rate(self) -> float | None:
        return self.overrides / self.escalations if self.escalations else None

    @property
    def mean_override_gain_cp(self) -> float | None:
        return mean(self.override_gains) if self.override_gains else None


def summarise(
    games: Iterable[GameRecord],
    plies: Iterable[PlyRecord],
    grades: Iterable[GradeRecord] = (),
) -> dict[str, PlayerSummary]:
    games = list(games)
    out: dict[str, PlayerSummary] = {}

    def get(name: str) -> PlayerSummary:
        return out.setdefault(name, PlayerSummary(player=name))

    for g in games:
        for name, totals, mine, theirs in (
            (g.white, g.white_totals, "1-0", "0-1"),
            (g.black, g.black_totals, "0-1", "1-0"),
        ):
            s = get(name)
            s.games += 1
            s.wins += g.result == mine
            s.losses += g.result == theirs
            s.draws += g.result == "1/2-1/2"
            s.cost_usd += totals.cost_usd
            s.cost_known = s.cost_known and totals.cost_known
    for p in plies:
        s = get(p.player)
        s.plies += 1
        s.latency_ms.append(p.latency_ms)
        s.escalations += int(p.escalated)
        s.fallbacks += p.source.startswith("fallback")
        s.illegal_attempts += p.illegal_attempts
    for gr in grades:
        s = get(gr.player)
        s.cp_losses.append(gr.cp_loss)
        s.blunders += gr.move_class == "blunder"
        s.mistakes += gr.move_class == "mistake"
        if gr.override_gain_cp is not None:  # set exactly when the LLM overrode Jev
            s.overrides += 1
            s.override_gains.append(gr.override_gain_cp)
    for name, elo in fit_elo(pairings(games)).items():
        get(name).elo = elo
    return out


def pareto_rows(summaries: Sequence[PlayerSummary]) -> list[PlayerSummary]:
    """Players under test (not rating anchors) sorted by Elo, for the Pareto table."""
    return sorted(
        (s for s in summaries if anchor_rating(s.player) is None),
        key=lambda s: -(s.elo or 0),
    )


def anchor_rows(summaries: Sequence[PlayerSummary]) -> list[PlayerSummary]:
    """Engine opponents with known ratings, sorted by name."""
    return sorted(
        (s for s in summaries if anchor_rating(s.player) is not None), key=lambda s: s.player
    )
