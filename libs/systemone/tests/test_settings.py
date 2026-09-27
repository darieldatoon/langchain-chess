import json
from pathlib import Path

import pytest
from pydantic import TypeAdapter

from langchain_chess_systemone.settings import (
    DEFAULTS,
    LEGACY_KEYS,
    VERSION,
    ChessContext,
    ChessContextInput,
    SettingsError,
    dump,
    from_legacy,
    keys,
    load,
    load_recorded,
    migrate,
    resolve,
)

CASES = json.loads((Path(__file__).parent / "fixtures" / "settings-cases.json").read_text())


def expected(output):
    return {**DEFAULTS[VERSION], **output}


@pytest.mark.parametrize("case", CASES["files"], ids=[c["name"] for c in CASES["files"]])
def test_settings_files(case):
    if case.get("error"):
        with pytest.raises(ValueError):  # noqa: PT011 - SettingsError or ValidationError
            load(case["input"])
    else:
        assert dump(load(case["input"])) == expected(case["output"])


@pytest.mark.parametrize("case", CASES["recorded"], ids=[c["name"] for c in CASES["recorded"]])
def test_recorded_settings(case):
    if case.get("error"):
        with pytest.raises(ValueError):  # noqa: PT011
            load_recorded(case["input"])
    else:
        assert dump(load_recorded(case["input"])) == expected(case["output"])


VALUES = [
    (key, value, valid)
    for key, values in CASES["values"].items()
    for valid in (True, False)
    for value in values["valid" if valid else "invalid"]
]


@pytest.mark.parametrize(("key", "value", "valid"), VALUES)
def test_every_setting_accepts_and_rejects_the_same_values_as_the_web_app(key, value, valid):
    recorded = {**DEFAULTS[VERSION], key: value}
    if valid:
        assert dump(load_recorded(recorded))[key] == value
    else:
        with pytest.raises(ValueError):  # noqa: PT011
            load_recorded(recorded)


def test_the_cases_cover_every_setting():
    assert set(CASES["values"]) == keys(VERSION)


def test_the_current_version_is_frozen_as_the_models_defaults():
    assert dump(ChessContext()) == dict(DEFAULTS[VERSION])
    assert set(DEFAULTS) == set(range(1, VERSION + 1))
    assert set(ChessContext.model_fields) == set(DEFAULTS[VERSION])


def test_keys_of_each_version():
    assert keys(0) == LEGACY_KEYS
    assert "version" not in keys(VERSION)
    assert "move_list" in keys(1)


def test_migrate_keeps_only_the_keys_a_source_set():
    assert migrate({"memory": "summarize"}, legacy=True) == {"memory": True}
    assert migrate({"show_legal_moves": True, "k": 3}, legacy=True) == {
        "move_list": "both",
        "k": 3,
    }
    assert migrate({"version": 1, "k": 3, "thread_id": "t"}, unknown="drop") == {"k": 3}
    with pytest.raises(SettingsError, match="unknown settings for version 1: thread_id"):
        migrate({"version": 1, "thread_id": "t"})
    with pytest.raises(SettingsError, match="need a `version`"):
        migrate({"k": 3})


def test_the_legacy_conversion():
    assert from_legacy({"memory": "none", "show_legal_moves": None}) == {"memory": False}
    assert from_legacy({"memory": True}) == {"memory": True}
    with pytest.raises(SettingsError, match="not both"):
        from_legacy({"show_legal_moves": True, "move_list": "none"})
    with pytest.raises(SettingsError, match="true or false"):
        from_legacy({"show_legal_moves": "yes"})


def test_resolve_lets_later_sources_win_and_null_reset():
    settings = resolve({"k": 3, "top_p": 0.5, "threshold": 0.4}, {"k": 4, "top_p": None})
    assert (settings.k, settings.top_p, settings.threshold) == (4, None, 0.4)
    assert resolve({"threshold": 0.4}, {"threshold": None}).threshold == 0.9


def test_settings_are_immutable():
    with pytest.raises(ValueError):  # noqa: PT011
        ChessContext().k = 3


def test_the_lenient_input_type_documents_every_setting_for_studio():
    schema = TypeAdapter(ChessContextInput).json_schema()
    assert set(schema["properties"]) == set(ChessContext.model_fields)
    assert "required" not in schema
    k = schema["properties"]["k"]
    assert k["description"] == "The most candidates suggested to the LLM."
    assert k["langgraph_nodes"] == ["SystemOneMiddleware.before_model"]
