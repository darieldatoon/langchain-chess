"""The `chess` graph for the browser test: the server's own, with a fake model and System 1.

The fake model replies with the message it was shown, so the test can read what the agent read.
"""

import re
from typing import Any

import chess
from langchain_core.messages import BaseMessage
from langchain_core.runnables import RunnableConfig
from langgraph.graph.state import CompiledStateGraph
from langgraph_sdk.runtime import ServerRuntime

from langchain_chess.testing import ScriptedModel
from langchain_chess_server.context import resolve_context
from langchain_chess_server.graph import build_graph, shape
from langchain_chess_systemone.testing import FakeRanker, by_option_order, distribution


def _reply(messages: list[BaseMessage]) -> str:
    shown = str(messages[-1].content)
    fen = re.search(r"^FEN: (.+)$", shown, re.MULTILINE)
    assert fen is not None
    board = chess.Board(fen.group(1))
    move = board.san(next(iter(board.legal_moves)))
    return f"{shown}\n\nMOVE: {move}"


def _model(settings: Any) -> ScriptedModel:
    return ScriptedModel(script=[_reply] * 50)


def _ranker(settings: Any) -> FakeRanker:
    return FakeRanker(lambda request: distribution(by_option_order("", list(request.options))))


def make_graph(config: RunnableConfig, runtime: ServerRuntime) -> CompiledStateGraph:
    if runtime.execution_runtime is None:
        return shape()
    settings = resolve_context(config, runtime)
    return build_graph(settings, model_factory=_model, ranker_factory=_ranker)
