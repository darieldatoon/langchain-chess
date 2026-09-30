"""Errors raised by the chess agent."""

from collections.abc import Iterator
from contextlib import contextmanager


class ChessContractError(RuntimeError):
    """A middleware broke the extension contract, or the agent was misconfigured."""


class ContextBudgetError(RuntimeError):
    """The provider rejected a move request as too long for the model's context window."""


class ReasoningEffortError(RuntimeError):
    """The provider rejected the reasoning effort: the model takes none, or not this level."""


_OVERFLOW_HINTS = (
    "prompt is too long",
    "context length",
    "context_length",
    "maximum context",
    "too many tokens",
    "input is too long",
)

_EFFORT_PARAMS = ("reasoning.effort", "reasoning_effort")

EFFORT_ADVICE = "remove it from the settings and from model arguments"


def looks_like_overflow(error: BaseException) -> bool:
    text = str(error).lower()
    return any(hint in text for hint in _OVERFLOW_HINTS)


def rejects_effort(error: BaseException) -> bool:
    """A provider's 400 about the reasoning effort: the model takes none, or not this level."""
    if getattr(error, "status_code", None) != 400:
        return False
    # A named parameter outranks the message, which may only echo a value. Do not add
    # `reasoning`: a summary-only object is rejected under that name too.
    if (param := getattr(error, "param", None)) is not None:
        return param in _EFFORT_PARAMS
    return "effort" in str(error).lower()


@contextmanager
def provider_errors() -> Iterator[None]:
    """Raises a provider's rejection of the request as the error that says what to change."""
    try:
        yield
    except Exception as e:
        if looks_like_overflow(e):
            raise ContextBudgetError(str(e)) from e
        if rejects_effort(e):
            msg = f"the provider rejected the reasoning effort; {EFFORT_ADVICE}: {e}"
            raise ReasoningEffortError(msg) from e
        raise
