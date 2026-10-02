import asyncio
import json
import threading

import chess
import pytest
from textual.app import App
from textual.widgets import (
    Button,
    Checkbox,
    Collapsible,
    Input,
    RadioButton,
    Select,
    Static,
    TextArea,
)

from langchain_chess_cli.tui.newgame import NewGame, NewGameScreen, start_problem
from langchain_chess_cli.tui.setup import CUSTOM, NONE, setup_of
from langchain_chess_systemone.settings import ChessContext

HAIKU = "langsmith:anthropic/claude-haiku-4-5-20251001"


class Host(App[None]):
    def __init__(self, context=None, start="", *, limit=lambda model: 1000):
        super().__init__()
        self.picked: list[NewGame | None] = []
        self.screen_args = (setup_of(context or ChessContext(), "white"), start)
        self.limit = limit

    def on_mount(self) -> None:
        setup, start = self.screen_args
        screen = NewGameScreen(setup, start, limit=self.limit)
        self.push_screen(screen, self.picked.append)


def text(screen, selector):
    return str(screen.query_one(selector, Static).render())


async def checked(pilot):
    """The input-limit check runs in a worker after waiting out typing."""
    await pilot.pause()
    await pilot.app.screen.workers.wait_for_complete()
    await pilot.pause()


async def opened(pilot):
    await checked(pilot)
    screen = pilot.app.screen
    screen.query_one("#advanced", Collapsible).collapsed = False
    await pilot.pause()
    return screen


async def test_play_returns_the_matchup():
    app = Host()
    async with app.run_test(size=(120, 60)) as pilot:
        screen = await opened(pilot)
        assert text(screen, "#matchup") == (
            "SemIf plays confident moves; GLM-5.3 Flash decides the rest."
        )
        screen.query_one("#side").query(RadioButton)[2].value = True
        await pilot.pause()
        screen.query_one("#play", Button).press()
        await pilot.pause()
    assert app.picked == [NewGame(ChessContext(), "black", chess.STARTING_FEN)]


def test_start_problem():
    assert start_problem("  ", "auto") is None
    assert start_problem("4k3/8/8/8/8/8/4P3/4K3 w - - 0 1", "auto") is None
    assert start_problem("nope", "auto").startswith("invalid FEN")
    assert (
        start_problem("7k/5QQ1/8/8/8/8/8/K7 b - - 0 1", "never") == "This position is already over."
    )
    # Fifty moves without a capture or a pawn move: over only while draws are claimed.
    fifty = "4k3/8/8/8/8/8/8/R3K3 w - - 100 60"
    assert start_problem(fifty, "auto") == "This position is already over."
    assert start_problem(fifty, "never") is None


async def test_a_bad_start_holds_play_and_a_good_one_is_normalized():
    app = Host()
    async with app.run_test(size=(120, 60)) as pilot:
        screen = await opened(pilot)
        start = screen.query_one("#start", Input)
        start.value = "nope"
        await pilot.pause()
        assert text(screen, "#matchup") == "Fix the starting position."
        assert text(screen, "#start-hint").startswith("invalid FEN")
        assert screen.query_one("#play", Button).disabled
        start.value = " 4k3/8/8/8/8/8/4P3/4K3 b - - 0 1 "
        await pilot.pause()
        screen.query_one("#play", Button).press()
        await pilot.pause()
    assert app.picked[0].start == "4k3/8/8/8/8/8/4P3/4K3 b - - 0 1"


async def test_the_pickers_and_the_sections_they_show():
    app = Host(ChessContext(systemone_model="other/ranker"))
    async with app.run_test(size=(120, 60)) as pilot:
        screen = await opened(pilot)
        system_one, llm = screen.query_one("#system-one", Select), screen.query_one("#llm", Select)
        assert system_one.value == "other"
        assert text(screen, "#matchup").startswith("other/ranker plays confident moves")
        system_one.value = NONE
        await pilot.pause()
        assert text(screen, "#matchup") == "GLM-5.3 Flash plays every move."
        assert not screen.query_one("#section-systemone").display
        llm.value = NONE
        await pilot.pause()
        assert text(screen, "#matchup") == "Pick a System 1, an LLM, or both."
        assert screen.query_one("#play", Button).disabled
        screen._play()  # held: nothing is picked
        system_one.value = "typesafe/jev-latest"
        await pilot.pause()
        assert text(screen, "#matchup") == "Jev plays every move."
        assert not screen.query_one("#section-llm").display
        assert not screen.query_one("#section-gate").display
        assert screen.query_one("#gate-note").display
        assert app.picked == []
        system_one.value = "other"
        llm.value = CUSTOM
        await pilot.pause()
        assert screen.focused is screen.query_one("#custom-model")
        assert text(screen, "#matchup") == "Enter a model spec for the custom LLM."
        await pilot.press(*"openai:gpt-6-mini")
        await checked(pilot)
        assert text(screen, "#matchup") == (
            "other/ranker plays confident moves; openai:gpt-6-mini decides the rest."
        )


