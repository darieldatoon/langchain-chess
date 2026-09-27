"""ChessCore: the turn lifecycle, the model view, reply parsing and atomic finalization.

It is always first in the stack: its `before_agent` runs first, its `wrap_model_call` is the
outermost, and its `after_model` and `after_agent` run last.
"""

import math
import time
import uuid
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal

import chess
from langchain.agents.middleware.types import (
    AgentMiddleware,
    ExtendedModelResponse,
    ModelRequest,
    ModelResponse,
    hook_config,
)
from langchain_core.messages import AIMessage, AnyMessage, HumanMessage, RemoveMessage
from langgraph.types import Command

from langchain_chess.contract import PositionView, ply_meta_of, turn_calls_of, turn_latency_of
from langchain_chess.errors import ChessContractError, ContextBudgetError
from langchain_chess.parse import EMPTY_REPLY, parse_move, text_of
from langchain_chess.prompt import (
    PositionRenderer,
    delta_text,
    feedback_text,
    model_view,
    render_position,
)
from langchain_chess.recorder import CallRecorder
from langchain_chess.rules import (
    CommandError,
    DrawClaims,
    ending,
    fingerprint,
    flag_fell,
    legal_member,
    legal_ucis,
    parse_chat,
    replay,
    result_text,
    root_board,
    side,
)
from langchain_chess.state import (
    Call,
    ChessState,
    ClockInput,
    ClockStart,
    FailedCall,
    Invocation,
    Ply,
    PositionInput,
    Proposal,
    Resignation,
    Side,
    TurnRecord,
)

_OVERFLOW_HINTS = (
    "prompt is too long",
    "context length",
    "context_length",
    "maximum context",
    "too many tokens",
    "input is too long",
)

# Cleared whenever a turn opens, retries from scratch, or finalizes.
_DECISION_RESET: dict[str, Any] = {
    "proposal": None,
    "terminal_intent": None,
    "candidates": None,
    "candidates_by": None,
    "fallback_move": None,
    "failed_call": None,
    "clock_start": None,
}

_CLEARED_INPUT: dict[str, Any] = {"position": None, "clock": None, "flag": None}


def _new_id() -> str:
    return str(uuid.uuid4())


def _invocation(
    action: Literal["execute", "reject", "noop"], opened_turn: str | None = None
) -> Invocation:
    return {"id": _new_id(), "action": action, "opened_turn": opened_turn}


def looks_like_overflow(error: BaseException) -> bool:
    text = str(error).lower()
    return any(hint in text for hint in _OVERFLOW_HINTS)


