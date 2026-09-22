"""Player specs and the adapters that make engines and policies look alike to the runner.

Specs are short strings for the CLI, parsed into a sum type so a typo fails before any
engine starts:

    jev                 Jev's top move, rich descriptions
    jev:terse           Jev with terse descriptions
    llm:<model>[:low|medium|high][:nolegal]
        <model> is an init_chat_model spec. `langsmith:openai/gpt-5.6-sol` goes through
        the LLM Gateway (the default when you give a bare name such as `claude-opus-5`);
        `openai:gpt-5.6-sol` or `anthropic:claude-opus-5` go straight to the provider.
        `nolegal` drops the legal-move list from the prompt.
    hybrid:<model>[:effort][:k<int>|:p<float>][:t<float>][:margin|confidence]
        Jev ranks; if the gate signal clears t (default 0.9 on margin) Jev's move is played,
        else the LLM chooses among Jev's top k (default 5) or top-p mass. t0 is Jev-only,
        t1 is the pure pruner.
    maia:1100           Maia at that rating (1100..1900)
    stockfish:1500      Stockfish capped at UCI_Elo 1500 (1320..3190)
    stockfish:skill:3   Stockfish at Skill Level 3 (0..20)
    random              uniform random legal move, seeded
"""

import random
import time
from dataclasses import dataclass
from types import TracebackType
from typing import Any, Self, cast, get_args

import chess
from langchain_core.runnables import RunnableConfig

from jev_chess.core import DescriptionStyle
from jev_chess.engines import EloLimit, MaiaOpponent, MaiaRating, SkillLimit, StockfishOpponent
from jev_chess.engines.protocol import MovePlayer
from jev_chess.policies import (
    GateSignal,
    HybridConfig,
    HybridPolicy,
    JevConfig,
    JevPolicy,
    LLMConfig,
    LLMPolicy,
    MoveDecision,
)
from jev_chess.policies.jev import ranking_decision
from jev_chess.policies.llm import resolve_model_spec
from jev_chess.policies.types import ReasoningEffort, legal_decision
from jev_chess.settings import EngineSettings, GatewaySettings


@dataclass(frozen=True, slots=True)
class JevSpec:
    style: DescriptionStyle = "rich"

    @property
    def name(self) -> str:
        return "jev" if self.style == "rich" else f"jev:{self.style}"


@dataclass(frozen=True, slots=True)
class LLMSpec:
    model: str
    reasoning_effort: ReasoningEffort = "medium"
    include_legal_moves: bool = True

    @property
    def name(self) -> str:
        suffix = "" if self.include_legal_moves else ":nolegal"
        return f"llm:{self.model}:{self.reasoning_effort}{suffix}"


@dataclass(frozen=True, slots=True)
class HybridSpec:
    model: str
    reasoning_effort: ReasoningEffort = "medium"
    k: int = 5
    top_p: float | None = None
    threshold: float = 0.9
    gate: GateSignal = "margin"

    @property
    def config(self) -> HybridConfig:
        return HybridConfig(
            llm=LLMConfig(model=self.model, reasoning_effort=self.reasoning_effort),
            k=self.k,
            top_p=self.top_p,
            gate=self.gate,
            threshold=self.threshold,
        )

    @property
    def name(self) -> str:
        return self.config.label


@dataclass(frozen=True, slots=True)
class MaiaSpec:
    rating: MaiaRating

    @property
    def name(self) -> str:
        return f"maia:{self.rating}"


@dataclass(frozen=True, slots=True)
class StockfishSpec:
    strength: EloLimit | SkillLimit

    @property
    def name(self) -> str:
        if isinstance(self.strength, EloLimit):
            return f"stockfish:{self.strength.elo}"
        return f"stockfish:skill:{self.strength.level}"


@dataclass(frozen=True, slots=True)
class RandomSpec:
    @property
    def name(self) -> str:
        return "random"


type PlayerSpec = JevSpec | LLMSpec | HybridSpec | MaiaSpec | StockfishSpec | RandomSpec


class SpecError(ValueError):
    pass


