"""The extension contract: the `ChessMiddleware` base and the write guard.

`create_chess_agent` wraps every user middleware in a generated proxy that hands each hook a
detached copy of the reserved state and validates what it returns. This makes mistakes in
trusted in-process code fail loudly; it is not a security boundary.
"""

import copy
import inspect
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, get_type_hints

import chess
from langchain.agents.middleware.types import (
    AgentMiddleware,
    ExtendedModelResponse,
    ModelRequest,
)
from langgraph.types import Command

from langchain_chess.errors import ChessContractError
from langchain_chess.rules import root_board
from langchain_chess.state import CHESS_KEYS, Call, ChessState, JSONValue, Proposal

NODE_HOOKS = ("before_agent", "before_model", "after_model", "after_agent")
WRITABLE = frozenset({"allowed_moves", "proposal", "fallback_move", "candidates"})


@dataclass(frozen=True, slots=True)
class PositionView:
    """The current turn's position, as a middleware sees it."""

    start_fen: str
    moves: tuple[str, ...]
    allowed: tuple[str, ...]
    """The hard constraint: legal moves narrowed by `restrict` and earlier middleware."""
    initial_allowed: tuple[str, ...]
    candidates: tuple[str, ...] | None
    turn_id: str

    def board(self) -> chess.Board:
        """A fresh board replayed from the root, move stack included."""
        board = root_board(self.start_fen)
        for uci in self.moves:
            board.push_uci(uci)
        return board


class ChessMiddleware(AgentMiddleware[ChessState, Any, Any]):
    """Optional base for chess extensions.

    Rules for extensions:

    - Write only `allowed_moves` (narrowing), `proposal`, `fallback_move`, `candidates` and keys
      declared in your own `state_schema`. Mark your keys `PrivateStateAttr` (or at least
      `OmitFromInput`). Register no tools.
    - A proposer jumps from `before_model` to `end` and must declare
      `@hook_config(can_jump_to=["end"])`; without it the jump is silently ignored.
    - Implement both sync and async variants of every hook, `wrap_model_call` included.
    - `before_model` must be idempotent. A retry re-enters at the first `before_model`, so freeze
      each decision per `turn_id` (never per FEN) and replay it as `current allowed ∩ frozen`.
    - Telemetry lives in your own state keys until the turn finalizes: `ply_meta` fills
      `Ply.meta[name]` at commit, and `turn_calls` reports your calls whenever a turn is
      committed, terminal or abandoned.
    """

    state_schema = ChessState

    agent_seed: int = 0
    """Set by `create_chess_agent(seed=...)`."""

    def position(self, state: Mapping[str, Any]) -> PositionView:
        turn = state["turns"][-1]
        candidates = state.get("candidates")
        return PositionView(
            start_fen=state["start_fen"],
            moves=tuple(state["moves"]),
            allowed=tuple(state["allowed_moves"]),
            initial_allowed=tuple(turn["initial_allowed"]),
            candidates=tuple(candidates) if candidates is not None else None,
            turn_id=turn["id"],
        )

    def propose(
        self,
        uci: str,
        *,
        source: str | None = None,
        analysis: str | None = None,
        meta: dict[str, JSONValue] | None = None,
    ) -> dict[str, Any]:
        """An update that proposes `uci` and skips the model. Only from `before_model`."""
        proposal: Proposal = {"uci": uci, "source": source or self.name}
        if analysis is not None:
            proposal["analysis"] = analysis
        if meta is not None:
            proposal["meta"] = meta
        return {"proposal": proposal, "jump_to": "end"}

    def narrow(self, state: Mapping[str, Any], moves: Sequence[str]) -> dict[str, Any]:
        """An update keeping only the allowed moves in `moves`, in their current order."""
        keep = set(moves)
        return {"allowed_moves": [uci for uci in state["allowed_moves"] if uci in keep]}

    def ply_meta(self, state: Mapping[str, Any]) -> dict[str, JSONValue] | None:
        """Telemetry for `Ply.meta[self.name]`, called when this turn commits a move."""
        return None

    def turn_calls(self, state: Mapping[str, Any]) -> list[Call]:
        """This middleware's own model calls, called whenever the turn finalizes."""
        return []


_CHESS_FIELDS = CHESS_KEYS


def own_keys(middleware: AgentMiddleware) -> frozenset[str]:
    hints = get_type_hints(middleware.state_schema, include_extras=True)
    return frozenset(hints) - _CHESS_FIELDS


def detach(state: Mapping[str, Any]) -> dict[str, Any]:
    """LangGraph passes channel values without copying, so a shallow copy won't do."""
    return {k: (copy.deepcopy(v) if k in CHESS_KEYS else v) for k, v in state.items()}


