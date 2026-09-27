import pytest
from pydantic import ValidationError

from langchain_chess_cli.options import overlay, run_config
from langchain_chess_systemone.settings import ChessContext


def test_overlay_applies_only_the_flags_given():
    base = ChessContext(k=3, memory=True)
    settings = overlay(base, {"k": None, "memory": False, "move_list": "none"})
    assert (settings.k, settings.memory, settings.move_list) == (3, False, "none")
    with pytest.raises(ValidationError):
        overlay(base, {"model": ""})


def test_run_config_names_the_trace_by_surface_and_records_every_setting():
    config = run_config("tui", "t-1", ChessContext(policy="llm", k=7))
    assert config["configurable"] == {"thread_id": "t-1"}
    assert config["run_name"] == "chess-tui"
    assert config["tags"] == ["tui"]
    metadata = config["metadata"]
    assert metadata["surface"] == "tui"
    assert metadata["draw_claims"] == "auto"
    assert {k: metadata[k] for k in ("version", "policy", "model", "k", "seed")} == {
        "version": 2,
        "policy": "llm",
        "model": "langsmith:baseten/zai-org/GLM-5.3-Flash",
        "k": 7,
        "seed": 0,
    }


def test_run_metadata_records_the_values_sent():
    settings = ChessContext(reasoning_effort="low", model_kwargs={"reasoning_effort": "high"})
    metadata = run_config("uci", "t", settings)["metadata"]
    assert metadata["reasoning_effort"] == "high"
    assert metadata["model_kwargs"] == {"reasoning_effort": "high"}