def parse_spec(text: str) -> PlayerSpec:
    parts = text.strip().split(":")
    kind = parts[0]
    if kind == "random" and len(parts) == 1:
        return RandomSpec()
    if kind == "jev":
        style = parts[1] if len(parts) > 1 else "rich"
        if len(parts) > 2 or style not in get_args(DescriptionStyle.__value__):
            raise SpecError(f"jev spec must be `jev` or `jev:terse|rich`, got {text!r}")
        return JevSpec(style=cast("DescriptionStyle", style))
    if kind == "maia" and len(parts) == 2 and parts[1].isdigit():
        rating = int(parts[1])
        if rating not in get_args(MaiaRating.__value__):
            raise SpecError(f"maia rating must be 1100..1900 in steps of 100, got {rating}")
        return MaiaSpec(rating=cast("MaiaRating", rating))
    if kind == "stockfish":
        try:
            if len(parts) == 2:
                return StockfishSpec(EloLimit(int(parts[1])))
            if len(parts) == 3 and parts[1] == "skill":
                return StockfishSpec(SkillLimit(int(parts[2])))
        except ValueError as exc:
            raise SpecError(str(exc)) from exc
        raise SpecError(
            f"stockfish spec must be `stockfish:<elo>` or `stockfish:skill:<n>`, got {text!r}"
        )
    if kind == "llm" and len(parts) >= 2:
        rest = parts[1:]
        include_legal = True
        effort: str = "medium"
        # Options hang off the right; whatever is left in the middle is the model spec, which
        # may itself contain colons (`openai:gpt-5.6-sol`).
        while rest and rest[-1] in ("nolegal", *get_args(ReasoningEffort.__value__)):
            token = rest.pop()
            if token == "nolegal":
                include_legal = False
            else:
                effort = token
        model_text = ":".join(rest)
        if not model_text:
            raise SpecError(f"llm spec needs a model, got {text!r}")
        try:
            model = resolve_model_spec(model_text)
        except ValueError as exc:
            raise SpecError(str(exc)) from exc
        return LLMSpec(
            model=model,
            reasoning_effort=cast("ReasoningEffort", effort),
            include_legal_moves=include_legal,
        )
    if kind == "hybrid" and len(parts) >= 2:
        return _parse_hybrid(text, parts[1:])
    raise SpecError(f"unrecognised player spec {text!r}")


def _parse_hybrid(text: str, rest: list[str]) -> HybridSpec:
    options: dict[str, Any] = {}
    gates = get_args(GateSignal.__value__)
    efforts = get_args(ReasoningEffort.__value__)

    def is_option(token: str) -> bool:
        return (
            token in gates
            or token in efforts
            or (len(token) > 1 and token[0] in "kpt" and _is_number(token[1:]))
        )

    while rest and is_option(rest[-1]):
        token = rest.pop()
        if token in gates:
            options["gate"] = token
        elif token in efforts:
            options["reasoning_effort"] = token
        elif token[0] == "k":
            options["k"] = int(token[1:])
        elif token[0] == "p":
            options["top_p"] = float(token[1:])
        else:
            options["threshold"] = float(token[1:])
    model_text = ":".join(rest)
    if not model_text:
        raise SpecError(f"hybrid spec needs an LLM model, got {text!r}")
    try:
        spec = HybridSpec(model=resolve_model_spec(model_text), **options)
        spec.config  # noqa: B018  # validates k / threshold / top_p ranges
    except ValueError as exc:
        raise SpecError(str(exc)) from exc
    return spec


def _is_number(token: str) -> bool:
    try:
        float(token)
    except ValueError:
        return False
    return True


def _run_config(player: str, game_id: str, ply: int) -> RunnableConfig:
    return {
        "run_name": f"{player} ply {ply}",
        "metadata": {"game_id": game_id, "ply": ply, "player": player},
        "tags": ["jev-chess", player.split(":")[0]],
    }


class EnginePlayer:
    """Wraps a UCI engine so it reports like a policy. Cost is zero, tokens are zero."""

    def __init__(self, name: str, engine: MovePlayer, close: Any = None) -> None:
        self._name = name
        self._engine = engine
        self._close = close

    @property
    def name(self) -> str:
        return self._name

    def decide(self, board: chess.Board, game_id: str, ply: int) -> MoveDecision:
        started = time.perf_counter()
        move = self._engine.play(board)
        return legal_decision(
            {m.uci() for m in board.legal_moves},
            uci=move.uci(),
            source="engine",
            model=self._name,
            latency_ms=(time.perf_counter() - started) * 1000,
            cost_usd=0.0,
        )

    def close(self) -> None:
        if self._close is not None:
            self._close()


