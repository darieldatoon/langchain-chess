from dataclasses import dataclass
from typing import Any, cast

import pytest

from jev_chess.graphs import (
    HybridContext,
    JevKnobs,
    LLMKnobs,
    make_hybrid_graph,
    make_jev_graph,
    make_llm_graph,
)
from jev_chess.graphs import policies as policies_module
from jev_chess.policies import HybridPolicy, JevPolicy, LLMPolicy
from tests.fake_jev import FakeClassifier
from tests.fake_llm import FakeChatModel, reply


@dataclass
class Runtime:
    execution_runtime: None = None


RUNTIME = cast("Any", Runtime())


def properties(graph: Any) -> dict[str, Any]:
    schema = graph.get_context_jsonschema()
    assert schema is not None
    return schema["properties"]


def test_factories_pass_knobs_and_context_schema(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: dict[str, Any] = {}

    def fake_jev(
        cls: Any, settings: Any = None, config: Any = None, context_schema: Any = None
    ) -> JevPolicy:
        seen["jev"] = (config, context_schema)
        return JevPolicy(FakeClassifier(), config, context_schema)

    def fake_llm(
        cls: Any, settings: Any = None, config: Any = None, context_schema: Any = None
    ) -> LLMPolicy:
        seen["llm"] = (config, context_schema)
        return LLMPolicy(FakeChatModel([reply("MOVE: e4")]), config, context_schema)

    def fake_hybrid(
        cls: Any, settings: Any = None, config: Any = None, context_schema: Any = None
    ) -> HybridPolicy:
        seen["hybrid"] = (config, context_schema)
        llm = LLMPolicy(FakeChatModel([reply("MOVE: e4")]))
        return HybridPolicy(JevPolicy(FakeClassifier()), llm, config, context_schema)

    monkeypatch.setattr(policies_module.JevPolicy, "from_settings", classmethod(fake_jev))
    monkeypatch.setattr(policies_module.LLMPolicy, "from_settings", classmethod(fake_llm))
    monkeypatch.setattr(policies_module.HybridPolicy, "from_settings", classmethod(fake_hybrid))

    jev = make_jev_graph({"configurable": {"style": "terse"}}, RUNTIME)
    assert seen["jev"][0].style == "terse"
    assert seen["jev"][1] is JevKnobs
    assert "style" in properties(jev)

    config: Any = {"configurable": {"model": "gpt-5.6-sol", "reasoning_effort": "low"}}
    llm = make_llm_graph(config, RUNTIME)
    assert seen["llm"][0].model == "langsmith:openai/gpt-5.6-sol"
    assert seen["llm"][0].reasoning_effort == "low"
    assert seen["llm"][1] is LLMKnobs
    assert properties(llm)["model"]["langgraph_nodes"] == ["call_llm"]

    hybrid = make_hybrid_graph({"configurable": {"threshold": 0.4, "k": 3}}, RUNTIME)
    cfg = seen["hybrid"][0]
    assert (cfg.threshold, cfg.k) == (0.4, 3)
    assert seen["hybrid"][1] is HybridContext
    assert set(properties(hybrid)) >= {"k", "threshold", "model", "style"}