def _whole(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _well_formed(clock: object) -> bool:
    if not isinstance(clock, Mapping):
        return False
    control = clock.get("control")
    return (
        isinstance(control, Mapping)
        and _whole(base := control.get("base_ms"))
        and base > 0
        and _whole(increment := control.get("increment_ms"))
        and increment >= 0
        and _whole(clock.get("white_ms"))
        and _whole(clock.get("black_ms"))
    )


def _time_left(clock: ClockInput, mover: Side) -> int:
    return clock["white_ms"] if mover == "white" else clock["black_ms"]


def _external_ply(index: int, board: chess.Board, move: chess.Move, clock_ms: int | None) -> Ply:
    return {
        "ply": index,
        "side": side(board.turn),
        "uci": move.uci(),
        "san": board.san(move),
        "source": "external",
        "analysis": None,
        "message_id": None,
        "turn_id": None,
        "model": None,
        "latency_ms": 0.0,
        "meta": {},
        "clock_ms": clock_ms,
    }


@dataclass(frozen=True, slots=True)
class _Synced:
    """A validated command, ready to write."""

    board: chess.Board
    start_fen: str
    moves: list[str]
    plies: list[Ply]
    messages: list[AnyMessage]
    consumed: list[str]
    opened_message_id: str
    restrict: list[str] | None


class ChessCore(AgentMiddleware[ChessState, Any, Any]):
    state_schema = ChessState

    def __init__(
        self,
        *,
        memory: bool,
        max_retries: int,
        draw_claims: DrawClaims,
        render: PositionRenderer,
        recorder: CallRecorder,
        extensions: Sequence[AgentMiddleware] = (),
        now: Callable[[], float] = time.time,
    ) -> None:
        self.memory = memory
        self.max_retries = max_retries
        self.draw_claims: DrawClaims = draw_claims
        self.render = render
        self.recorder = recorder
        self.extensions = list(extensions)
        self.now = now
        # In memory only: after_model raises the original error in the run that failed. Absent
        # on a resume, which tries the model call again instead of re-raising forever.
        self._failures: dict[str, Exception] = {}

    # ---- helpers ------------------------------------------------------------------------------

    def _board(self, state: Mapping[str, Any]) -> chess.Board:
        return replay(state["start_fen"], state["moves"], "never")

    def _extension_calls(self, state: Mapping[str, Any]) -> list[Call]:
        return [call for m in self.extensions for call in turn_calls_of(m, state)]

    def _finalized(self, turn: TurnRecord, state: Mapping[str, Any]) -> TurnRecord:
        """The turn with the extensions' calls and time folded in: once, as it finalizes."""
        return {
            **turn,
            "calls": [*turn["calls"], *self._extension_calls(state)],
            "latency_ms": turn["latency_ms"]
            + sum(turn_latency_of(m, state) for m in self.extensions),
        }

    @staticmethod
    def _first_run(state: Mapping[str, Any]) -> dict[str, Any]:
        """LangGraph omits never-written keys, so a new game would otherwise lack `outcome`."""
        if "moves" in state:
            return {}
        return {
            "start_fen": chess.STARTING_FEN,
            "moves": [],
            "plies": [],
            "turns": [],
            "outcome": None,
            "error": None,
            "time_control": None,
            "consumed_message_ids": [],
        }

    def _reject(
        self, state: Mapping[str, Any], reason: str, message: AnyMessage | None
    ) -> dict[str, Any]:
        update: dict[str, Any] = self._first_run(state) | {
            "error": reason,
            "invocation": _invocation("reject"),
            **_CLEARED_INPUT,
            "jump_to": "end",
        }
        if message is not None and message.id is not None:
            update["messages"] = [RemoveMessage(id=message.id)]
        return update

    def _noop(self, state: Mapping[str, Any]) -> dict[str, Any]:
        return self._first_run(state) | {
            "invocation": _invocation("noop"),
            **_CLEARED_INPUT,
            "error": None,
            "jump_to": "end",
        }

    # ---- before_agent: the turn lifecycle -----------------------------------------------------

    @hook_config(can_jump_to=["end"])
    def before_agent(self, state: ChessState, runtime: Any) -> dict[str, Any] | None:
        return self._lifecycle(state)

    @hook_config(can_jump_to=["end"])
    async def abefore_agent(self, state: ChessState, runtime: Any) -> dict[str, Any] | None:
        return self._lifecycle(state)

    def _lifecycle(self, state: Mapping[str, Any]) -> dict[str, Any]:
        position: PositionInput | None = state.get("position")
        clock: ClockInput | None = state.get("clock")
        flag: Side | None = state.get("flag")
        messages: list[AnyMessage] = state.get("messages") or []
        consumed = set(state.get("consumed_message_ids") or [])
        last = messages[-1] if messages else None
        new_human = last if isinstance(last, HumanMessage) and last.id not in consumed else None
        turns: list[TurnRecord] = list(state.get("turns") or [])
        turn = turns[-1] if turns else None

        if position is not None and new_human is not None:
            return self._reject(state, "send a position or a message, not both", new_human)
        if flag is not None and (position is not None or new_human is not None):
            return self._reject(state, "send a flag with the clock alone", new_human)
        # Before any sync: python-chess can't rederive a resignation from the board.
        if state.get("outcome") is not None:
            if position is not None or new_human is not None or flag is not None:
                return self._reject(state, "the game is over", new_human)
            return self._noop(state)
        if flag is not None:
            return self._flag(state, clock, flag)

        if position is not None:
            request: str | None = fingerprint(
                position.get("start_fen") or chess.STARTING_FEN,
                position.get("moves") or [],
                position.get("restrict"),
            )
        elif new_human is not None:
            request = str(new_human.id)
        else:
            request = None

        pending = turn is not None and turn["status"] == "pending"
        if request is None or (turn is not None and request == turn["request"]):
            if not pending and clock is None:
                return self._noop(state)
            if (problem := self._clock_problem(state, clock)) is not None:
                return self._reject(state, problem, new_human)
            return self._retry(state, clock) if pending else self._noop(state)
        if pending and new_human is not None:
            return self._reject(state, "finish or retry the pending turn first", new_human)
        if (problem := self._clock_problem(state, clock)) is not None:
            return self._reject(state, problem, new_human)

        base = self._first_run(state) | dict(state)
        try:
            synced = (
                self._sync_chat(base, new_human, clock)
                if new_human is not None
                else self._sync_position(base, position or {}, clock)
            )
        except CommandError as e:
            return self._reject(state, str(e), new_human)

        if pending:
            assert turn is not None
            turns[-1] = {**self._finalized(turn, state), "status": "abandoned"}
        opened: TurnRecord = {
            "id": _new_id(),
            "request": request,
            "initial_allowed": [],
            "status": "pending",
            "ply": None,
            "calls": [],
            "rejected_message_ids": [],
            "feedback_message_ids": [],
            "opened_message_id": synced.opened_message_id,
            "illegal_attempts": 0,
            "latency_ms": 0.0,
        }
        update: dict[str, Any] = self._first_run(state) | {
            **_DECISION_RESET,
            "start_fen": synced.start_fen,
            "moves": synced.moves,
            "plies": synced.plies,
            "consumed_message_ids": [*(state.get("consumed_message_ids") or []), *synced.consumed],
            **_CLEARED_INPUT,
            "error": None,
        }
        if clock is not None and state.get("time_control") is None:
            update["time_control"] = clock["control"]
        new_messages = list(synced.messages)
        outcome = ending(synced.board, self.draw_claims)
        if outcome is not None:
            new_messages.append(AIMessage(result_text(outcome), id=_new_id()))
            return update | {
                "turns": [*turns, {**opened, "status": "terminal"}],
                "outcome": outcome,
                "messages": new_messages,
                "allowed_moves": [],
                "invocation": _invocation("noop", opened["id"]),
                "jump_to": "end",
            }
        restrict = synced.restrict
        allowed = [u for u in legal_ucis(synced.board) if restrict is None or u in restrict]
        update |= {
            "turns": [*turns, {**opened, "initial_allowed": allowed}],
            "allowed_moves": allowed,
            "invocation": _invocation("execute", opened["id"]),
            "clock_start": self._clock_start(clock, synced.board),
        }
        if new_messages:
            update["messages"] = new_messages
        return update

    def _sync_chat(
        self, state: Mapping[str, Any], message: AnyMessage, clock: ClockInput | None
    ) -> _Synced:
        board = self._board(state)
        move = parse_chat(board, text_of(message))
        plies = list(state["plies"])
        moves = list(state["moves"])
        if move is not None:
            mover = side(board.turn)
            plies.append(
                _external_ply(len(plies), board, move, _time_left(clock, mover) if clock else None)
            )
            moves.append(move.uci())
            board.push(move)
        return _Synced(
            board=board,
            start_fen=state["start_fen"],
            moves=moves,
            plies=plies,
            messages=[],
            consumed=[str(message.id)],
            opened_message_id=str(message.id),
            restrict=None,
        )

    def _sync_position(
        self, state: Mapping[str, Any], position: PositionInput, clock: ClockInput | None
    ) -> _Synced:
        thread_moves: list[str] = list(state["moves"])
        root = root_board(position.get("start_fen") or chess.STARTING_FEN).fen()
        if thread_moves and root != root_board(state["start_fen"]).fen():
            msg = "a different starting position; use a new thread"
            raise CommandError(msg)
        requested = list(position.get("moves") or [])
        board = replay(root, requested, self.draw_claims)
        restrict = position.get("restrict")
        if restrict is not None:
            if not restrict:
                msg = "restrict must not be empty"
                raise CommandError(msg)
            if not set(restrict) <= set(legal_ucis(board)):
                msg = "restrict contains moves that are not legal here"
                raise CommandError(msg)
        if requested[: len(thread_moves)] != thread_moves:
            msg = "the position does not extend this game; use a new thread"
            raise CommandError(msg)
        new = requested[len(thread_moves) :]
        plies = list(state["plies"])
        cursor = replay(root, thread_moves, "never")
        for index, uci in enumerate(new):
            move = legal_member(cursor, uci)
            mover = side(cursor.turn)
            # The clock is a snapshot: only each side's latest move has a known time left.
            latest = index >= len(new) - 2
            clock_ms = _time_left(clock, mover) if clock and latest else None
            plies.append(_external_ply(len(plies), cursor, move, clock_ms))
            cursor.push(move)
        text = delta_text(
            root,
            [p["san"] for p in plies],
            len(thread_moves),
            board.turn,
            had_moves=bool(thread_moves),
        )
        delta = HumanMessage(text, id=_new_id())
        return _Synced(
            board=board,
            start_fen=root,
            moves=requested,
            plies=plies,
            messages=[delta],
            consumed=[str(delta.id)],
            opened_message_id=str(delta.id),
            restrict=list(restrict) if restrict is not None else None,
        )

    def _retry(self, state: Mapping[str, Any], clock: ClockInput | None) -> dict[str, Any]:
        base = {
            "invocation": _invocation("execute"),
            **_CLEARED_INPUT,
            "error": None,
            "clock_start": self._clock_start(clock, self._board(state)),
        }
        if state.get("proposal") is not None or state.get("terminal_intent") is not None:
            # The decision already passed validation: finalize it rather than ask again, which
            # would cost money and might change the move.
            return base | {"jump_to": "end"}
        turn = state["turns"][-1]
        return _DECISION_RESET | base | {"allowed_moves": list(turn["initial_allowed"])}

    # ---- the clock ----------------------------------------------------------------------------

    @staticmethod
    def _clock_problem(
        state: Mapping[str, Any], clock: ClockInput | None, *, flag: bool = False
    ) -> str | None:
        """Why a run's clock can't be played with, or None. The client keeps the clock."""
        control = state.get("time_control")
        if clock is None:
            return None if control is None else "this game is timed: send the clock with every run"
        if not _well_formed(clock):
            return (
                "the clock needs whole milliseconds, a positive base and a non-negative increment"
            )
        if control is None:
            if state.get("moves") or state.get("turns"):
                return "this game is untimed: a clock is set when the game starts"
        elif clock["control"] != control:
            return "the time control is fixed for the game"
        if not flag and min(clock["white_ms"], clock["black_ms"]) <= 0:
            return "a clock has run out: send a flag"
        return None

    def _clock_start(self, clock: ClockInput | None, board: chess.Board) -> ClockStart | None:
        if clock is None:
            return None
        return {"remaining_ms": _time_left(clock, side(board.turn)), "at": self.now()}

    def _flag(
        self, state: Mapping[str, Any], clock: ClockInput | None, flag: Side
    ) -> dict[str, Any]:
        """Ends the game on the client's word that `flag` ran out; it must be `flag`'s move."""
        if state.get("time_control") is None:
            return self._reject(state, "this game has no clock", None)
        if (problem := self._clock_problem(state, clock, flag=True)) is not None:
            return self._reject(state, problem, None)
        assert clock is not None
        board = self._board(state)
        if flag not in ("white", "black") or side(board.turn) != flag:
            return self._reject(state, f"{flag} is not to move", None)
        if _time_left(clock, flag) > 0:
            return self._reject(state, f"{flag} still has time", None)
        turns: list[TurnRecord] = list(state["turns"])
        if turns and turns[-1]["status"] == "pending":
            turns[-1] = {**self._finalized(turns[-1], state), "status": "terminal"}
        outcome = flag_fell(board, flag)
        return _DECISION_RESET | {
            **_CLEARED_INPUT,
            "turns": turns,
            "outcome": outcome,
            "messages": [AIMessage(result_text(outcome), id=_new_id())],
            "allowed_moves": [],
            "error": None,
            "invocation": _invocation("noop"),
            "jump_to": "end",
        }

    # ---- the model call -----------------------------------------------------------------------

    def turn_message(self, state: Mapping[str, Any]) -> str:
        """The trailing position message the model reads this turn."""
        allowed = tuple(state["allowed_moves"])
        # Effective candidates: a later hard restriction never leaves stale ones.
        candidates = state.get("candidates")
        turn = state["turns"][-1]
        view = PositionView(
            start_fen=state["start_fen"],
            moves=tuple(state["moves"]),
            allowed=allowed,
            initial_allowed=tuple(turn["initial_allowed"]),
            candidates=None
            if candidates is None
            else tuple(uci for uci in candidates if uci in allowed),
            turn_id=turn["id"],
        )
        return render_position(view, [p["san"] for p in state["plies"]], self.render)

    def _prepare(self, request: ModelRequest) -> ModelRequest:
        state: Any = request.state
        view = model_view(state["messages"], state["turns"], memory=self.memory)
        return request.override(messages=[*view, HumanMessage(self.turn_message(state))])

    @staticmethod
    def _with_calls(request: ModelRequest, calls: list[Call], started: float) -> list[TurnRecord]:
        state: Any = request.state
        turns = list(state["turns"])
        turn = turns[-1]
        turns[-1] = {
            **turn,
            "calls": [*turn["calls"], *calls],
            "latency_ms": turn["latency_ms"] + (time.perf_counter() - started) * 1000,
        }
        return turns

    def _finish(
        self, request: ModelRequest, response: ModelResponse, calls: list[Call], started: float
    ) -> ExtendedModelResponse:
        result: list[Any] = []
        for message in response.result:
            if isinstance(message, AIMessage) and not text_of(message).strip():
                message = AIMessage(
                    content=EMPTY_REPLY,
                    id=message.id,
                    usage_metadata=message.usage_metadata,
                    response_metadata=message.response_metadata,
                )
            result.append(message)
        return ExtendedModelResponse(
            model_response=ModelResponse(
                result=result, structured_response=response.structured_response
            ),
            command=Command(update={"turns": self._with_calls(request, calls, started)}),
        )

    def _failed(
        self, request: ModelRequest, error: Exception, calls: list[Call], started: float
    ) -> ExtendedModelResponse:
        """Keeps the calls that completed before `error`; `after_model` then re-raises it."""
        marker: FailedCall = {"id": _new_id(), "error": f"{type(error).__name__}: {error}"}
        self._failures[marker["id"]] = error
        return ExtendedModelResponse(
            model_response=ModelResponse(result=[]),
            command=Command(
                update={"turns": self._with_calls(request, calls, started), "failed_call": marker}
            ),
        )

    def wrap_model_call(
        self, request: ModelRequest, handler: Callable[[ModelRequest], ModelResponse]
    ) -> ExtendedModelResponse:
        started = time.perf_counter()
        with self.recorder.sink("llm") as calls:
            try:
                try:
                    response = handler(self._prepare(request))
                except Exception as e:
                    if looks_like_overflow(e):
                        raise ContextBudgetError(str(e)) from e
                    raise
            except Exception as error:
                if not calls:
                    raise
                return self._failed(request, error, calls, started)
        return self._finish(request, response, calls, started)

    async def awrap_model_call(
        self, request: ModelRequest, handler: Callable[[ModelRequest], Awaitable[ModelResponse]]
    ) -> ExtendedModelResponse:
        started = time.perf_counter()
        with self.recorder.sink("llm") as calls:
            try:
                try:
                    response = await handler(self._prepare(request))
                except Exception as e:
                    if looks_like_overflow(e):
                        raise ContextBudgetError(str(e)) from e
                    raise
            except Exception as error:
                if not calls:
                    raise
                return self._failed(request, error, calls, started)
        return self._finish(request, response, calls, started)

    # ---- after_model: parse, retry, resign ----------------------------------------------------

    @hook_config(can_jump_to=["model"])
    def after_model(self, state: ChessState, runtime: Any) -> dict[str, Any] | None:
        return self._parse(state)

    @hook_config(can_jump_to=["model"])
    async def aafter_model(self, state: ChessState, runtime: Any) -> dict[str, Any] | None:
        return self._parse(state)

    def _parse(self, state: Mapping[str, Any]) -> dict[str, Any] | None:
        if (failed := state.get("failed_call")) is not None:
            if (error := self._failures.pop(failed["id"], None)) is not None:
                raise error
            return {"failed_call": None, "jump_to": "model"}
        reply = state["messages"][-1]
        board = self._board(state)
        text = text_of(reply)
        allowed: list[str] = state["allowed_moves"]
        move, reason = parse_move(board, text)
        if move is not None and move.uci() in allowed:
            proposal: Proposal = {
                "uci": move.uci(),
                "source": "llm",
                "analysis": text,
                "meta": {"message_id": reply.id},
            }
            return {"proposal": proposal}
        if move is not None:
            reason = f"`{board.san(move)}` is not an allowed move here"
        turns = list(state["turns"])
        turn = turns[-1]
        record: TurnRecord = {
            **turn,
            "rejected_message_ids": [*turn["rejected_message_ids"], str(reply.id)],
            "illegal_attempts": turn["illegal_attempts"] + 1,
        }
        # Counted on the durable turn record, so a retry after a provider error keeps the budget.
        if turn["illegal_attempts"] < self.max_retries:
            feedback = HumanMessage(
                feedback_text(board, allowed, reason or "", empty=text == EMPTY_REPLY),
                id=_new_id(),
            )
            turns[-1] = {
                **record,
                "feedback_message_ids": [*turn["feedback_message_ids"], str(feedback.id)],
            }
            return {
                "messages": [feedback],
                "consumed_message_ids": [*state["consumed_message_ids"], str(feedback.id)],
                "turns": turns,
                "jump_to": "model",
            }
        turns[-1] = record
        intent: Resignation = {
            "kind": "resignation",
            "winner": side(not board.turn),
            "reason": "illegal_moves",
        }
        return {"terminal_intent": intent, "turns": turns}

    # ---- after_agent: atomic finalization -----------------------------------------------------

    def after_agent(self, state: ChessState, runtime: Any) -> dict[str, Any] | None:
        return self._finalize(state)

    async def aafter_agent(self, state: ChessState, runtime: Any) -> dict[str, Any] | None:
        return self._finalize(state)

    def _finalize(self, state: Mapping[str, Any]) -> dict[str, Any] | None:
        if (state.get("invocation") or {}).get("action") != "execute":
            return None
        # Only a pending turn is ever retried or opened as `execute`.
        turns: list[TurnRecord] = list(state["turns"])
        turn = self._finalized(turns[-1], state)
        calls = turn["calls"]
        clock_ms: int | None = None
        if (start := state.get("clock_start")) is not None:
            left = start["remaining_ms"] - (self.now() - start["at"]) * 1000
            if left <= 0:
                # A decision that lands after the flag doesn't count.
                board = self._board(state)
                outcome = flag_fell(board, side(board.turn))
                turns[-1] = {**turn, "status": "terminal"}
                return _DECISION_RESET | {
                    "turns": turns,
                    "outcome": outcome,
                    "messages": [AIMessage(result_text(outcome), id=_new_id())],
                }
            # Up, not to nearest: a move made in time never records an empty clock.
            clock_ms = math.ceil(left) + state["time_control"]["increment_ms"]
        if (intent := state.get("terminal_intent")) is not None:
            turns[-1] = {**turn, "status": "terminal"}
            return _DECISION_RESET | {
                "turns": turns,
                "outcome": intent,
                "messages": [AIMessage(result_text(intent), id=_new_id())],
            }
        proposal: Proposal | None = state.get("proposal")
        if proposal is None:
            msg = "the turn ended without a move or an outcome"
            raise ChessContractError(msg)
        board = self._board(state)
        uci = proposal["uci"]
        if uci not in legal_ucis(board) or uci not in state["allowed_moves"]:
            msg = f"proposal {uci} from {proposal['source']} is not an allowed move"
            raise ChessContractError(msg)
        move = chess.Move.from_uci(uci)
        san = board.san(move)
        meta = proposal.get("meta") or {}
        new_messages: list[AnyMessage] = []
        if proposal["source"] == "llm":
            message_id = meta.get("message_id")
            llm_calls = [c for c in calls if c["kind"] == "llm"]
            model = llm_calls[-1]["model"] if llm_calls else None
        else:
            message = AIMessage(f"MOVE: {san}", id=_new_id())
            new_messages.append(message)
            message_id = message.id
            model = meta.get("model")
        plies: list[Ply] = list(state["plies"])
        ply_meta = {
            m.name: value for m in self.extensions if (value := ply_meta_of(m, state)) is not None
        }
        plies.append(
            {
                "ply": len(plies),
                "side": side(board.turn),
                "uci": uci,
                "san": san,
                "source": proposal["source"],
                "analysis": proposal.get("analysis"),
                "message_id": str(message_id) if message_id is not None else None,
                "turn_id": turn["id"],
                "model": str(model) if model is not None else None,
                "latency_ms": turn["latency_ms"],
                "meta": ply_meta,
                "clock_ms": clock_ms,
            }
        )
        board.push(move)
        turns[-1] = {**turn, "status": "committed", "ply": len(plies) - 1}
        update: dict[str, Any] = _DECISION_RESET | {
            "turns": turns,
            "plies": plies,
            "moves": [*state["moves"], uci],
        }
        if (outcome := ending(board, self.draw_claims)) is not None:
            new_messages.append(AIMessage(result_text(outcome), id=_new_id()))
            update["outcome"] = outcome
        if new_messages:
            update["messages"] = new_messages
        return update
