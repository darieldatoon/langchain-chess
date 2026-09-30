import json
from dataclasses import dataclass, field

import pytest

from langchain_chess.efforts import (
    EFFORTS,
    PROBE_TOKENS,
    SNAPSHOT,
    MixedEffortsError,
    main,
    probe,
    refresh,
    takes_effort,
)
from langchain_chess.errors import rejects_effort


class ProviderError(Exception):
    def __init__(self, status_code: int, message: str, param: str | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.param = param


REJECTED = ProviderError(400, "This model does not support the effort parameter.")


@dataclass
class Provider:
    """Builds models that answer, or raise what `errors` gives for their spec and effort."""

    errors: dict[tuple[str, str], Exception] = field(default_factory=dict)
    built: list[tuple[str, str, int]] = field(default_factory=list)

    def __call__(self, model: str, *, reasoning_effort: str, max_tokens: int) -> "Reply":
        self.built.append((model, reasoning_effort, max_tokens))
        return Reply(self.errors.get((model, reasoning_effort)))


@dataclass
class Reply:
    error: Exception | None

    def invoke(self, _prompt: str) -> str:
        if self.error is not None:
            raise self.error
        return "OK"


def rejecting(model: str, *efforts: str) -> dict[tuple[str, str], Exception]:
    return {(model, effort): REJECTED for effort in efforts or EFFORTS}


@pytest.mark.parametrize(
    ("error", "rejects"),
    [
        (REJECTED, True),
        (ProviderError(400, "Unsupported parameter: 'reasoning.effort'"), True),
        (ProviderError(400, "Unsupported parameter: 'reasoning.effort'", "reasoning.effort"), True),
        # Named parameters that aren't the effort, whatever the message echoes.
        (ProviderError(400, "Unsupported parameter: 'reasoning'", param="reasoning"), False),
        (ProviderError(400, "Invalid value: 'effort'", param="reasoning.summary"), False),
        (ProviderError(400, "prompt is too long"), False),
        # A server error mentioning the effort says nothing about the model.
        (ProviderError(500, "effort handler crashed"), False),
        (ValueError("400: effort"), False),
    ],
)
def test_rejects_effort_needs_a_400_about_the_effort(error, rejects):
    assert rejects_effort(error) is rejects


def test_a_probe_asks_at_every_offered_effort():
    provider = Provider()
    assert probe("m", provider) is True
    assert provider.built == [("m", effort, PROBE_TOKENS) for effort in EFFORTS]


def test_a_model_that_rejects_every_effort_takes_none():
    assert probe("m", Provider(rejecting("m"))) is False


def test_a_model_that_takes_only_some_efforts_fails_the_probe():
    with pytest.raises(MixedEffortsError, match="m takes only some"):
        probe("m", Provider(rejecting("m", "high")))


def test_any_other_failure_fails_the_probe():
    with pytest.raises(ProviderError, match="down"):
        probe("m", Provider({("m", "low"): ProviderError(503, "down")}))


def test_refresh_probes_the_recorded_specs_and_the_added_ones(tmp_path):
    target = tmp_path / "efforts.json"
    target.write_text(json.dumps({"b": True}))
    assert refresh(["a"], target, Provider(rejecting("a"))) == {"a": False, "b": True}
    assert list(json.loads(target.read_text())) == ["a", "b"]


def test_refresh_starts_a_snapshot(tmp_path):
    target = tmp_path / "efforts.json"
    assert refresh(["a"], target, Provider()) == {"a": True}


def test_a_failed_probe_leaves_the_snapshot_as_it_was(tmp_path):
    target = tmp_path / "efforts.json"
    target.write_text("{}")
    with pytest.raises(ProviderError):
        refresh(["a", "b"], target, Provider({("b", "low"): ProviderError(503, "down")}))
    assert target.read_text() == "{}"


def test_main_reports_each_spec(tmp_path, capsys):
    main(["a", "b"], tmp_path / "efforts.json", Provider(rejecting("b")))
    assert capsys.readouterr().out.splitlines() == [
        "a: takes reasoning effort",
        "b: takes no reasoning effort",
    ]


def test_the_committed_snapshot_records_a_probe_per_spec():
    recorded = json.loads(SNAPSHOT.read_text())
    assert recorded["langsmith:anthropic/claude-haiku-4-5-20251001"] is False
    assert all(isinstance(takes, bool) for takes in recorded.values())


@pytest.mark.parametrize(
    ("spec", "takes"),
    [
        ("langsmith:anthropic/claude-haiku-4-5-20251001", False),
        ("langsmith:baseten/zai-org/GLM-5.3-Flash", True),
        # The route decides, and this one wasn't probed.
        ("anthropic:claude-haiku-4-5-20251001", True),
        ("langsmith:fireworks/accounts/fireworks/models/nope", True),
    ],
)
def test_takes_effort_reads_the_snapshot(spec, takes):
    assert takes_effort(spec) is takes
