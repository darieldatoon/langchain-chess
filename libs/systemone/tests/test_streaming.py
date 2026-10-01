"""System 1's result reaches a streaming client before the LLM answers, streamed as Agent Server
streams a run."""

import asyncio

import pytest
from langgraph.checkpoint.memory import InMemorySaver
from pydantic import PrivateAttr

from langchain_chess import create_chess_agent
from langchain_chess.testing import ScriptedModel, position
from langchain_chess_systemone import SystemOneMiddleware
from langchain_chess_systemone.testing import FakeRanker, distribution

SPLIT = distribution({"e2e4": 0.60, "d2d4": 0.25, "g1f3": 0.15}, latency_ms=400.0)


class GatedModel(ScriptedModel):
    """Answers only once the test opens the gate."""

    _gate: asyncio.Event = PrivateAttr(default_factory=asyncio.Event)
    _entered: bool = PrivateAttr(default=False)

    @property
    def entered(self) -> bool:
        return self._entered

    def open(self) -> None:
        self._gate.set()

    async def _agenerate(self, messages, stop=None, run_manager=None, **kwargs):
        self._entered = True
        await self._gate.wait()
        return await super()._agenerate(messages, stop, run_manager, **kwargs)


async def stream(
    events: list[dict], graph, payload, config, model: GatedModel, entered: list[bool]
) -> None:
    """Collects the values events, opening the model's gate at the first live System 1 payload
    and noting whether the model call had started by then."""
    async for values in graph.astream(
        payload, config, stream_mode="values", output_keys=graph.output_channels
    ):
        events.append(values)
        turns = values.get("turns") or []
        live = values.get("systemone_live")
        if live and turns and live["turn_id"] == turns[-1]["id"] and not entered:
            entered.append(model.entered)
            model.open()


async def test_system_ones_result_streams_before_the_model_answers():
    model = GatedModel(script=[RuntimeError("down"), "MOVE: d4"])
    ranker = FakeRanker([SPLIT])
    graph = create_chess_agent(
        model,
        middleware=[SystemOneMiddleware("fake", ranker=ranker)],
        checkpointer=InMemorySaver(),
    )
    config = {"configurable": {"thread_id": "streaming"}}

    # Only a payload streamed before the model call opens the gate; without one, this times out.
    events: list[dict] = []
    entered: list[bool] = []
    with pytest.raises(RuntimeError, match="down"):
        await asyncio.wait_for(
            stream(events, graph, position(), config, model, entered), timeout=10
        )
    assert entered == [False]
    live = next(e["systemone_live"] for e in events if e.get("systemone_live"))
    assert live["status"] == "shortlist"
    assert live["latency_ms"] == 400.0
    assert events[-1]["turns"][-1]["status"] == "pending"

    # A reload reads it from the checkpoint.
    assert (await graph.aget_state(config)).values["systemone_live"] == live

    # A retry reuses the frozen decision: no new ranking, the same payload.
    out = await graph.ainvoke({}, config)
    assert out["moves"] == ["d2d4"]
    assert out["systemone_live"] == live
    assert len(ranker.requests) == 1
