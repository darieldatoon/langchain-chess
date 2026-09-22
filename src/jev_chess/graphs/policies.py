"""Single-move policy graphs for Studio: a position in, a ranking or decision out.

Factories so the model, effort, k, and threshold come from the assistant configuration
instead of being baked in at import time. Each rebuild is a client object and a compile,
milliseconds against a model call.
"""

from typing import Any

from langchain_core.runnables import RunnableConfig
from langgraph.graph.state import CompiledStateGraph
from langgraph_sdk.runtime import ServerRuntime

from jev_chess.graphs.context import (
    HybridContext,
    JevKnobs,
    LLMKnobs,
    hybrid_config,
    jev_config,
    llm_config,
    resolve_context,
)
from jev_chess.policies import HybridPolicy, JevPolicy, LLMPolicy


def make_jev_graph(config: RunnableConfig, runtime: ServerRuntime[Any]) -> CompiledStateGraph[Any]:
    knobs = resolve_context(JevKnobs, config, runtime)
    return JevPolicy.from_settings(config=jev_config(knobs), context_schema=JevKnobs).graph


def make_llm_graph(config: RunnableConfig, runtime: ServerRuntime[Any]) -> CompiledStateGraph[Any]:
    knobs = resolve_context(LLMKnobs, config, runtime)
    return LLMPolicy.from_settings(config=llm_config(knobs), context_schema=LLMKnobs).graph


def make_hybrid_graph(
    config: RunnableConfig, runtime: ServerRuntime[Any]
) -> CompiledStateGraph[Any]:
    context = resolve_context(HybridContext, config, runtime)
    return HybridPolicy.from_settings(
        config=hybrid_config(context), context_schema=HybridContext
    ).graph