async def test_advanced_knobs_reach_the_context():
    app = Host()
    async with app.run_test(size=(120, 60)) as pilot:
        screen = await opened(pilot)
        screen.query_one("#move_list", Select).value = json.dumps("legal")
        screen.query_one("#show_fen", Checkbox).value = False
        screen.query_one("#threshold", Input).value = "0.5"
        screen.query_one("#tournament_threshold", Input).value = "0.7"
        screen.query_one("#top_p", Input).value = ""
        screen.query_one("#k", Input).value = "3"
        screen.query_one("#seed", Input).value = "7"
        screen.query_one("#system_prompt", TextArea).text = "Be bold."
        screen.query_one("#model_kwargs", TextArea).text = '{"temperature": 0.2}'
        await pilot.pause()
        screen.query_one("#advanced", Collapsible).collapsed = True
        await pilot.pause()
        assert text(screen, "#advanced-summary") == (
            "White · SemIf + GLM-5.3 Flash · 8 settings changed"
        )
        screen.query_one("#play", Button).press()
        await pilot.pause()
    context = app.picked[0].context
    assert (context.move_list, context.show_fen, context.threshold) == ("legal", False, 0.5)
    assert (context.tournament_threshold, context.top_p, context.k, context.seed) == (
        0.7,
        None,
        3,
        7,
    )
    assert context.system_prompt == "Be bold."
    assert context.model_kwargs == {"temperature": 0.2}


@pytest.mark.parametrize(
    ("field", "value"),
    [("k", "1.5"), ("k", ""), ("threshold", "half"), ("seed", "x")],
)
async def test_a_number_that_isnt_one_holds_play(field, value):
    app = Host()
    async with app.run_test(size=(120, 60)) as pilot:
        screen = await opened(pilot)
        number = screen.query_one(f"#{field}", Input)
        number.value = value
        await pilot.pause()
        assert number.has_class("-invalid")
        assert text(screen, "#matchup") == "Fix the Advanced settings marked invalid."
        number.value = "1"
        await pilot.pause()
        assert not number.has_class("-invalid")
        assert not screen.query_one("#play", Button).disabled


async def test_out_of_range_and_bad_kwargs_say_why():
    app = Host()
    async with app.run_test(size=(120, 60)) as pilot:
        screen = await opened(pilot)
        threshold = screen.query_one("#threshold", Input)
        threshold.value = "2"
        await pilot.pause()
        assert threshold.has_class("-invalid")
        assert "less than or equal to 1" in str(threshold.tooltip)
        assert text(screen, "#matchup") == "Fix the Advanced settings marked invalid."
        threshold.value = "0.5"
        kwargs = screen.query_one("#model_kwargs", TextArea)
        for bad, why in (
            ("{not json", "Use a JSON object."),
            ("[1]", "Use a JSON object."),
            ('{"model": "other"}', "`model`: the model is the `model` setting"),
        ):
            kwargs.text = bad
            await pilot.pause()
            assert why in text(screen, "#model_kwargs-hint")
            assert text(screen, "#matchup") == "Fix the Advanced settings marked invalid."
        kwargs.text = ""
        await pilot.pause()
        assert text(screen, "#model_kwargs-hint") == ""
        assert not screen.query_one("#play", Button).disabled


async def test_a_hidden_field_holds_play_no_longer():
    app = Host()
    async with app.run_test(size=(120, 60)) as pilot:
        screen = await opened(pilot)
        screen.query_one("#k", Input).value = "0"  # a number, but not one k takes
        screen.query_one("#model_kwargs", TextArea).text = '{"model": "other"}'
        await pilot.pause()
        assert screen.query_one("#play", Button).disabled
        screen.query_one("#system-one", Select).value = NONE  # no gate: k is hidden
        screen.query_one("#llm", Select).value = "langsmith:baseten/zai-org/GLM-5.3"
        await pilot.pause()
        assert screen.query_one("#play", Button).disabled  # the LLM's kwargs still show
        screen.query_one("#system-one", Select).value = "semif-qwen3.5-4b"
        screen.query_one("#llm", Select).value = NONE
        await pilot.pause()
        assert not screen.query_one("#play", Button).disabled
        screen.query_one("#play", Button).press()
        await pilot.pause()
    context = app.picked[0].context
    assert (context.policy, context.k, context.model_kwargs) == ("systemone", 5, {})


async def test_the_draw_claims_decide_a_fifty_move_root():
    app = Host(start="4k3/8/8/8/8/8/8/R3K3 w - - 100 60")
    async with app.run_test(size=(120, 60)) as pilot:
        screen = await opened(pilot)
        assert text(screen, "#matchup") == "Fix the starting position."
        screen.query_one("#draw_claims", Select).value = json.dumps("never")
        await pilot.pause()
        assert not screen.query_one("#play", Button).disabled


