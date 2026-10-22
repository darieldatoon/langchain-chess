"""The New Game screen: the web app's New game dialog, in the terminal.

Side, starting position, System 1 and the LLM, the line spelling out the matchup, and Advanced
settings for the parts of the opponent in play, with the web app's labels; the focused field's
help shows at the bottom. Play is held until the opponent is playable.
"""

import asyncio
import contextlib
import json
from collections.abc import Callable
from dataclasses import dataclass, replace
from typing import Any, ClassVar

import chess
from textual import on
from textual.app import ComposeResult
from textual.binding import Binding, BindingType
from textual.containers import Horizontal, Vertical, VerticalScroll
from textual.content import Content
from textual.css.query import NoMatches
from textual.events import DescendantFocus
from textual.screen import ModalScreen
from textual.widget import Widget
from textual.widgets import (
    Button,
    Checkbox,
    Collapsible,
    Input,
    Label,
    RadioButton,
    RadioSet,
    Select,
    Static,
    TextArea,
)

from langchain_chess.efforts import takes_effort
from langchain_chess_cli.tui.setup import (
    CUSTOM,
    DRAW_CLAIMS,
    EFFORTS,
    GATES,
    LLM_NAMES,
    MEMORIES,
    MOVE_LISTS,
    NONE,
    STYLES,
    SYSTEM_ONE_LABELS,
    Setup,
    SideChoice,
    Summarize,
    Unplayable,
    changed_knobs,
    effort_overridden,
    help_of,
    knob_problem,
    label_of,
    matchup_line,
    matchup_of,
    model_of,
    opponent_label,
    sections_of,
    start_problem,
    with_knob,
)
from langchain_chess_systemone.settings import ChessContext

SIDES: tuple[tuple[str, SideChoice], ...] = (
    ("White", "white"),
    ("Random", "random"),
    ("Black", "black"),
)
OTHER = "other"
"""The System 1 picker's key for a model that isn't a preset, shown under its own name."""
NUMBERS = ("threshold", "tournament_threshold", "k", "top_p", "seed")
NULLABLE = frozenset({"tournament_threshold", "top_p"})
INTEGERS = frozenset({"k", "seed"})
SELECTS: dict[str, tuple[tuple[str, Any, str | None], ...]] = {
    "reasoning_effort": EFFORTS,
    "move_list": MOVE_LISTS,
    "memory": MEMORIES,
    "style": STYLES,
    "gate": GATES,
    "draw_claims": DRAW_CLAIMS,
}
FIELD_SECTIONS = {
    "model_kwargs": "llm",
    "threshold": "gate",
    "tournament_threshold": "gate",
    "k": "gate",
    "top_p": "gate",
    "seed": "rules",
}
"""The Advanced section each typed field is in."""
PLACEHOLDERS = {"tournament_threshold": "Same as above", "top_p": "Off"}
FIELD_HELP = {
    "side": "The colour you play. Random picks one when you press Play.",
    "start": "A FEN to start from, or empty for the standard position.",
    "system-one": "A fast move ranker.",
    "llm": "A reasoning model that thinks the position through.",
    "custom-model": "Use the format provider:model, e.g. langsmith:anthropic/claude-opus-5-5.",
}


@dataclass(frozen=True, slots=True)
class NewGame:
    context: ChessContext
    side: SideChoice
    start: str


def _options(choices: tuple[tuple[str, Any, str | None], ...]) -> list[tuple[str, str]]:
    """Select values must be hashable and not None, so each option is keyed by its JSON."""
    return [
        (f"{label} — {about}" if about else label, json.dumps(value))
        for label, value, about in choices
    ]


def _number(key: str, text: str) -> tuple[bool, float | int | None]:
    """Whether `text` is a number the knob can take, and that number."""
    if not text.strip():
        return key in NULLABLE, None
    try:
        value: float = float(text)
    except ValueError:
        return False, None
    if key in INTEGERS:
        return value.is_integer(), int(value) if value.is_integer() else None
    return True, value


