from dataclasses import replace

import pytest

from langchain_chess_cli.tui.setup import (
    CUSTOM,
    NONE,
    Sections,
    Unplayable,
    changed_knobs,
    effort_overridden,
    help_of,
    label_of,
    matchup_line,
    matchup_of,
    model_limit,
    model_of,
    opponent_label,
    resolve_side,
    sections_of,
    setup_of,
    with_knob,
)
from langchain_chess_systemone.settings import ChessContext

HAIKU = "langsmith:anthropic/claude-haiku-4-5-20251001"
"""A model the effort probe found to take none (libs/chess/langchain_chess/efforts.json)."""


def test_a_context_round_trips_through_the_pickers():
    for context in (
        ChessContext(),
        ChessContext(policy="llm", model="openai:gpt-6-mini"),
        ChessContext(policy="systemone", systemone_model="typesafe/jev-latest", k=3),
    ):
        assert matchup_of(setup_of(context, "white"), "yes") == context


def test_setup_of_names_the_pickers():
    hybrid = setup_of(ChessContext(), "random")
    assert (hybrid.side, hybrid.llm, hybrid.system_one_off) == (
        "random",
        ChessContext().model,
        False,
    )
    custom = setup_of(ChessContext(policy="llm", model="openai:gpt-6-mini"), "black")
    assert (custom.llm, custom.custom_model, custom.system_one_off) == (
        CUSTOM,
        "openai:gpt-6-mini",
        True,
    )
    assert setup_of(ChessContext(policy="systemone"), "white").llm == NONE
    assert "policy" not in hybrid.knobs
    assert "threshold" in hybrid.knobs


def test_model_of():
    setup = setup_of(ChessContext(), "white")
    assert model_of(setup) == ChessContext().model
    assert model_of(replace(setup, llm=NONE)) is None
    assert model_of(replace(setup, llm=CUSTOM, custom_model=" a:b ")) == "a:b"


def test_unplayable_setups_say_what_to_fix():
    setup = setup_of(ChessContext(), "white")
    neither = replace(setup, llm=NONE, system_one_off=True)
    assert matchup_of(neither, "yes") == Unplayable("Pick a System 1, an LLM, or both.")
    blank = replace(setup, llm=CUSTOM, custom_model="  ")
    assert matchup_of(blank, "yes") == Unplayable("Enter a model spec for the custom LLM.")
    bad = with_knob(setup, "threshold", 2.0)
    reason = matchup_of(bad, "yes")
    assert isinstance(reason, Unplayable)
    assert reason.reason.startswith("Advanced settings: threshold:")
    kwargs = with_knob(setup, "model_kwargs", {"model": "other"})
    assert isinstance(matchup_of(kwargs, "yes"), Unplayable)


def test_memory_waits_for_the_input_limit_and_is_off_without_one():
    setup = with_knob(setup_of(ChessContext(), "white"), "memory", True)
    assert matchup_of(setup, "checking") == Unplayable(
        "Checking whether GLM-5.3 Flash can summarize…"
    )
    played = matchup_of(setup, "no")
    assert isinstance(played, ChessContext)
    assert played.memory is False
    assert matchup_of(setup, "yes").memory is True
    # System 1 alone has no LLM to summarize with: nothing to wait for.
    alone = replace(setup, llm=NONE)
    assert isinstance(matchup_of(alone, "checking"), ChessContext)


def test_a_model_that_takes_no_effort_is_sent_none():
    setup = with_knob(
        replace(setup_of(ChessContext(), "white"), llm=HAIKU), "reasoning_effort", "high"
    )
    played = matchup_of(setup, "yes")
    assert isinstance(played, ChessContext)
    assert played.reasoning_effort is None
    forced = with_knob(setup, "model_kwargs", {"reasoning_effort": "low"})
    assert matchup_of(forced, "yes") == Unplayable(
        "Claude Haiku 4.5 doesn't take a reasoning effort; remove it from Model arguments."
    )


def test_effort_overridden_by_model_arguments():
    assert not effort_overridden({})
    assert effort_overridden({"reasoning_effort": "low"})
    assert effort_overridden({"reasoning": {"effort": "high"}})
    assert not effort_overridden({"reasoning": {"summary": "auto"}})
    assert effort_overridden({"extra_body": {"reasoning": {}}})


def test_the_matchup_and_opponent_in_words():
    hybrid = ChessContext(reasoning_effort="medium")
    assert matchup_line(hybrid) == "Jev plays confident moves; GLM-5.3 Flash decides the rest."
    assert opponent_label(hybrid) == "Jev + GLM-5.3 Flash · medium"
    alone = ChessContext(policy="systemone", systemone_model="other/ranker")
    assert matchup_line(alone) == "other/ranker plays every move."
    assert opponent_label(alone) == "other/ranker"
    llm = ChessContext(policy="llm", model="openai:gpt-6-mini")
    assert matchup_line(llm) == "openai:gpt-6-mini plays every move."
    assert opponent_label(llm) == "openai:gpt-6-mini"


def test_sections_follow_the_opponent():
    setup = setup_of(ChessContext(), "white")
    assert sections_of(setup) == Sections(llm=True, systemone=True, gate=True)
    assert sections_of(replace(setup, llm=NONE)) == Sections(llm=False, systemone=True, gate=False)
    assert sections_of(replace(setup, system_one_off=True)) == Sections(
        llm=True, systemone=False, gate=False
    )


def test_changed_knobs_only_name_what_the_policy_uses():
    context = ChessContext(
        threshold=0.5, show_fen=False, system_prompt="Be bold.", model_kwargs={"top_k": 3}, seed=7
    )
    assert changed_knobs(context) == [
        "custom system prompt",
        "show fen off",
        'model kwargs {"top_k":3}',
        "threshold 0.5",
        "seed 7",
    ]
    # Without the LLM, its knobs and the gate don't apply.
    assert changed_knobs(context.model_copy(update={"policy": "systemone"})) == ["seed 7"]
    assert changed_knobs(ChessContext()) == []


@pytest.mark.parametrize(("coin", "side"), [(0.2, "white"), (0.7, "black")])
def test_random_is_resolved_once(coin, side):
    assert resolve_side("random", lambda: coin) == side
    assert resolve_side("black", lambda: coin) == "black"


def test_labels_and_help_come_from_the_settings():
    assert label_of("threshold") == "Bar to play alone"
    assert help_of("threshold").startswith("How confident System 1 must be")


def test_model_limit(monkeypatch):
    import langchain_chess_cli.tui.setup as setup

    monkeypatch.setattr(setup, "default_model", lambda context: object())
    monkeypatch.setattr(setup, "input_limit", lambda model: 1000)
    assert model_limit("a:b") == 1000

    def unbuildable(context):
        raise ImportError("no provider package")

    monkeypatch.setattr(setup, "default_model", unbuildable)
    assert model_limit("a:b") is None