class RandomPlayer:
    def __init__(self, seed: int = 0) -> None:
        self._rng = random.Random(seed)

    @property
    def name(self) -> str:
        return "random"

    def decide(self, board: chess.Board, game_id: str, ply: int) -> MoveDecision:
        move = self._rng.choice(list(board.legal_moves))
        return legal_decision(
            {m.uci() for m in board.legal_moves},
            uci=move.uci(),
            source="engine",
            model="random",
            latency_ms=0.0,
            cost_usd=0.0,
        )

    def close(self) -> None:
        return None


class JevPlayer:
    """Plays Jev's top-ranked move every time. The Jev-only baseline."""

    def __init__(self, policy: JevPolicy, name: str) -> None:
        self._policy = policy
        self._name = name

    @property
    def name(self) -> str:
        return self._name

    def decide(self, board: chess.Board, game_id: str, ply: int) -> MoveDecision:
        ranking = self._policy.rank(board, run_config=_run_config(self._name, game_id, ply))
        return ranking_decision(ranking, board)

    def close(self) -> None:
        return None


class HybridPlayer:
    def __init__(self, policy: HybridPolicy, name: str) -> None:
        self._policy = policy
        self._name = name

    @property
    def name(self) -> str:
        return self._name

    def decide(self, board: chess.Board, game_id: str, ply: int) -> MoveDecision:
        return self._policy.decide(board, run_config=_run_config(self._name, game_id, ply))

    def close(self) -> None:
        return None


class LLMPlayer:
    def __init__(self, policy: LLMPolicy, name: str) -> None:
        self._policy = policy
        self._name = name

    @property
    def name(self) -> str:
        return self._name

    def decide(self, board: chess.Board, game_id: str, ply: int) -> MoveDecision:
        return self._policy.decide(board, run_config=_run_config(self._name, game_id, ply))

    def close(self) -> None:
        return None


def build_player(
    spec: PlayerSpec,
    engines: EngineSettings,
    gateway: GatewaySettings | None = None,
    seed: int = 0,
) -> "AnyPlayer":
    """Open whatever the spec needs. Callers close the player when the match is over."""
    if isinstance(spec, RandomSpec):
        return RandomPlayer(seed)
    if isinstance(spec, MaiaSpec):
        engine = MaiaOpponent.open(spec.rating, engines.maia_weights_dir, engines.lc0_path)
        return EnginePlayer(spec.name, engine, engine.close)
    if isinstance(spec, StockfishSpec):
        sf = StockfishOpponent.open(spec.strength, engines.stockfish_path)
        return EnginePlayer(spec.name, sf, sf.close)
    if isinstance(spec, JevSpec):
        policy = JevPolicy.from_settings(gateway, JevConfig(style=spec.style))
        return JevPlayer(policy, spec.name)
    if isinstance(spec, HybridSpec):
        return HybridPlayer(HybridPolicy.from_settings(gateway, spec.config), spec.name)
    config = LLMConfig(
        model=spec.model,
        reasoning_effort=spec.reasoning_effort,
        include_legal_moves=spec.include_legal_moves,
        seed=seed,
    )
    return LLMPlayer(LLMPolicy.from_settings(gateway, config), spec.name)


type AnyPlayer = RandomPlayer | EnginePlayer | JevPlayer | LLMPlayer | HybridPlayer


class Roster:
    """Context manager that opens both players and guarantees engine processes are closed."""

    def __init__(
        self,
        white: PlayerSpec,
        black: PlayerSpec,
        engines: EngineSettings,
        gateway: GatewaySettings | None = None,
        seed: int = 0,
    ) -> None:
        self._specs = (white, black)
        self._engines = engines
        self._gateway = gateway
        self._seed = seed
        self.white: AnyPlayer | None = None
        self.black: AnyPlayer | None = None

    def __enter__(self) -> Self:
        self.white = build_player(self._specs[0], self._engines, self._gateway, self._seed)
        self.black = build_player(self._specs[1], self._engines, self._gateway, self._seed + 1)
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        for player in (self.white, self.black):
            if player is not None:
                player.close()
