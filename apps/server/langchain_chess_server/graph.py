"""The `chess` graph factory (placeholder until the core lands)."""

from dataclasses import dataclass, field
from typing import Any

from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph


@dataclass
class _State:
    messages: list[Any] = field(default_factory=list)


def make_graph(config: RunnableConfig | None = None, runtime: Any = None) -> CompiledStateGraph:
    graph = StateGraph(_State)
    graph.add_node("noop", lambda state: {})
    graph.add_edge(START, "noop")
    graph.add_edge("noop", END)
    return graph.compile(name="chess")
