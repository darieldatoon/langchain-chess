"""StallRetry: call the model again, inside the same turn, when its response stream stalls.

A stalled attempt records no call: its usage would arrive in the final chunk, which never came.
"""

from langchain.agents.middleware import ModelRetryMiddleware


def stall_errors() -> tuple[type[Exception], ...]:
    """What a stalled stream raises, per installed integration. Add one only for a stall: any
    other error must still fail the turn."""
    try:
        # Every `langsmith:` gateway model is a ChatOpenAI.
        from langchain_openai import StreamChunkTimeoutError
    except ImportError:
        return ()
    return (StreamChunkTimeoutError,)


class StallRetry(ModelRetryMiddleware):
    """Core-owned: last in the stack, so a retry repeats only the provider call."""

    def __init__(
        self, *, max_retries: int = 1, retry_on: tuple[type[Exception], ...] | None = None
    ) -> None:
        super().__init__(
            max_retries=max_retries,
            retry_on=stall_errors() if retry_on is None else retry_on,
            # Not "continue": that turns the last stall into the model's reply, where the
            # pending turn's Retry needs the error.
            on_failure="error",
            # The stall already waited out langchain-openai's 120 s chunk timeout.
            initial_delay=0,
        )