class _Checker:
    def __init__(self, owner: str, own: frozenset[str]) -> None:
        self.owner = owner
        self.own = own

    def fail(self, key: str, why: str) -> None:
        msg = f"{self.owner} wrote `{key}`: {why}"
        raise ChessContractError(msg)

    def check(self, update: Any, state: Mapping[str, Any], *, model_call: bool = False) -> Any:
        """The validated update, with the candidates' writer recorded; raises on a violation."""
        if update is None:
            return None
        if isinstance(update, Command):
            if update.goto or update.graph is not None or update.resume is not None:
                self.fail("Command", "only Command(update=dict) is allowed")
            return Command(update=self.check(update.update, state, model_call=model_call))
        if not isinstance(update, dict):
            self.fail("<update>", f"updates must be dicts, got {type(update).__name__}")
        allowed = list(state.get("allowed_moves") or [])
        for key, value in update.items():
            if key == "jump_to" or key in self.own:
                continue
            if model_call:
                self.fail(key, "a model-call command may only write this middleware's own keys")
            if key not in WRITABLE:
                why = "core-owned" if key in _CHESS_FIELDS else "not declared in its state_schema"
                self.fail(key, why)
            if key == "allowed_moves":
                if not value:
                    self.fail(key, "the narrowing leaves no move")
                if not set(value) <= set(allowed):
                    self.fail(key, "allowed_moves may only narrow")
                allowed = list(value)
        checked = dict(update)
        if (proposal := update.get("proposal")) is not None:
            if state.get("proposal") is not None:
                self.fail("proposal", "a proposal already exists this turn")
            if proposal.get("uci") not in allowed:
                self.fail("proposal", f"{proposal.get('uci')} is not an allowed move")
        if (fallback := update.get("fallback_move")) is not None and fallback not in allowed:
            self.fail("fallback_move", f"{fallback} is not an allowed move")
        if "candidates" in update:
            by = state.get("candidates_by")
            if by is not None and by != self.owner:
                self.fail("candidates", f"{by} already set candidates this turn")
            ranked = update["candidates"]
            if ranked is not None and (
                len(set(ranked)) != len(ranked) or not set(ranked) <= set(allowed)
            ):
                self.fail("candidates", "must be a duplicate-free subset of allowed_moves")
            checked["candidates_by"] = self.owner
        return checked


def _node_hook(inner: Callable[..., Any], checker: _Checker, *, is_async: bool) -> Any:
    if is_async:

        async def ahook(self: Any, state: Any, runtime: Any) -> Any:
            return checker.check(await inner(detach(state), runtime), state)

        hook = ahook
    else:

        def hook(self: Any, state: Any, runtime: Any) -> Any:
            return checker.check(inner(detach(state), runtime), state)

    if can_jump := getattr(inner, "__can_jump_to__", None):
        setattr(hook, "__can_jump_to__", list(can_jump))  # noqa: B010
    return hook


def _checked_result(result: Any, checker: _Checker, state: Mapping[str, Any]) -> Any:
    # create_agent strips inner ExtendedModelResponses and applies their commands separately,
    # so each wrapper's command is checked here, where it is still attached.
    if isinstance(result, ExtendedModelResponse) and result.command is not None:
        checker.check(result.command, state, model_call=True)
    return result


def _wrap_hook(inner: Callable[..., Any], checker: _Checker, *, is_async: bool) -> Any:
    if is_async:

        async def awrap(
            self: Any, request: ModelRequest, handler: Callable[..., Awaitable[Any]]
        ) -> Any:
            state: Any = request.state
            detached: Any = detach(state)
            result = await inner(request.override(state=detached), handler)
            return _checked_result(result, checker, state)

        return awrap

    def wrap(self: Any, request: ModelRequest, handler: Callable[..., Any]) -> Any:
        state: Any = request.state
        detached: Any = detach(state)
        return _checked_result(inner(request.override(state=detached), handler), checker, state)

    return wrap


def guard(inner: AgentMiddleware, *, seed: int = 0) -> AgentMiddleware:
    """A proxy delegating to `inner` whose hooks see detached state and whose writes are checked.

    A hook is defined on the proxy only where `inner`'s class overrides `AgentMiddleware`:
    `create_agent` detects hooks by identity and builds sync and async nodes separately.
    """
    if getattr(inner, "tools", None):
        msg = f"{inner.name} registers tools; chess agents have none"
        raise ChessContractError(msg)
    if isinstance(inner, ChessMiddleware):
        inner.agent_seed = seed
    cls = type(inner)
    own = own_keys(inner)
    checker = _Checker(inner.name, own)
    namespace: dict[str, Any] = {
        "state_schema": inner.state_schema,
        "tools": [],
        "trace_policy": getattr(inner, "trace_policy", None),
        "transformers": tuple(getattr(inner, "transformers", ())),
        "name": property(lambda self: inner.name),
        "inner": inner,
        "own_keys": own,
    }
    for hook in NODE_HOOKS:
        for attr, is_async in ((hook, False), (f"a{hook}", True)):
            if getattr(cls, attr) is getattr(AgentMiddleware, attr):
                continue
            bound = getattr(inner, attr)
            if is_async and not inspect.iscoroutinefunction(bound):
                msg = f"{inner.name}.{attr} must be a coroutine function"
                raise ChessContractError(msg)
            namespace[attr] = _node_hook(bound, checker, is_async=is_async)
    for attr, is_async in (("wrap_model_call", False), ("awrap_model_call", True)):
        if getattr(cls, attr) is not getattr(AgentMiddleware, attr):
            namespace[attr] = _wrap_hook(getattr(inner, attr), checker, is_async=is_async)
    if isinstance(inner, ChessMiddleware):
        namespace["ply_meta"] = lambda self, state: inner.ply_meta(detach(state))
        namespace["turn_calls"] = lambda self, state: inner.turn_calls(detach(state))
    proxy = type(f"Guarded{cls.__name__}", (AgentMiddleware,), namespace)
    return proxy()


def ply_meta_of(
    middleware: AgentMiddleware, state: Mapping[str, Any]
) -> dict[str, JSONValue] | None:
    fn = getattr(middleware, "ply_meta", None)
    return fn(state) if fn is not None else None


def turn_calls_of(middleware: AgentMiddleware, state: Mapping[str, Any]) -> list[Call]:
    fn = getattr(middleware, "turn_calls", None)
    return list(fn(state) or []) if fn is not None else []
