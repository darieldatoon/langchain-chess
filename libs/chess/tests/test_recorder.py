import uuid

import pytest
from langchain_core.messages import AIMessage
from langchain_core.outputs import ChatGeneration, Generation, LLMResult

from langchain_chess import create_chess_agent
from langchain_chess.recorder import CallRecorder
from langchain_chess.testing import ScriptedModel, position, usage


def _start(recorder, run_id, **metadata):
    recorder.on_chat_model_start({}, [[]], run_id=run_id, metadata=metadata)


def test_calls_outside_a_sink_are_ignored():
    recorder = CallRecorder()
    run_id = uuid.uuid4()
    _start(recorder, run_id, ls_model_name="claude-opus-5")
    assert recorder.pending == 0
    recorder.on_llm_end(LLMResult(generations=[]), run_id=run_id)


def test_sink_records_chat_generations_only():
    recorder = CallRecorder()
    with recorder.sink("summary") as calls:
        ok, text_only, failed = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        _start(recorder, ok, ls_model_name="anthropic/claude-opus-5", ls_provider="openai")
        _start(recorder, text_only)
        _start(recorder, failed)
        recorder.on_llm_end(
            LLMResult(generations=[[ChatGeneration(message=AIMessage("hi"))]]), run_id=ok
        )
        recorder.on_llm_end(LLMResult(generations=[[Generation(text="hi")]]), run_id=text_only)
        recorder.on_llm_error(RuntimeError(), run_id=failed)
    assert [(c["kind"], c["model"]) for c in calls] == [("summary", "anthropic:claude-opus-5")]
    assert recorder.pending == 0


def test_forced_move_can_be_turned_off():
    model = ScriptedModel(script=["MOVE: d4"])
    agent = create_chess_agent(model, forced_move=False)
    out = agent.invoke(position(restrict=["d2d4"]))
    assert out["plies"][0]["source"] == "llm"


def test_scripted_model_runs_out():
    with pytest.raises(AssertionError, match="script exhausted"):
        ScriptedModel(script=[]).invoke("hi")


def test_a_call_with_hosted_tools_has_an_incomplete_cost():
    recorder = CallRecorder()
    run = uuid.uuid4()
    with recorder.sink("llm") as calls:
        recorder.on_chat_model_start(
            {},
            [[]],
            run_id=run,
            metadata={"ls_model_name": "claude-opus-5", "ls_provider": "anthropic"},
            invocation_params={"extra_body": {"tools": [{"type": "web_search"}]}},
        )
        recorder.on_llm_end(
            LLMResult(
                generations=[[ChatGeneration(message=AIMessage("x", usage_metadata=usage()))]]
            ),
            run_id=run,
        )
    assert calls[0]["cost_usd"] is not None
    assert calls[0]["cost_complete"] is False
