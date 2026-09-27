"""ChessSummarization: LangChain's summarization with the summary call on the turn record.

Core-owned: last in the stack, unguarded, and the only middleware allowed to rewrite `messages`.
The stock trigger and cutoff logic are kept; the summary's own calls are appended to the current
turn in the same update as the rewrite, so the summary and its cost are checkpointed together.
"""

import contextvars
import uuid
from collections.abc import Callable, Mapping, Sequence
from typing import Any, cast

from langchain.agents.middleware import SummarizationMiddleware
from langchain.agents.middleware.types import AgentMiddleware
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AnyMessage, BaseMessage, HumanMessage, SystemMessage

from langchain_chess.errors import ChessContractError
from langchain_chess.recorder import CallRecorder
from langchain_chess.state import Call, ChessState, TurnRecord

CHESS_SUMMARY_PROMPT = """Summarize this chess game's conversation for the player who will \
continue it. Keep plans, threats, opponent tendencies and open questions. Ignore rejected \
moves and retry feedback. Do not list moves or describe the board; the current position is \
shown separately on every turn.

Messages to summarize:
{messages}"""

DEFAULT_TRIGGER = ("fraction", 0.7)
"""Of the model's input limit, counting the system prompt and the turn's message too."""

type Overhead = Callable[[Mapping[str, Any]], Sequence[BaseMessage]]
"""What the model reads besides the stored messages: the system prompt and the turn's message."""

_OVERHEAD: contextvars.ContextVar[int] = contextvars.ContextVar("chess_overhead", default=0)
DEFAULT_KEEP = ("messages", 20)


def input_limit(model: BaseChatModel) -> int | None:
    """The limit `DEFAULT_TRIGGER` is a fraction of; None when the model's profile lacks it."""
    return (model.profile or {}).get("max_input_tokens")


class ChessSummarization(SummarizationMiddleware):
    state_schema = ChessState

    def __init__(
        self,
        model: str | BaseChatModel,
        *,
        recorder: CallRecorder,
        max_retries: int,
        overhead: Overhead | None = None,
        **settings: Any,
    ) -> None:
        settings.setdefault("trigger", DEFAULT_TRIGGER)
        settings.setdefault("keep", DEFAULT_KEEP)
        settings.setdefault("summary_prompt", CHESS_SUMMARY_PROMPT)
        if "{messages}" not in settings["summary_prompt"]:
            msg = "a summary_prompt must include {messages}"
            raise ChessContractError(msg)
        # The stock cutoff counts messages and knows nothing about turns: keep at least the
        # opening message, every attempt and every feedback line of one turn.
        floor = 2 * max_retries + 2
        kind, value = settings["keep"]
        if kind != "messages" or value < floor:
            msg = f"summarization keep must be ('messages', >= {floor}), got {settings['keep']}"
            raise ChessContractError(msg)
        try:
            super().__init__(model, **settings)
        except ValueError as e:
            msg = (
                "memory needs the model's input limit for a fractional trigger: "
                "give the model a profile (profile={'max_input_tokens': ...}), pass "
                "`summarization` with an absolute trigger, or turn memory off"
            )
            raise ChessContractError(msg) from e
        self.recorder = recorder
        self.overhead = overhead

    def _should_summarize(self, messages: list[AnyMessage], total_tokens: int) -> bool:
        # Only the trigger counts the rest of the request: trimming and the cutoff don't.
        return super()._should_summarize(messages, total_tokens + _OVERHEAD.get())

    def overhead_tokens(self, state: Mapping[str, Any]) -> int:
        return self._count(list(self.overhead(state))) if self.overhead is not None else 0

    def _count(self, messages: list[BaseMessage]) -> int:
        return self.token_counter(cast("list[AnyMessage]", messages))

    def check_room(self, system_prompt: str) -> None:
        """A system prompt that fills the trigger alone would summarize before every call."""
        tokens = self._count([SystemMessage(system_prompt)])
        limit = (self.model.profile or {}).get("max_input_tokens")
        for clause in self._trigger_clauses:
            fraction = clause.get("fraction")
            absolute = clause.get("tokens")
            threshold = int(limit * fraction) if fraction is not None and limit else absolute
            if threshold is not None and tokens >= threshold:
                msg = (
                    f"the system prompt is {tokens} tokens, and memory summarizes at {threshold}: "
                    "shorten it or turn memory off"
                )
                raise ChessContractError(msg)

    @classmethod
    def from_middleware(
        cls,
        configured: SummarizationMiddleware,
        *,
        recorder: CallRecorder,
        max_retries: int,
        overhead: Overhead | None = None,
    ) -> "ChessSummarization":
        """Copy a configured `SummarizationMiddleware`'s public settings."""
        return cls(
            configured.model,
            recorder=recorder,
            max_retries=max_retries,
            overhead=overhead,
            trigger=configured.trigger,
            keep=configured.keep,
            summary_prompt=configured.summary_prompt,
            trim_tokens_to_summarize=configured.trim_tokens_to_summarize,
            token_counter=configured.token_counter,
        )

    @property
    def name(self) -> str:
        # The class name would change the node names.
        return "SummarizationMiddleware"

    def _account(
        self, state: Mapping[str, Any], update: dict[str, Any] | None, calls: list[Call]
    ) -> dict[str, Any] | None:
        if update is None:
            return None
        consumed = list(state.get("consumed_message_ids") or [])
        for message in update["messages"]:
            if isinstance(message, HumanMessage) and message.id is None:
                # The summary is never a command: give it an id and mark it consumed.
                message.id = str(uuid.uuid4())
                consumed.append(message.id)
        turns: list[TurnRecord] = list(state["turns"])
        turn = turns[-1]
        turns[-1] = {**turn, "calls": [*turn["calls"], *calls]}
        return {**update, "turns": turns, "consumed_message_ids": consumed}

    def before_model(self, state: Any, runtime: Any) -> dict[str, Any] | None:
        token = _OVERHEAD.set(self.overhead_tokens(state))
        try:
            with self.recorder.sink("summary") as calls:
                update = super().before_model(state, runtime)
        finally:
            _OVERHEAD.reset(token)
        return self._account(state, update, calls)

    async def abefore_model(self, state: Any, runtime: Any) -> dict[str, Any] | None:
        token = _OVERHEAD.set(self.overhead_tokens(state))
        try:
            with self.recorder.sink("summary") as calls:
                update = await super().abefore_model(state, runtime)
        finally:
            _OVERHEAD.reset(token)
        return self._account(state, update, calls)


class NoSummarization(AgentMiddleware[ChessState, Any, Any]):
    """Keeps the summarization node when memory is off, so every memory setting builds one graph."""

    state_schema = ChessState

    @property
    def name(self) -> str:
        return "SummarizationMiddleware"

    def before_model(self, state: Any, runtime: Any) -> dict[str, Any] | None:
        return None

    async def abefore_model(self, state: Any, runtime: Any) -> dict[str, Any] | None:
        return None
