from dataclasses import dataclass

import pytest
from pydantic import ValidationError

from langchain_chess_server.context import resolve_context
from langchain_chess_systemone.settings import ChessContext, SettingsError


@dataclass
class Execution:
    context: object


@dataclass
class Runtime:
    execution_runtime: Execution | None


def runtime(**values):
    return Runtime(Execution(values))


def test_defaults():
    assert resolve_context() == ChessContext()


def test_assistant_settings_then_run_overrides():
    assistant = runtime(version=1, threshold=0.5, k=3, top_p=0.8, unknown="dropped")
    context = resolve_context({"configurable": {"version": 1, "k": 7}}, assistant)
    assert (context.threshold, context.k, context.top_p) == (0.5, 7, 0.8)


def test_an_explicit_null_resets_a_setting_and_omission_keeps_it():
    assistant = runtime(top_p=0.8, tournament_threshold=0.3, threshold=0.5)
    config = {"configurable": {"top_p": None, "threshold": None, "thread_id": "t"}}
    context = resolve_context(config, assistant)
    assert context.top_p is None
    assert context.tournament_threshold == 0.3
    assert context.threshold == 0.9


def test_a_source_without_a_version_is_read_as_the_current_one():
    # Studio saves an assistant without one, with keys every version since has.
    context = resolve_context({"configurable": {"move_list": "legal"}}, runtime(move_list="none"))
    assert context.move_list == "legal"
    studio = runtime(version=None, move_list="none", system_prompt="Play fast.", show_fen=False)
    context = resolve_context(None, studio)
    assert (context.move_list, context.system_prompt, context.show_fen) == (
        "none",
        "Play fast.",
        False,
    )


def test_model_and_dict_assistant_contexts_and_non_execution_runtimes():
    assert resolve_context(None, Runtime(Execution(ChessContext(k=2)))).k == 2
    assert resolve_context(None, Runtime(None)).k == 5


def test_bad_values_fail_validation():
    with pytest.raises(ValidationError):
        resolve_context({"configurable": {"policy": "jev"}})
    with pytest.raises(ValidationError):
        resolve_context({"configurable": {"version": 1, "memory": "summarize", "k": "3"}})


def test_a_newer_version_is_rejected():
    with pytest.raises(SettingsError, match="newer than this reader"):
        resolve_context({"configurable": {"version": 99}})


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
        ("seed", 2**53, 2**53 - 1),
        ("seed", -(2**53), -(2**53 - 1)),
    ],
)
def test_numeric_knobs_are_bounded(knob, bad, edge):
    with pytest.raises(ValidationError, match=knob):
        resolve_context({"configurable": {knob: bad}})
    assert getattr(resolve_context({"configurable": {knob: edge}}), knob) == edge