class NewGameScreen(ModalScreen[NewGame | None]):
    DEFAULT_CSS = """
    NewGameScreen { align: center middle; }
    #dialog {
        width: 84; max-width: 100%; height: auto; max-height: 100%;
        border: round $primary; background: $surface; padding: 0 1;
    }
    #dialog > .title { text-style: bold; margin-top: 1; }
    #dialog > .lede { color: $text-muted; margin-bottom: 1; }
    /* Short of the screen, so the help and the footer never scroll away. */
    #body { height: auto; max-height: 65vh; }
    #body Vertical { height: auto; }
    #body Label { margin-top: 1; text-style: bold; }
    #body .hint { color: $text-muted; }
    #body .section { color: $text-muted; text-style: bold; margin-top: 1; }
    #body Input.-invalid { border: tall $error; }
    #side { layout: horizontal; width: 100%; }
    #matchup { margin-top: 1; padding: 0 1; background: $panel; }
    #matchup.-unplayable { color: $error; }
    #advanced { margin-top: 1; }
    #advanced-summary { color: $text-muted; }
    #help { height: auto; min-height: 2; color: $text-muted; border-top: solid $border; }
    #footer { height: auto; align-horizontal: right; padding-bottom: 1; }
    #footer Button { margin-left: 1; }
    #body TextArea { height: 5; }
    """
    BINDINGS: ClassVar[list[BindingType]] = [Binding("escape", "cancel", "Cancel")]

    def __init__(
        self,
        setup: Setup,
        start: str = "",
        *,
        limit: Callable[[str], int | None],
    ) -> None:
        super().__init__()
        self.setup, self.start = setup, start
        self.limit = limit
        self.other = setup.system_one if setup.system_one not in SYSTEM_ONE_LABELS else ""
        self.summarize: Summarize = "checking"
        self.checked: str | None = None
        """The model `summarize` answers for."""
        self.invalid: set[str] = set()

    # ---- layout -------------------------------------------------------------------------------

    def compose(self) -> ComposeResult:
        setup = self.setup
        with Vertical(id="dialog"):
            yield Static("New game", classes="title")
            yield Static("Choose your colour and the opponent.", classes="lede")
            with VerticalScroll(id="body"):
                yield Label("Play as")
                with RadioSet(id="side"):
                    for label, value in SIDES:
                        yield RadioButton(label, value=setup.side == value, name=value)
                yield Label("Starting position")
                yield Input(self.start, placeholder="The standard position", id="start")
                yield Static(classes="hint", id="start-hint")
                yield Label("System 1")
                yield Select(
                    self._system_ones(),
                    value=self._system_one_key(),
                    id="system-one",
                    allow_blank=False,
                )
                yield Static(FIELD_HELP["system-one"], classes="hint")
                yield Label("LLM")
                yield Select(self._llms(), value=setup.llm, id="llm", allow_blank=False)
                yield Static(FIELD_HELP["llm"], classes="hint")
                yield Input(
                    setup.custom_model,
                    placeholder="langsmith:baseten/moonshotai/Kimi-K3",
                    id="custom-model",
                )
                yield Static(id="matchup")
                with Collapsible(title="Advanced", id="advanced"):
                    yield from self._advanced()
                yield Static(id="advanced-summary")
            yield Static(id="help")
            with Horizontal(id="footer"):
                yield Button("Cancel", id="cancel")
                yield Button("Play", variant="primary", id="play")

    def _advanced(self) -> ComposeResult:
        knobs = self.setup.knobs
        with Vertical(id="section-llm"):
            yield Static("LLM", classes="section")
            yield from self._select("reasoning_effort")
            yield Label(label_of("system_prompt"))
            yield TextArea(knobs.get("system_prompt") or "", id="system_prompt")
            yield from self._select("move_list")
            yield from self._check("show_fen")
            yield from self._check("show_board")
            yield from self._select("memory")
            yield Label(label_of("model_kwargs"))
            text = json.dumps(knobs["model_kwargs"], indent=2) if knobs["model_kwargs"] else ""
            yield TextArea(text, id="model_kwargs")
            yield Static(classes="hint", id="model_kwargs-hint")
        with Vertical(id="section-systemone"):
            yield Static("System 1", classes="section")
            yield from self._select("style")
            yield from self._check("with_eval")
            yield from self._check("with_nouls")
            with Vertical(id="section-gate"):
                yield from self._select("gate")
                for key in ("threshold", "tournament_threshold", "k", "top_p"):
                    yield from self._input(key)
            yield Static(
                "How confident System 1 must be, and what the LLM is shown, apply when an LLM "
                "plays too.",
                classes="hint",
                id="gate-note",
            )
        yield Static("Rules", classes="section")
        yield from self._select("draw_claims")
        yield from self._input("seed")

    def _select(self, key: str) -> ComposeResult:
        yield Label(label_of(key))
        value = json.dumps(self.setup.knobs[key])
        yield Select(_options(SELECTS[key]), value=value, id=key, allow_blank=False)
        yield Static(classes="hint", id=f"{key}-hint")

    def _check(self, key: str) -> ComposeResult:
        yield Checkbox(label_of(key), value=self.setup.knobs[key], id=key)

    def _input(self, key: str) -> ComposeResult:
        yield Label(label_of(key))
        value = self.setup.knobs[key]
        yield Input(
            "" if value is None else str(value), placeholder=PLACEHOLDERS.get(key, ""), id=key
        )

    def _system_ones(self) -> list[tuple[str, str]]:
        presets = [(f"{label} — {model}", model) for model, label in SYSTEM_ONE_LABELS.items()]
        other = [(self.other, OTHER)] if self.other else []
        return [*presets, *other, ("None — The LLM plays alone", NONE)]

    def _system_one_key(self) -> str:
        if self.setup.system_one_off:
            return NONE
        return self.setup.system_one if self.setup.system_one in SYSTEM_ONE_LABELS else OTHER

    def _llms(self) -> list[tuple[str, str]]:
        return [
            *((name, model) for model, name in LLM_NAMES.items()),
            ("None — System 1 plays alone", NONE),
            ("Custom model… — Any model spec", CUSTOM),
        ]

    def on_mount(self) -> None:
        self.query_one("#side", RadioSet).focus()
        self._ask_limit()
        self._update()

    # ---- state --------------------------------------------------------------------------------

    def _ask_limit(self) -> None:
        model = model_of(self.setup)
        if not model or model == self.checked:
            return
        self.checked, self.summarize = model, "checking"
        self.run_worker(self._limit(model), exclusive=True, group="limit")

    async def _limit(self, model: str) -> None:
        # Waits out typing in the custom model field; building a model is slow.
        await asyncio.sleep(0.3)
        limit = await asyncio.to_thread(self.limit, model)
        # Dropped when another model was picked meanwhile.
        if model == self.checked:
            self.summarize = "no" if limit is None else "yes"
            # Quitting removes this screen's widgets before it cancels this worker.
            with contextlib.suppress(NoMatches):
                self._update()

    def _set(self, setup: Setup) -> None:
        self.setup = setup
        self._ask_limit()
        self._update()

    def _start_text(self) -> str:
        return self.query_one("#start", Input).value

    def _start_problem(self) -> str | None:
        return start_problem(self._start_text(), self.setup.knobs["draw_claims"])

    def matchup(self) -> ChessContext | Unplayable:
        if self._start_problem():
            return Unplayable("Fix the starting position.")
        sections = sections_of(self.setup)
        shown = {"llm": sections.llm, "gate": sections.gate, "rules": True}
        # A field the opponent doesn't use is hidden, and its text no longer holds Play.
        if any(shown[FIELD_SECTIONS[key]] for key in self.invalid):
            return Unplayable("Fix the Advanced settings marked invalid.")
        return matchup_of(self.setup, self.summarize)

    def _update(self) -> None:
        setup, ready = self.setup, self.matchup()
        sections = sections_of(setup)
        problem = self._start_problem()
        self.query_one("#start-hint", Static).update(
            Content.styled(problem, "$error") if problem else FIELD_HELP["start"]
        )
        self.query_one("#custom-model").display = setup.llm == CUSTOM
        matchup = self.query_one("#matchup", Static)
        matchup.update(ready.reason if isinstance(ready, Unplayable) else matchup_line(ready))
        matchup.set_class(isinstance(ready, Unplayable), "-unplayable")
        self.query_one("#section-llm").display = sections.llm
        self.query_one("#section-systemone").display = sections.systemone
        self.query_one("#section-gate").display = sections.gate
        self.query_one("#gate-note").display = not sections.gate
        advanced = self.query_one("#advanced", Collapsible)
        summary = self.query_one("#advanced-summary", Static)
        summary.display = advanced.collapsed
        summary.update(_summary(setup.side, ready))
        self.query_one("#play", Button).disabled = isinstance(ready, Unplayable)
        self._update_hints()

    def _update_hints(self) -> None:
        model = model_of(self.setup)
        takes = model is None or takes_effort(model)
        effort = self.query_one("#reasoning_effort", Select)
        effort.disabled = not takes
        # A held control shows what the game plays with; the pick comes back when it's freed.
        _show(effort, None if not takes else self.setup.knobs["reasoning_effort"])
        effort_hint = (
            "This model doesn't take a reasoning effort."
            if not takes
            else "Model arguments set the effort, so this is ignored."
            if effort_overridden(self.setup.knobs["model_kwargs"])
            else ""
        )
        self.query_one("#reasoning_effort-hint", Static).update(effort_hint)
        memory = self.query_one("#memory", Select)
        memory.disabled = self.summarize == "no"
        _show(memory, False if memory.disabled else self.setup.knobs["memory"])
        self.query_one("#memory-hint", Static).update(
            "This model has no known input limit, so it can't summarize."
            if self.summarize == "no"
            else ""
        )

    # ---- events -------------------------------------------------------------------------------

    @on(RadioSet.Changed, "#side")
    def _side(self, event: RadioSet.Changed) -> None:
        self._set(replace(self.setup, side=event.pressed.name))

    @on(Input.Changed, "#start")
    def _start(self) -> None:
        self._update()

    @on(Select.Changed, "#system-one")
    def _system_one(self, event: Select.Changed) -> None:
        key = str(event.value)
        if key == NONE:
            self._set(replace(self.setup, system_one_off=True))
        else:
            model = self.other if key == OTHER else key
            self._set(replace(self.setup, system_one=model, system_one_off=False))

    @on(Select.Changed, "#llm")
    def _llm(self, event: Select.Changed) -> None:
        self._set(replace(self.setup, llm=str(event.value)))
        if event.value == CUSTOM:
            self.query_one("#custom-model", Input).focus()

    @on(Input.Changed, "#custom-model")
    def _custom(self, event: Input.Changed) -> None:
        self._set(replace(self.setup, custom_model=event.value))

    @on(Select.Changed)
    def _knob_select(self, event: Select.Changed) -> None:
        key = event.select.id
        if key in SELECTS:
            self._set(with_knob(self.setup, key, json.loads(str(event.value))))

    @on(Checkbox.Changed)
    def _knob_check(self, event: Checkbox.Changed) -> None:
        self._set(with_knob(self.setup, str(event.checkbox.id), event.value))

    @on(Input.Changed)
    def _knob_number(self, event: Input.Changed) -> None:
        key = event.input.id
        if key not in NUMBERS:
            return
        valid, value = _number(key, event.value)
        problem = knob_problem(key, value) if valid else "Not a number this setting takes."
        # Only a value the settings take reaches the knob; the field keeps the rest as text.
        event.input.set_class(problem is not None, "-invalid")
        event.input.tooltip = problem
        if problem is None:
            self.invalid.discard(key)
            self._set(with_knob(self.setup, key, value))
        else:
            self.invalid.add(key)
            self._update()

    @on(TextArea.Changed, "#system_prompt")
    def _prompt(self, event: TextArea.Changed) -> None:
        text = event.text_area.text
        self._set(with_knob(self.setup, "system_prompt", text if text.strip() else None))

    @on(TextArea.Changed, "#model_kwargs")
    def _kwargs(self, event: TextArea.Changed) -> None:
        text, hint = event.text_area.text, self.query_one("#model_kwargs-hint", Static)
        try:
            value = json.loads(text) if text.strip() else {}
        except json.JSONDecodeError:
            value = None
        problem = (
            knob_problem("model_kwargs", value) if isinstance(value, dict) else "Use a JSON object."
        )
        if problem is not None:
            self.invalid.add("model_kwargs")
            hint.update(Content.styled(problem, "$error"))
            self._update()
            return
        self.invalid.discard("model_kwargs")
        hint.update("")
        self._set(with_knob(self.setup, "model_kwargs", value))

    @on(Collapsible.Toggled)
    def _advanced_toggled(self) -> None:
        self._update()

    def on_descendant_focus(self, event: DescendantFocus) -> None:
        self.query_one("#help", Static).update(_help(event.widget))

    @on(Button.Pressed, "#play")
    def _play(self) -> None:
        ready = self.matchup()
        if isinstance(ready, ChessContext):
            text = self._start_text().strip()
            start = chess.Board(text).fen() if text else chess.STARTING_FEN
            self._close(NewGame(ready, self.setup.side, start))

    @on(Button.Pressed, "#cancel")
    def action_cancel(self) -> None:
        self._close(None)

    def _close(self, picked: NewGame | None) -> None:
        # A check still out would resume on a screen whose widgets are already gone.
        self.workers.cancel_group(self, "limit")
        self.dismiss(picked)


def _show(select: Select[str], value: object) -> None:
    """Sets a select without it reporting a change, which would overwrite the knob."""
    with select.prevent(Select.Changed):
        select.value = json.dumps(value)


def _help(widget: Widget) -> str:
    key = widget.id or (widget.parent.id if widget.parent else None) or ""
    if key in FIELD_HELP:
        return FIELD_HELP[key]
    if key in ChessContext.model_fields:
        return help_of(key)
    return ""


def _summary(side: SideChoice, ready: ChessContext | Unplayable) -> str:
    """What Advanced holds while it's closed: "White · SemIf + GLM-5.3 Flash · 3 settings
    changed"."""
    name = side.capitalize()
    if isinstance(ready, Unplayable):
        return name
    changed = len(changed_knobs(ready))
    settings = [f"{changed} setting{'s' if changed != 1 else ''} changed"] if changed else []
    return " · ".join([name, opponent_label(ready), *settings])
