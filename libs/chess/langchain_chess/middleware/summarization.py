"""ChessSummarization: LangChain's summarization with the summary call on the turn record.

Core-owned: last in the stack, unguarded, and the only middleware allowed to rewrite `messages`.
The stock trigger and cutoff logic are kept; the summary's own calls are appended to the current
turn in the same update as the rewrite, so the summary and its cost are checkpointed together.
"""

import uuid
from collections.abc import Mapping
from typing import Any

from langchain.agents.middleware import SummarizationMiddleware
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import HumanMessage

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
"""Of the model's input limit: room for the system prompt, the position and the output."""
DEFAULT_KEEP = ("messages", 20)


class ChessSummarization(SummarizationMiddleware):
    state_schema = ChessState

    def __init__(
        self,
        model: str | BaseChatModel,
        *,
        recorder: CallRecorder,
        max_retries: int,
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
                "memory='summarize' needs the model's input limit for a fractional trigger: "
                "give the model a profile (profile={'max_input_tokens': ...}) or pass an "
                "absolute trigger such as summary_trigger_tokens"
            )
            raise ChessContractError(msg) from e
        self.recorder = recorder

    @classmethod
    def from_middleware(
        cls, configured: SummarizationMiddleware, *, recorder: CallRecorder, max_retries: int
    ) -> "ChessSummarization":
        """Copy a configured `SummarizationMiddleware`'s public settings."""
        return cls(
            configured.model,
            recorder=recorder,
            max_retries=max_retries,
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
        with self.recorder.sink("summary") as calls:
            update = super().before_model(state, runtime)
        return self._account(state, update, calls)

    async def abefore_model(self, state: Any, runtime: Any) -> dict[str, Any] | None:
        with self.recorder.sink("summary") as calls:
            update = await super().abefore_model(state, runtime)
        return self._account(state, update, calls)
