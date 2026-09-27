import json

import httpx
import pytest

from langchain_chess.chat_models import chat_model
from langchain_chess.model_arguments import (
    ModelArgumentsError,
    held_back,
    model_arguments,
    problems,
)

GLM = "langsmith:baseten/zai-org/GLM-5.3-Flash"


@pytest.fixture
def gateway(monkeypatch):
    monkeypatch.setenv("LANGSMITH_GATEWAY", "true")
    monkeypatch.setenv("LANGSMITH_GATEWAY_API_KEY", "lsv2_test")


def final_body(model_kwargs, reasoning_effort=None, *, surface="local"):
    """The JSON the gateway receives, captured at the HTTP transport."""
    bodies = []

    def answer(request: httpx.Request) -> httpx.Response:
        bodies.append(json.loads(request.content))
        return httpx.Response(400, json={"error": {"message": "captured"}})

    arguments = model_arguments(model_kwargs, reasoning_effort=reasoning_effort, surface=surface)
    client = httpx.Client(transport=httpx.MockTransport(answer))
    model = chat_model(GLM, arguments, connection={"http_client": client, "max_retries": 0})
    with pytest.raises(Exception, match="captured"):
        model.invoke("hi")
    (body,) = bodies
    body.pop("input")
    return body


def test_model_kwargs_beat_the_settings_and_the_app(gateway):
    body = final_body({"temperature": 0.2, "max_tokens": 900, "reasoning_effort": "high"}, "low")
    assert body["temperature"] == 0.2
    assert body["max_output_tokens"] == 900
    assert body["reasoning"] == {"effort": "high"}


@pytest.mark.parametrize("name", ["max_tokens", "max_output_tokens", "max_completion_tokens"])
def test_every_output_limit_name_is_one_limit(gateway, name):
    # Passed through, `max_output_tokens` would lose to the app's `max_tokens`.
    assert final_body({name: 700})["max_output_tokens"] == 700


def test_the_effort_joins_a_reasoning_object(gateway):
    body = final_body({"reasoning": {"summary": "auto"}}, "low")
    assert body["reasoning"] == {"summary": "auto", "effort": "low"}
    both = final_body({"reasoning": {"effort": "high"}, "reasoning_effort": "high"})
    assert both["reasoning"] == {"effort": "high"}
    assert final_body({"reasoning": {"summary": "auto"}})["reasoning"] == {"summary": "auto"}


def test_extra_body_reasoning_replaces_the_whole_object(gateway):
    kwargs = {"reasoning_effort": "high", "extra_body": {"reasoning": {"summary": "auto"}}}
    assert final_body(kwargs)["reasoning"] == {"summary": "auto"}
    assert model_arguments(kwargs).reasoning_effort is None
    replaced = {"extra_body": {"reasoning": {"effort": "low"}}}
    assert model_arguments(replaced, reasoning_effort="high").reasoning_effort == "low"
    assert model_arguments({"extra_body": {"reasoning": "x"}}).reasoning_effort is None


def test_the_server_sends_only_what_reaches_the_request(gateway):
    allowed = {
        "temperature": 0.1,
        "top_p": 0.9,
        "verbosity": "low",
        "extra_body": {"prompt_cache_key": "game"},
    }
    body = final_body(allowed, surface="server")
    assert (body["temperature"], body["top_p"], body["text"], body["prompt_cache_key"]) == (
        0.1,
        0.9,
        {"verbosity": "low"},
        "game",
    )


def test_nulls_leave_a_value_to_the_next_source():
    arguments = model_arguments(
        {"reasoning_effort": None, "max_tokens": None}, reasoning_effort="low"
    )
    assert (arguments.reasoning_effort, arguments.max_tokens) == ("low", None)
    assert arguments.kwargs == {"reasoning_effort": "low"}
    assert model_arguments(None).kwargs == {}


@pytest.mark.parametrize(
    ("kwargs", "why"),
    [
        ({"base_url": "https://evil"}, "credentials and connections"),
        ({"openai_api_base": "https://evil"}, "credentials and connections"),
        ({"api_key": "x"}, "credentials and connections"),
        ({"default_headers": {}}, "credentials and connections"),
        ({"http_client": None, "model": "x"}, "the model is the `model` setting"),
        ({"model_name": "x"}, "the model is the `model` setting"),
        ({"extra_body": {"model": "x"}}, "`extra_body.model`"),
        ({"extra_body": {"input": []}}, "the agent sends it"),
        ({"streaming": False}, "the agent sends it"),
        ({"extra_body": {"stream": False}}, "the agent sends it"),
        ({"max_tokens": 1, "max_output_tokens": 2}, "disagree"),
        ({"reasoning": {"effort": "low"}, "reasoning_effort": "high"}, "disagree"),
        ({"max_tokens": 0}, "positive integer"),
        ({"max_tokens": True}, "positive integer"),
        ({"extra_body": "x"}, "`extra_body` must be an object"),
        ({"reasoning": "low"}, "`reasoning` must be an object"),
        ({"model_kwargs": {"instructions": "x"}}, "the app sets it"),
        ({"model_provider": "openai"}, "the app sets it"),
        ({"name": "x"}, "the app sets it"),
        ({"profile": {}}, "the app sets it"),
        ({"extra_body": {"api_key": "k"}}, "`extra_body.api_key`: credentials"),
        ({"extra_body": {"api_base": "https://evil"}}, "`extra_body.api_base`: credentials"),
        ({"max_tokens": 1, "max_output_tokens": True}, "disagree"),
        ({"reasoning_effort": ""}, "non-empty string"),
        ({"reasoning": {"effort": 3}}, "non-empty string"),
    ],
)
def test_held_back_everywhere(kwargs, why):
    with pytest.raises(ModelArgumentsError, match=why):
        model_arguments(kwargs)


@pytest.mark.parametrize(
    "kwargs",
    [
        {"tools": [{"type": "web_search"}]},
        {"extra_body": {"tool_choice": "auto"}},
        {"extra_body": {"previous_response_id": "resp_1"}},
        {"seed": 1},
        {"stop": ["x"]},
        {"service_tier": "flex"},
    ],
)
def test_held_back_on_the_server_only(kwargs):
    with pytest.raises(ModelArgumentsError):
        model_arguments(kwargs, surface="server")
    assert problems(kwargs, surface="local") == []


def test_a_whole_number_float_is_an_output_limit():
    assert model_arguments({"max_tokens": 700.0}).max_tokens == 700
    with pytest.raises(ModelArgumentsError, match="positive integer"):
        model_arguments({"max_tokens": 7.5})


def test_output_limits_are_exempt_from_the_connection_pattern():
    assert held_back("max_completion_tokens", surface="server") is None
    assert held_back("access_token", surface="local") is not None


def test_the_input_limit_leaves_room_for_the_resolved_output_limit(gateway):
    model = chat_model(GLM, model_arguments({"max_tokens": 100_000}))
    assert model.max_tokens == 100_000
    assert model.profile == {"max_input_tokens": 1_048_000 - 100_000}


def test_an_output_limit_must_leave_room_for_input(gateway, monkeypatch):
    with pytest.raises(ModelArgumentsError, match="leaves no room"):
        chat_model(GLM, model_arguments({"max_tokens": 1_048_000}))
    monkeypatch.delenv("LANGSMITH_GATEWAY")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    with pytest.raises(ModelArgumentsError, match="leaves no room"):
        chat_model("gpt-4", model_arguments({"max_tokens": 9000}))
