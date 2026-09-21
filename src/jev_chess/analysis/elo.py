"""Bradley-Terry / Elo fit with anchored engine ratings. Pure.

Engines have known ratings (Maia weights are named for theirs; Stockfish's UCI_Elo is the
cap we set), so they are fixed and the policies' ratings are solved by maximum likelihood.
Draws count as half a win for each side, the usual convention.
"""

from collections.abc import Iterable, Mapping
from dataclasses import dataclass

from jev_chess.runner.game import GameRecord

ELO_SCALE = 400.0


@dataclass(frozen=True, slots=True)
class Pairing:
    white: str
    black: str
    white_score: float  # 1, 0.5, 0


def pairings(games: Iterable[GameRecord]) -> list[Pairing]:
    score = {"1-0": 1.0, "0-1": 0.0, "1/2-1/2": 0.5}
    return [Pairing(g.white, g.black, score[g.result]) for g in games]


def anchor_rating(name: str) -> float | None:
    """Known ratings for anchor engines; None for anything whose rating is fitted.

    Only Maia anchors. A 180-game calibration (2026-09-21) showed Stockfish's UCI_Elo caps
    sit on a different scale: anchored on Maia, Stockfish 1320/1600/2000 fit to 1308/1714/
    1940, whereas anchoring on Stockfish compressed Maia 1100..1900 into 1396..1637. Maia's
    ratings are human Lichess ratings, which is the scale we want policies reported on.
    """
    parts = name.split(":")
    if parts[0] == "maia" and len(parts) == 2:
        return float(parts[1])
    return None


def is_engine(name: str) -> bool:
    return name.split(":")[0] in {"maia", "stockfish", "random"}


def expected(rating_a: float, rating_b: float) -> float:
    return 1.0 / (1.0 + 10 ** ((rating_b - rating_a) / ELO_SCALE))


def fit_elo(
    results: Iterable[Pairing],
    anchors: Mapping[str, float] | None = None,
    iterations: int = 2000,
    learning_rate: float = 20.0,
    default: float = 1500.0,
) -> dict[str, float]:
    """Gradient ascent on the log-likelihood; anchored players never move."""
    rows = list(results)
    names = sorted({p.white for p in rows} | {p.black for p in rows})
    ratings: dict[str, float] = {}
    free: list[str] = []
    for n in names:
        fixed = (anchors or {}).get(n, anchor_rating(n))
        if fixed is None:
            free.append(n)
            ratings[n] = default
        else:
            ratings[n] = fixed
    if not free or not rows:
        return ratings
    for _ in range(iterations):
        grad = dict.fromkeys(free, 0.0)
        for p in rows:
            e = expected(ratings[p.white], ratings[p.black])
            if p.white in grad:
                grad[p.white] += p.white_score - e
            if p.black in grad:
                grad[p.black] -= p.white_score - e
        for n in free:
            ratings[n] += learning_rate * grad[n]
    return ratings