async def test_memory_needs_an_input_limit():
    app = Host(ChessContext(memory=True), limit=lambda model: None)
    async with app.run_test(size=(120, 60)) as pilot:
        screen = await opened(pilot)
        memory = screen.query_one("#memory", Select)
        assert memory.disabled
        assert text(screen, "#memory-hint") == (
            "This model has no known input limit, so it can't summarize."
        )
        screen.query_one("#play", Button).press()
        await pilot.pause()
    assert app.picked[0].context.memory is False


async def test_memory_waits_for_the_check():
    answer = threading.Event()

    def limit(model):
        answer.wait()  # the check is slow: the screen waits for it
        return 1000

    app = Host(ChessContext(memory=True), limit=limit)
    try:
        async with app.run_test(size=(120, 60)) as pilot:
            await pilot.pause()
            screen = pilot.app.screen
            assert text(screen, "#matchup") == "Checking whether GLM-5.3 Flash can summarize…"
            assert screen.query_one("#play", Button).disabled
            answer.set()
            await screen.workers.wait_for_complete()
            await pilot.pause()
            assert not screen.query_one("#play", Button).disabled
            # A late answer for a model no longer picked is dropped.
            screen.checked = "other"
            await screen._limit("again")
    finally:
        answer.set()


@pytest.mark.parametrize("close", ["_play", "action_cancel"])
async def test_closing_cancels_a_check_still_out(close):
    asked, answer = threading.Event(), threading.Event()

    def limit(model):
        asked.set()
        answer.wait()
        return 1000

    app = Host(limit=limit)
    try:
        async with app.run_test(size=(120, 60)) as pilot:
            screen = pilot.app.screen
            await asyncio.to_thread(asked.wait)
            [check] = list(screen.workers)
            updates = []
            screen._update = lambda: updates.append(True)
            getattr(screen, close)()
            # Before the screen comes down: Textual removes its widgets before its workers.
            assert check.is_cancelled
            await pilot.pause()
            answer.set()  # the thread finishes after the screen is gone
            await pilot.pause(0.1)
            assert updates == []
            assert len(app.picked) == 1
    finally:
        answer.set()


async def test_effort_hints():
    app = Host(ChessContext(policy="llm", model=HAIKU))
    async with app.run_test(size=(120, 60)) as pilot:
        screen = await opened(pilot)
        assert screen.query_one("#reasoning_effort", Select).disabled
        assert (
            text(screen, "#reasoning_effort-hint") == "This model doesn't take a reasoning effort."
        )
        screen.query_one("#llm", Select).value = "langsmith:baseten/zai-org/GLM-5.3"
        screen.query_one("#model_kwargs", TextArea).text = '{"reasoning_effort": "low"}'
        await pilot.pause()
        assert text(screen, "#reasoning_effort-hint") == (
            "Model arguments set the effort, so this is ignored."
        )
        screen.query_one("#reasoning_effort", Select).value = json.dumps("high")
        await pilot.pause()
        screen.query_one("#play", Button).press()
        await pilot.pause()
    assert app.picked[0].context.reasoning_effort == "high"


async def test_a_held_select_shows_the_played_value_and_gives_the_pick_back():
    app = Host(ChessContext(reasoning_effort="high", memory=True), limit=lambda model: None)
    async with app.run_test(size=(120, 60)) as pilot:
        screen = await opened(pilot)
        effort, memory = (
            screen.query_one("#reasoning_effort", Select),
            screen.query_one("#memory", Select),
        )
        assert effort.value == json.dumps("high")
        assert memory.value == json.dumps(False)  # no input limit: memory plays off
        screen.query_one("#llm", Select).value = HAIKU
        await checked(pilot)
        assert effort.disabled
        assert effort.value == json.dumps(None)
        screen.query_one("#llm", Select).value = "langsmith:baseten/zai-org/GLM-5.3"
        await checked(pilot)
        assert not effort.disabled
        assert effort.value == json.dumps("high")
        assert screen.setup.knobs["memory"] is True


async def test_the_focused_fields_help_and_cancel():
    app = Host()
    async with app.run_test(size=(120, 60)) as pilot:
        screen = await opened(pilot)
        assert text(screen, "#help") == "The colour you play. Random picks one when you press Play."
        screen.query_one("#threshold", Input).focus()
        await pilot.pause()
        assert text(screen, "#help").startswith("How confident System 1 must be")
        screen.query_one("#play", Button).focus()
        await pilot.pause()
        assert text(screen, "#help") == ""
        await pilot.press("escape")
        await pilot.pause()
    assert app.picked == [None]
