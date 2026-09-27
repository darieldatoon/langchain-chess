import pytest

from langchain_chess.chat_models import MAX_TOKENS, chat_model, output_budget
from langchain_chess.model_arguments import model_arguments


@pytest.fixture
def gateway(monkeypatch):
    monkeypatch.setenv("LANGSMITH_GATEWAY", "true")
    monkeypatch.setenv("LANGSMITH_GATEWAY_API_KEY", "lsv2_test")


def test_the_output_budget_leaves_a_small_window_half_its_input():
    assert output_budget(None) == MAX_TOKENS
    assert output_budget(1_000_000) == MAX_TOKENS
    assert output_budget(8192) == 4096
    assert output_budget(1_000_000, 4096) == 4096
    assert output_budget(8192, 16384) == 4096
    assert output_budget(None, 100_000) == MAX_TOKENS


@pytest.mark.parametrize(("spec", "ceiling"), [("openai:gpt-4-turbo", 4096), ("gpt-4o", 16384)])
def test_native_models_stay_within_their_output_limit(monkeypatch, spec, ceiling):
    monkeypatch.delenv("LANGSMITH_GATEWAY", raising=False)
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    model = chat_model(spec)
    assert model.max_tokens == ceiling
    assert model.profile["max_output_tokens"] == ceiling


def test_a_native_output_limit_above_the_cap_keeps_the_cap(monkeypatch):
    monkeypatch.delenv("LANGSMITH_GATEWAY", raising=False)
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    assert chat_model("openai:gpt-5.6-sol").max_tokens == MAX_TOKENS


def test_gateway_models_get_an_input_limit_that_fits_their_window(gateway):
    gpt4 = chat_model("langsmith:openai/gpt-4")
    assert gpt4.max_tokens == 4096
    assert gpt4.profile == {"max_input_tokens": 8192 - 4096}
    opus = chat_model(
        "langsmith:anthropic/claude-opus-5-5", model_arguments({}, reasoning_effort="low")
    )
    assert opus.profile == {"max_input_tokens": 1_000_000 - MAX_TOKENS}
    assert opus.reasoning_effort == "low"
    assert opus.get_name() == "claude-opus-5-5"
    assert chat_model("langsmith:fireworks/accounts/fireworks/models/nope").profile is None


def test_a_bare_name_gets_the_same_budget_as_its_qualified_spec(monkeypatch):
    monkeypatch.delenv("LANGSMITH_GATEWAY", raising=False)
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    assert chat_model("gpt-4").max_tokens == chat_model("openai:gpt-4").max_tokens == 4096


def test_a_native_input_limit_leaves_room_for_the_output_budget(monkeypatch):
    monkeypatch.delenv("LANGSMITH_GATEWAY", raising=False)
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    gpt4 = chat_model("openai:gpt-4")
    assert gpt4.max_tokens == 4096
    assert gpt4.profile["max_input_tokens"] == 8192 - 4096
    assert gpt4.profile["max_output_tokens"] == 8192


@pytest.mark.parametrize(
    ("spec", "ceiling"),
    [("langsmith:openai/gpt-4-turbo", 4096), ("langsmith:openai/gpt-4o", 16384)],
)
def test_gateway_models_stay_within_their_vendors_output_limit(gateway, spec, ceiling):
    model = chat_model(spec)
    assert model.max_tokens == ceiling
    assert model.profile == {"max_input_tokens": 128_000 - ceiling}


def test_a_gateway_model_without_an_installed_vendor_keeps_the_cap(gateway):
    assert chat_model("langsmith:baseten/zai-org/GLM-5.3-Flash").max_tokens == MAX_TOKENS


def test_an_unknown_native_model_keeps_the_cap_and_no_input_limit(monkeypatch):
    monkeypatch.delenv("LANGSMITH_GATEWAY", raising=False)
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    model = chat_model("openai:no-such-model")
    assert model.max_tokens == MAX_TOKENS
    assert "max_input_tokens" not in (model.profile or {})
