"""A knockout over more options than one Choice may hold. Planning is pure; a driver sends
the batches.

The options are shuffled with a request-local `random.Random(seed)` and split into balanced
heats, each asking for the best listed move (there is no "none of these" option). Each heat
sends its top `floor(cap / h)` moves to the final, with the `cap mod h` spare places going one
each to the first heats. Probabilities are never compared across heats, so the final's result
is conditional on the finalists.
"""

import math
import random
from collections.abc import Awaitable, Callable, Generator, Sequence
from dataclasses import dataclass

from langchain_chess_systemone.types import (
    Answers,
    Aux,
    ChoiceResult,
    StageResult,
    Tournament,
    TournamentMove,
)

MAX_QUESTIONS = 32
"""Per request, counting every question: a conservative cap for classifiers we don't know."""

FINAL = "move"


@dataclass(frozen=True, slots=True)
class ChoiceSpec:
    name: str
    options: tuple[str, ...]
    heat: bool
    """True for a heat: only some legal moves are listed."""


@dataclass(frozen=True, slots=True)
class Batch:
    """One provider request."""

    choices: tuple[ChoiceSpec, ...]
    with_aux: bool


@dataclass(frozen=True, slots=True)
class TournamentResult:
    final: ChoiceResult
    aux: Aux
    tournament: Tournament


type Plan = Generator[Batch, Answers, TournamentResult]


def split_heats(pool: Sequence[str], cap: int) -> list[list[str]]:
    """`ceil(n / cap)` heats whose sizes differ by at most one, in pool order."""
    count = math.ceil(len(pool) / cap)
    size, larger = divmod(len(pool), count)
    heats: list[list[str]] = []
    start = 0
    for index in range(count):
        end = start + size + (1 if index < larger else 0)
        heats.append(list(pool[start:end]))
        start = end
    return heats


def quotas(heats: int, cap: int) -> list[int]:
    """Finalist places per heat. With more heats than places, each heat sends one move on."""
    if heats > cap:
        return [1] * heats
    base, spare = divmod(cap, heats)
    return [base + (1 if index < spare else 0) for index in range(heats)]


def _chunks(specs: Sequence[ChoiceSpec], size: int) -> list[tuple[ChoiceSpec, ...]]:
    return [tuple(specs[i : i + size]) for i in range(0, len(specs), size)]


def plan(options: Sequence[str], cap: int, seed: int) -> Plan:
    """Yield the requests a tournament needs; receive each one's validated answers."""
    rng = random.Random(seed)
    pool = list(options)
    rng.shuffle(pool)
    stages: dict[str, list[StageResult]] = {uci: [] for uci in options}
    round_ = 0
    while len(pool) > cap:
        round_ += 1
        heats = split_heats(pool, cap)
        places = quotas(len(heats), cap)
        names = [f"heat_{round_}_{index + 1}" for index in range(len(heats))]
        specs = [
            ChoiceSpec(name, tuple(heat), heat=True)
            for name, heat in zip(names, heats, strict=True)
            if len(heat) > 1
        ]
        results: dict[str, ChoiceResult] = {}
        for chunk in _chunks(specs, MAX_QUESTIONS):
            answers = yield Batch(chunk, with_aux=False)
            results.update(answers.choices)
        advancing: list[str] = []
        for number, (name, heat, keep) in enumerate(zip(names, heats, places, strict=True), 1):
            if len(heat) == 1:
                stages[heat[0]].append(
                    StageResult(round=round_, heat=number, rank=1, probability=1.0, bye=True)
                )
                advancing.append(heat[0])
                continue
            ranked = results[name].ranked
            for rank, candidate in enumerate(ranked, 1):
                stages[candidate.uci].append(
                    StageResult(
                        round=round_,
                        heat=number,
                        rank=rank,
                        probability=candidate.probability,
                        bye=False,
                    )
                )
            advancing.extend(candidate.uci for candidate in ranked[:keep])
        pool = advancing
    round_ += 1
    answers = yield Batch((ChoiceSpec(FINAL, tuple(pool), heat=True),), with_aux=True)
    final = answers.choices[FINAL]
    for rank, candidate in enumerate(final.ranked, 1):
        stages[candidate.uci].append(
            StageResult(
                round=round_, heat=None, rank=rank, probability=candidate.probability, bye=False
            )
        )
    finalists = set(pool)
    tournament = Tournament(
        max_options=cap,
        rounds=round_,
        finalists=list(pool),
        moves=[
            TournamentMove(uci=uci, stages=stages[uci], finalist=uci in finalists)
            for uci in options
        ],
    )
    return TournamentResult(final=final, aux=answers.aux, tournament=tournament)


def drive(steps: Plan, ask: Callable[[Batch], Answers]) -> TournamentResult:
    try:
        batch = next(steps)
        while True:
            batch = steps.send(ask(batch))
    except StopIteration as done:
        return done.value


async def adrive(steps: Plan, ask: Callable[[Batch], Awaitable[Answers]]) -> TournamentResult:
    try:
        batch = next(steps)
        while True:
            batch = steps.send(await ask(batch))
    except StopIteration as done:
        return done.value
