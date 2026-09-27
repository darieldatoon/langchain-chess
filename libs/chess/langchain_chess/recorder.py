"""`CallRecorder`: collects the provider responses made inside a model call.

A context variable is the sink. ChessCore's model-call wrapper (and ChessSummarization) open one
around their handler, and every chat-model response inside it lands there, inner retries and
fallbacks included. Never key calls by the callback run tree: with LangSmith tracing on,
traceable spans sit between the node and the provider call, and nothing would be recorded.
"""

import contextlib
import contextvars
import threading
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.messages import AIMessage
from langchain_core.outputs import ChatGeneration, LLMResult

from langchain_chess.pricing import make_call, tokens_from_usage
from langchain_chess.state import Call, CallKind


@dataclass(frozen=True, slots=True)
class _Sink:
    kind: CallKind
    calls: list[Call]


@dataclass(frozen=True, slots=True)
class _Pending:
    sink: _Sink
    model: str
    provider: str | None
    started: datetime
    hosted_tools: bool


_SINK: contextvars.ContextVar[_Sink | None] = contextvars.ContextVar(
    "langchain_chess_calls", default=None
)


def call_from_message(
    kind: CallKind, model: str, provider: str | None, message: AIMessage, at: datetime
) -> Call:
    return make_call(kind, model, tokens_from_usage(message.usage_metadata), at, provider)


def _hosted_tools(kwargs: dict[str, Any]) -> bool:
    """Whether the request carries tools: a chess agent binds none, so `model_kwargs` did."""
    params = kwargs.get("invocation_params") or {}
    extra_body = params.get("extra_body") or {}
    return bool(params.get("tools") or (isinstance(extra_body, dict) and extra_body.get("tools")))


class CallRecorder(BaseCallbackHandler):
    """Attached with `graph.with_config(callbacks=[recorder])`; records only inside a sink."""

    run_inline = True

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._pending: dict[UUID, _Pending] = {}

    @contextlib.contextmanager
    def sink(self, kind: CallKind = "llm") -> Iterator[list[Call]]:
        sink = _Sink(kind=kind, calls=[])
        token = _SINK.set(sink)
        try:
            yield sink.calls
        finally:
            _SINK.reset(token)

    def on_chat_model_start(
        self,
        serialized: dict[str, Any],
        messages: list[list[Any]],
        *,
        run_id: UUID,
        metadata: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> None:
        sink = _SINK.get()
        if sink is None:
            return
        metadata = metadata or {}
        model = str(metadata.get("ls_model_name") or (serialized or {}).get("name") or "unknown")
        provider = metadata.get("ls_provider")
        pending = _Pending(sink, model, provider, datetime.now(UTC), _hosted_tools(kwargs))
        with self._lock:
            self._pending[run_id] = pending

    def on_llm_end(self, response: LLMResult, *, run_id: UUID, **kwargs: Any) -> None:
        with self._lock:
            pending = self._pending.pop(run_id, None)
        if pending is None:
            return
        generation = response.generations[0][0] if response.generations else None
        if isinstance(generation, ChatGeneration) and isinstance(generation.message, AIMessage):
            call = call_from_message(
                pending.sink.kind,
                pending.model,
                pending.provider,
                generation.message,
                pending.started,
            )
            # Token prices don't cover a hosted tool's own charges.
            if pending.hosted_tools:
                call = Call(**{**call, "cost_complete": False})
            pending.sink.calls.append(call)

    def on_llm_error(self, error: BaseException, *, run_id: UUID, **kwargs: Any) -> None:
        with self._lock:
            self._pending.pop(run_id, None)

    @property
    def pending(self) -> int:
        """Responses still in flight; zero between runs."""
        with self._lock:
            return len(self._pending)
