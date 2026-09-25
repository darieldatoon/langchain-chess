import itertools
from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from langgraph.checkpoint.memory import InMemorySaver

from langchain_chess import create_chess_agent

type Run = Callable[..., Awaitable[dict[str, Any]]]

_threads = itertools.count()


@pytest.fixture
def cfg() -> dict[str, Any]:
    return {"configurable": {"thread_id": f"t{next(_threads)}"}}


@pytest.fixture
def make_agent() -> Callable[..., Any]:
    def build(model: Any = None, **kwargs: Any) -> Any:
        kwargs.setdefault("checkpointer", InMemorySaver())
        return create_chess_agent(model, **kwargs)

    return build


@pytest.fixture(params=["sync", "async"])
def run(request: pytest.FixtureRequest) -> Run:
    """Invoke an agent the way the test's parameter says: `invoke` or `ainvoke`."""

    async def invoke(agent: Any, payload: Any, config: dict[str, Any]) -> dict[str, Any]:
        if request.param == "sync":
            return agent.invoke(payload, config)
        return await agent.ainvoke(payload, config)

    return invoke
