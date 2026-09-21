"""Run many games concurrently under a cost cap.

Each worker owns a Roster (its own engine processes and policy clients) and plays games
pulled from a shared queue. The budget guard is checked before a game starts: once the
recorded spend crosses `max_usd`, no new games start, but games in flight finish. Records
are appended through a lock so concurrent writers never interleave lines.
"""

import random
import threading
from collections.abc import Callable, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

from jev_chess.analysis.records import append_jsonl
from jev_chess.engines import Oracle, OracleConfig
from jev_chess.runner.adjudication import AdjudicationConfig, Adjudicator, Evaluator
from jev_chess.runner.game import GameRecord, PlyRecord, play_game
from jev_chess.runner.openings import Opening, pick_openings
from jev_chess.runner.players import PlayerSpec, Roster
from jev_chess.settings import EngineSettings, GatewaySettings


@dataclass(frozen=True, slots=True)
class MatchConfig:
    games: int = 10
    max_plies: int = 200
    seed: int = 0
    swap_colours: bool = True
    workers: int = 1
    max_usd: float | None = None
    adjudicate: bool = True
    adjudication: AdjudicationConfig = field(default_factory=AdjudicationConfig)
    adjudication_depth: int = 12


@dataclass(frozen=True, slots=True)
class GamePlan:
    index: int
    game_id: str
    white: PlayerSpec
    black: PlayerSpec
    opening: Opening


@dataclass
class Budget:
    """Thread-safe running total of recorded cost with an optional cap."""

    max_usd: float | None
    spent_usd: float = 0.0
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def add(self, usd: float) -> None:
        with self._lock:
            self.spent_usd += usd

    @property
    def exhausted(self) -> bool:
        with self._lock:
            return self.max_usd is not None and self.spent_usd >= self.max_usd


def plan_games(
    white: PlayerSpec, black: PlayerSpec, config: MatchConfig, label: str
) -> list[GamePlan]:
    openings = pick_openings(random.Random(config.seed), config.games)
    plans: list[GamePlan] = []
    for index, opening in enumerate(openings):
        swap = config.swap_colours and index % 2 == 1
        w, b = (black, white) if swap else (white, black)
        plans.append(GamePlan(index, f"{label}-{config.seed}-{index:03d}", w, b, opening))
    return plans


type OnGame = Callable[[GameRecord], None]
type OpenOracle = Callable[[], Evaluator]


class Match:
    def __init__(
        self,
        white: PlayerSpec,
        black: PlayerSpec,
        config: MatchConfig,
        out: Path,
        engines: EngineSettings,
        gateway: GatewaySettings | None,
        open_oracle: OpenOracle | None = None,
        on_game: OnGame = lambda _: None,
    ) -> None:
        self._white, self._black = white, black
        self._config = config
        self._out = out
        self._engines = engines
        self._gateway = gateway
        self._open_oracle = open_oracle or (
            lambda: Oracle.open(
                engines.stockfish_path, OracleConfig(depth=config.adjudication_depth, multipv=1)
            )
        )
        self._on_game = on_game
        self._write_lock = threading.Lock()
        self.budget = Budget(config.max_usd)
        self.skipped: list[GamePlan] = []

    def _append(self, path: Path, record: PlyRecord | GameRecord) -> None:
        with self._write_lock:
            append_jsonl(path, record)

    def _play(self, plan: GamePlan, roster: Roster, oracle: Evaluator | None) -> GameRecord:
        assert roster.white is not None
        assert roster.black is not None
        # Roster is built (white spec, black spec); swapped plans play its players reversed.
        swapped = plan.white is not self._white
        w, b = (roster.black, roster.white) if swapped else (roster.white, roster.black)
        adjudicator = Adjudicator(oracle, self._config.adjudication) if oracle else None

        def on_ply(ply: PlyRecord) -> None:
            self._append(self._out / "plies.jsonl", ply)
            self.budget.add(ply.cost_usd or 0.0)

        record = play_game(
            w,
            b,
            plan.game_id,
            plan.opening.name,
            plan.opening.uci,
            self._config.max_plies,
            on_ply=on_ply,
            adjudicator=adjudicator,
        )
        self._append(self._out / "games.jsonl", record)
        self._on_game(record)
        return record

    def _worker(self, plans: Sequence[GamePlan], seed: int) -> list[GameRecord]:
        played: list[GameRecord] = []
        oracle = self._open_oracle() if self._config.adjudicate else None
        try:
            with Roster(self._white, self._black, self._engines, self._gateway, seed) as roster:
                for plan in plans:
                    if self.budget.exhausted:
                        self.skipped.append(plan)
                        continue
                    played.append(self._play(plan, roster, oracle))
        finally:
            if oracle is not None:
                oracle.close()
        return played

    def run(self, label: str) -> list[GameRecord]:
        plans = plan_games(self._white, self._black, self._config, label)
        workers = max(1, min(self._config.workers, len(plans)))
        chunks = [plans[i::workers] for i in range(workers)]
        with ThreadPoolExecutor(max_workers=workers) as pool:
            results = list(
                pool.map(
                    lambda pair: self._worker(pair[1], self._config.seed + pair[0]),
                    enumerate(chunks),
                )
            )
        played = [record for chunk in results for record in chunk]
        return sorted(played, key=lambda r: r.game_id)
