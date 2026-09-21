"""A scripted chat model standing in for ChatAnthropic / ChatOpenAI."""

from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any

from langchain_core.messages import AIMessage, BaseMessage


def reply(
    text: str, input_tokens: int = 100, output_tokens: int = 50, reasoning: int = 30
) -> AIMessage:
    return AIMessage(
        content=text,
        usage_metadata={
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "total_tokens": input_tokens + output_tokens,
            "output_token_details": {"reasoning": reasoning},
        },
    )


@dataclass
class FakeChatModel:
    """Returns scripted replies in order; repeats the last one when exhausted."""

    replies: list[AIMessage]
    calls: list[list[BaseMessage]] = field(default_factory=list)

    def _next(self, messages: Sequence[BaseMessage]) -> AIMessage:
        self.calls.append(list(messages))
        index = min(len(self.calls) - 1, len(self.replies) - 1)
        return self.replies[index]

    def invoke(self, input: Sequence[BaseMessage], config: Any = None) -> AIMessage:
        return self._next(input)

    async def ainvoke(self, input: Sequence[BaseMessage], config: Any = None) -> AIMessage:
        return self._next(input)
