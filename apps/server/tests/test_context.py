from dataclasses import dataclass

import pytest
from pydantic import ValidationError

from langchain_chess_server.context import ChessContext, _admits_none, resolve_context


@dataclass
class Execution:
    context: object


@dataclass
class Runtime:
    execution_runtime: Execution | None


def runtime(**values):
    return Runtime(Execution(values))


def test_defaults():
    context = resolve_context(ChessContext)
    assert (context.policy, context.model, context.systemone_model) == (
        "hybrid",
        "langsmith:baseten/zai-org/GLM-5.3-Flash",
        "semif-qwen3.5-4b",
    )
    assert context.reasoning_effort is None
    assert context.draw_claims == "auto"
    assert context.tournament_threshold is None


def test_assistant_settings_then_run_overrides():
    assistant = runtime(threshold=0.5, k=3, top_p=0.8, unknown="dropped")
    context = resolve_context(ChessContext, {"configurable": {"k": 7}}, assistant)
    assert (context.threshold, context.k, context.top_p) == (0.5, 7, 0.8)


def test_explicit_none_clears_a_nullable_setting_and_omission_keeps_it():
    assistant = runtime(top_p=0.8, tournament_threshold=0.3)
    config = {"configurable": {"top_p": None, "threshold": None, "thread_id": "t"}}
    context = resolve_context(ChessContext, config, assistant)
    assert context.top_p is None
    assert context.tournament_threshold == 0.3
    assert context.threshold == 0.9  # not nullable: None is ignored


def test_dataclass_assistant_context_and_non_execution_runtimes():
    assert resolve_context(ChessContext, None, Runtime(Execution(ChessContext(k=2)))).k == 2
    assert resolve_context(ChessContext, None, Runtime(None)).k == 5


def test_bad_values_fail_validation():
    with pytest.raises(ValidationError):
        resolve_context(ChessContext, {"configurable": {"policy": "jev"}})


@pytest.mark.parametrize(
    ("knob", "bad", "edge"),
    [
        ("k", 0, 1),
        ("k", 256, 255),
        ("threshold", -0.1, 0.0),
        ("threshold", 1.1, 1.0),
        ("tournament_threshold", 2, 1.0),
        ("top_p", 0.0, 1.0),
        ("top_p", -1, 0.01),
    ],
)
def test_numeric_knobs_are_bounded(knob, bad, edge):
    with pytest.raises(ValidationError, match=knob):
        resolve_context(ChessContext, {"configurable": {knob: bad}})
    assert getattr(resolve_context(ChessContext, {"configurable": {knob: edge}}), knob) == edge


def test_admits_none():
    assert _admits_none(int | None)
    assert not _admits_none(int)
