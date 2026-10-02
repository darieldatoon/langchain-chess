"""`lcchess play`: a Textual game against an in-process chess agent, laid out as the web app.

Moves come from the drawn board (mouse, or arrow keys and Enter) or from the notation input,
which takes SAN or UCI; typing a move on the board starts it there.

Start and retry are separate actions, as in the web UI: the opponent opens with `go`; after a
failed run, retry invokes the same thread with empty input. A game from a chosen position opens
with one position packet instead, resent until a turn accepts it. A new game is a new thread; it
cancels the previous game's run, then deletes that game's checkpoints.
"""

import contextlib
import random
import uuid
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, replace
from time import monotonic
from typing import TYPE_CHECKING, Any, ClassVar, Literal, cast

import chess
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph.state import CompiledStateGraph
from langgraph.types import Checkpointer
from textual import events, on
from textual.app import App, ComposeResult, SystemCommand
from textual.binding import Binding, BindingType
from textual.containers import Grid, Horizontal, Vertical
from textual.content import Content
from textual.screen import ModalScreen, Screen
from textual.widgets import Button, Footer, Header, Input, Label, Static
from textual.worker import Worker, WorkerCancelled, WorkerFailed

from langchain_chess.parse import text_of
from langchain_chess.rules import (
    ChatCommand,
    CommandError,
    Go,
    OfferDraw,
    Resign,
    outcome_line,
    parse_chat,
)
from langchain_chess.state import Side
from langchain_chess_cli.options import run_config
from langchain_chess_cli.tui import openings
from langchain_chess_cli.tui.board import ChessBoard
from langchain_chess_cli.tui.export import lichess_url, pgn_file_name, to_pgn
from langchain_chess_cli.tui.reply import latest_reply, reply_at, so_far, turn_key
from langchain_chess_cli.tui.setup import (
    changed_knobs,
    model_limit,
    opponent_label,
    resolve_side,
    setup_of,
)
from langchain_chess_cli.tui.theme import THEMES
from langchain_chess_cli.tui.view import (
    board_at,
    color_side,
    entries,
    material_text,
    move_rows,
    opposite,
    positions,
    result_headline,
    score_text,
    strip_result,
)
from langchain_chess_cli.tui.widgets import (
    Act,
    BoardColumn,
    MoveList,
    PlayerStrip,
    ReplyPanel,
    Say,
    Stage,
    Status,
    Thinking,
)
from langchain_chess_systemone.settings import ChessContext

if TYPE_CHECKING:
    from langchain_core.runnables import RunnableConfig

    from langchain_chess_cli.tui.newgame import NewGame
    from langchain_chess_cli.tui.setup import Setup

type Factory = Callable[[ChessContext, Checkpointer], CompiledStateGraph]
"""Builds the agent a game's settings describe, on the app's checkpointer."""

RUN = "agent-run"
PLACEHOLDER = "Type a move (SAN or UCI), or click the board"
type Layout = Literal["full", "wide", "phone"]
"""The web's layouts: Last Reply on the left; the table beside the board; everything stacked."""

FULL = 160
WIDE = 88
"""The 44-column table beside the smallest board with two-row squares, 42 columns, and its
padding. Narrower, the board would shrink to one-row squares or vanish, so it stacks instead."""


def layout_for(width: int) -> Layout:
    if width >= FULL:
        return "full"
    return "wide" if width >= WIDE else "phone"


@dataclass(frozen=True, slots=True)
class Game:
    """What a game plays: the opponent, the human's side and the starting position."""

    context: ChessContext
    side: Side
    start: str = chess.STARTING_FEN


class Main(Grid):
    def on_resize(self, event: events.Resize) -> None:
        # Stacked and already scrolling, a change of height alone never resizes the column.
        self.query_one(BoardColumn).fit()


class ConfirmResign(ModalScreen[bool]):
    """Resigning asks first."""

    DEFAULT_CSS = """
    ConfirmResign { align: center middle; }
    ConfirmResign > Vertical {
        width: auto; height: auto; padding: 1 2; border: round $error; background: $surface;
    }
    ConfirmResign Horizontal { width: auto; height: auto; margin-top: 1; }
    ConfirmResign Button { margin-right: 1; }
    """
    BINDINGS: ClassVar[list[BindingType]] = [Binding("escape", "dismiss(False)", "Cancel")]

    def compose(self) -> ComposeResult:
        with Vertical():
            yield Label("Resign this game?")
            with Horizontal():
                yield Button("Confirm resignation", variant="error", id="confirm")
                yield Button("Cancel", id="cancel")

    def on_mount(self) -> None:
        self.query_one("#cancel", Button).focus()

    def on_button_pressed(self, event: Button.Pressed) -> None:
        self.dismiss(event.button.id == "confirm")


class ChessApp(App[None]):
    TITLE = "LangChain Chess"
    CSS = """
    #main { layout: grid; grid-size: 3 1; grid-columns: 44 1fr 38; height: 1fr; }
    #main.-wide { grid-size: 2 2; grid-columns: 1fr 44; grid-rows: 2fr 3fr; }
    #main.-wide #board-col { row-span: 2; }
    #main.-phone { layout: vertical; overflow-y: auto; scrollbar-size-vertical: 1; }
    #main.-phone > * { height: auto; }
    #main.-phone #moves { height: auto; max-height: 12; }
    #reply { height: 1fr; }
    #table { height: 1fr; padding: 0 1; border: round $border; }
    #headline { margin-bottom: 1; }
    #nav, #actions, #over, #viewing { height: 1; margin-top: 1; }
    #nav Button, #actions Button, #over Button, #viewing Button {
        width: auto; min-width: 0; margin-right: 1;
    }
    #viewing Static { width: 1fr; color: $text-muted; }
    #note { height: auto; margin-top: 1; color: $text-muted; }
    #note.-error { color: $error; }
    """
    BINDINGS: ClassVar[list[BindingType]] = [
        Binding("ctrl+n", "new_game", "New game"),
        Binding("ctrl+s", "start", "Start", show=False),
        Binding("ctrl+r", "retry", "Retry", show=False),
        Binding("ctrl+f", "flip", "Flip"),
        Binding("ctrl+g", "resign", "Resign"),
        Binding("ctrl+o", "offer_draw", "Offer draw"),
        Binding("comma", "step(-1)", "Back", key_display=","),
        Binding("full_stop", "step(1)", "Forward", key_display="."),
        Binding("home", "go(0)", "First move", show=False),
        Binding("end", "go_live", "Last move", show=False),
        Binding("ctrl+q", "quit", "Quit"),
    ]

    def __init__(
        self,
        factory: Factory,
        game: Game,
        *,
        limit: Callable[[str], int | None] = model_limit,
        coin: Callable[[], float] = random.random,
    ) -> None:
        super().__init__()
        self.checkpointer = InMemorySaver()
        self.factory = factory
        self.game = game
        self.agent = factory(game.context, self.checkpointer)
        self.limit, self.coin = limit, coin
        self.thread = ""
        self.values: dict[str, Any] = {}
        self.running = False
        self.failed: str | None = None
        self.analysis = ""
        self.analysis_id: str | None = None
        """The model message `analysis` is the text of; another one starts afresh."""
        self.since = 0.0
        self.run_from = ""
        """`turn_key` when the run was sent, or when its turn opened."""
        self.sent_from = chess.STARTING_FEN
        """The position the agent moves from in the run out, the human's move included."""
        self.viewed: int | None = None
        """The position shown, None to follow the game: it stays put while moves arrive."""
        self.flipped = False
        self.notice: tuple[str, bool] | None = None
        """A line under the actions, and whether it's an error, until the next command."""
        self.open_stages = {"systemone": True, "llm": True}
        self.first: dict[str, Any] | None = None
        """A game from a chosen position: the position packet until a turn accepts it."""
        for theme in THEMES:
            self.register_theme(theme)
        self.theme = "langchain"

    # ---- layout -------------------------------------------------------------------------------

    def compose(self) -> ComposeResult:
        yield Header()
        with Main(id="main"):
            yield ReplyPanel(id="reply")
            with BoardColumn(id="board-col"):
                yield PlayerStrip(id="top")
                yield ChessBoard(id="board")
                yield PlayerStrip(id="bottom")
            with Vertical(id="table"):
                yield Static(id="headline")
                yield MoveList(id="moves")
                with Horizontal(id="viewing"):
                    yield Static()
                    yield Button("Back to live", compact=True, action="app.go_live")
                with Horizontal(id="nav"):
                    yield Button("|◀", compact=True, action="app.go(0)", tooltip="First move")
                    yield Button("◀", compact=True, action="app.step(-1)", tooltip="Back (,)")
                    yield Button("▶", compact=True, action="app.step(1)", tooltip="Forward (.)")
                    yield Button("▶|", compact=True, action="app.go_live", tooltip="Last move")
                with Horizontal(id="actions"):
                    yield Button("⚑ Resign", compact=True, id="resign", action="app.resign")
                    yield Button("½ Offer draw", compact=True, id="draw", action="app.offer_draw")
                    yield Button("⇅ Flip", compact=True, action="app.flip")
                with Horizontal(id="over"):
                    yield Button("Rematch", variant="primary", compact=True, action="app.rematch")
                    yield Button("New game", compact=True, action="app.new_game")
                    yield Button("Lichess ↗", compact=True, action="app.lichess")
                yield Static(id="note", markup=False)
        # Typing on the board moves focus here mid-word, so focus must not select the text.
        yield Input(
            placeholder=PLACEHOLDER,
            id="move",
            select_on_focus=False,
        )
        yield Footer()

    def on_mount(self) -> None:
        self._start_game(self.game)
        self.query_one("#board", ChessBoard).focus()

    def on_resize(self, event: events.Resize) -> None:
        main = self.query_one("#main", Grid)
        layout = layout_for(event.size.width)
        main.set_class(layout == "wide", "-wide")
        main.set_class(layout == "phone", "-phone")
        reply = self.query_one("#reply", ReplyPanel)
        on_left = main.children[0] is reply
        if layout == "full" and not on_left:
            main.move_child(reply, before=self.query_one("#board-col"))
        elif layout != "full" and on_left:
            main.move_child(reply, after=self.query_one("#table"))

    # ---- what the screen shows ----------------------------------------------------------------

    @property
    def human(self) -> chess.Color:
        return chess.WHITE if self.game.side == "white" else chess.BLACK

    def _moves(self) -> list[str]:
        return list(self.values.get("moves") or [])

    def _pending(self) -> bool:
        turns = self.values.get("turns") or []
        return bool(turns) and turns[-1]["status"] == "pending"

    def _over(self) -> bool:
        return self.values.get("outcome") is not None

    def _live(self) -> bool:
        return self.viewed is None or self.viewed >= len(self._moves())

    def _index(self) -> int:
        return len(self._moves()) if self._live() else cast("int", self.viewed)

    def _latest(self) -> chess.Board:
        return board_at({**self.values, "start_fen": self._start()}, len(self._moves()))

    def _start(self) -> str:
        """The thread's root once a turn has accepted it, else the game's choice."""
        if self.values.get("turns"):
            return self.values.get("start_fen") or chess.STARTING_FEN
        return self.game.start

    def _idle(self) -> bool:
        return not self.running and not self._pending() and not self._over()

    def _can_move(self) -> bool:
        return self._idle() and self._latest().turn == self.human

    def _unanswered(self) -> bool:
        """The first position packet failed before any turn took it: Retry resends it."""
        return self.first is not None and self.failed is not None

    def _can_go(self) -> bool:
        return self._idle() and self._latest().turn != self.human and not self._unanswered()

    def _can_retry(self) -> bool:
        if self.running or self._over():
            return False
        return self._pending() or self._unanswered()

    def _can_resign(self) -> bool:
        """Also after a failed turn: resigning abandons it."""
        started = bool(self._moves()) or bool(self.values.get("turns"))
        return not self.running and not self._over() and started

    def _offered(self) -> bool:
        ply, human = len(self._moves()), color_side(self.human)
        return any(
            o["ply"] == ply and o["by"] == human for o in self.values.get("draw_offers") or []
        )

    def _can_offer_draw(self) -> bool:
        return self._can_resign() and self._can_move() and self._live() and not self._offered()

    def _status(self, side: Side) -> Status:
        outcome = self.values.get("outcome")
        if outcome is not None:
            return Say(strip_result(outcome, side), bold=True)
        if side == color_side(self.human):
            return Say("Your turn") if self._can_move() and self._live() else None
        if self.running:
            return Thinking(self.since)
        if self._can_go():
            label = "Start ^s" if not self._moves() else "Ask opponent to move ^s"
            return Act(label, "app.start", primary=True)
        if self._can_retry():
            return Act("Retry ^r", "app.retry", primary=False)
        return None

    def _player(self, side: Side) -> str:
        return "You" if side == self.game.side else opponent_label(self.game.context)

    def _refresh(self) -> None:
        values = {**self.values, "start_fen": self._start()}
        fens, moves = positions(values), self._moves()
        index, live, over = self._index(), self._live(), self._over()
        shown = board_at(values, index)
        bottom = self.game.side if not self.flipped else opposite(self.game.side)
        self.query_one("#board", ChessBoard).show(
            shown,
            white_bottom=bottom == "white",
            last_move=moves[index - 1] if index else None,
            interactive=live and self._can_move(),
        )
        for strip_id, side in (("#top", opposite(bottom)), ("#bottom", bottom)):
            self.query_one(strip_id, PlayerStrip).show(
                side=side,
                name=self._player(side),
                material=material_text(shown, side),
                status=self._status(side),
            )
        opening = openings.opening_at(fens, index, openings.table())
        outcome = self.values.get("outcome")
        self.query_one("#moves", MoveList).show(
            move_rows(entries(values), self._start()),
            selected=index - 1 if index else None,
            opening=opening.title if opening else None,
            result=(
                Content.assemble((score_text(outcome), "bold"), "  ", outcome_line(outcome))
                if outcome
                else None
            ),
            draws=frozenset(o["ply"] - 1 for o in self.values.get("draw_offers") or []),
        )
        headline = self.query_one("#headline", Static)
        headline.display = outcome is not None
        if outcome is not None:
            headline.update(
                Content.assemble(
                    (result_headline(outcome, self.game.side), "bold"), " · ", outcome_line(outcome)
                )
            )
        viewing = self.query_one("#viewing", Horizontal)
        viewing.display = not live and not over
        viewing.query_one(Static).update(f"Viewing move {index}")
        self.query_one("#actions").display = not over
        self.query_one("#over").display = over
        self.query_one("#resign", Button).disabled = not self._can_resign()
        self.query_one("#draw", Button).disabled = not self._can_offer_draw()
        typing = self.query_one("#move", Input)
        typing.disabled = not live
        typing.placeholder = PLACEHOLDER if live else "Back to live to type a move"
        self._show_reply(values, fens, index, live)
        self._show_notice()
        self.refresh_bindings()

    def _show_reply(
        self, values: dict[str, Any], fens: Sequence[str], index: int, live: bool
    ) -> None:
        policy = self.game.context.policy
        if live:
            reply = latest_reply(
                values,
                fens,
                policy,
                analysis=self.analysis,
                running=self.running,
                error=self.failed,
                run_from=self.run_from,
                sent_from=self.sent_from,
            )
        else:
            reply = reply_at(values, fens, index, policy)
        self.query_one("#reply", ReplyPanel).show(
            reply,
            title="Last reply" if live else f"Reply before move {index + 1}",
            open_stages=self.open_stages,
            game=so_far(values, index, live=live),
        )

    def _show_notice(self) -> None:
        note = self.query_one("#note", Static)
        error = self.values.get("error")
        if self.notice is not None:
            text, is_error = self.notice
        elif self.failed:
            # Also when no turn shows it: a first packet can fail before any turn exists.
            text, is_error = f"The run failed: {self.failed}", True
        elif error:
            text, is_error = f"Move rejected: {error}", True
        elif self._offered():
            text, is_error = "Draw declined.", False
        else:
            text, is_error = "", False
        note.update(text)
        note.set_class(is_error, "-error")

    def check_action(self, action: str, parameters: tuple[object, ...]) -> bool | None:
        """Hidden from the footer when it can't apply; greyed when it can't apply yet."""
        checks: dict[str, Callable[[], bool]] = {
            "start": self._can_go,
            "retry": self._can_retry,
            "resign": self._can_resign,
            "offer_draw": self._can_offer_draw,
        }
        if action in ("resign", "offer_draw") and self._over():
            return False
        if action in checks:
            return True if checks[action]() else None
        return True

    # ---- navigation ---------------------------------------------------------------------------

    def action_go(self, index: int) -> None:
        last = len(self._moves())
        self.viewed = None if index >= last else max(0, index)
        self._refresh()

    def action_step(self, step: int) -> None:
        self.action_go(self._index() + step)

    def action_go_live(self) -> None:
        self.action_go(len(self._moves()))

    def action_flip(self) -> None:
        self.flipped = not self.flipped
        self._refresh()

    def on_stage_toggled(self, message: Stage.Toggled) -> None:
        self.open_stages[message.stage] = not self.open_stages[message.stage]
        self._refresh()

    # ---- games --------------------------------------------------------------------------------

    def _start_game(self, game: Game, agent: CompiledStateGraph | None = None) -> None:
        runs = self.workers.cancel_group(self, RUN)
        if self.thread:
            self.run_worker(self._forget(self.thread, runs))
        self.agent = agent or self.agent
        self.game = game
        self.thread = f"tui-{uuid.uuid4()}"
        self.values, self.running, self.failed, self.analysis = {}, False, None, ""
        self.viewed, self.flipped, self.notice = None, False, None
        self.analysis_id = None
        custom = chess.Board(game.start).fen() != chess.STARTING_FEN
        self.first = {"position": {"start_fen": game.start}} if custom else None
        self._refresh()
        if self._can_go():
            self.action_start()

    def action_new_game(self) -> None:
        self._open_new_game(setup_of(self.game.context, self.game.side), self.game.start)

    def _open_new_game(self, setup: "Setup", start: str) -> None:
        from langchain_chess_cli.tui.newgame import NewGameScreen

        def chosen(picked: "NewGame | None") -> None:
            if picked is None:
                return
            # Built before the current game is dropped: a spec the providers refuse keeps it.
            try:
                agent = (
                    self.factory(picked.context, self.checkpointer)
                    if picked.context != self.game.context
                    else None
                )
            except (ValueError, ImportError) as e:
                self.notify(f"Couldn't build that opponent: {e}", severity="error", timeout=10)
                self._open_new_game(setup_of(picked.context, picked.side), picked.start)
                return
            side = resolve_side(picked.side, self.coin)
            self._start_game(Game(picked.context, side, picked.start), agent)

        text = "" if start == chess.STARTING_FEN else start
        self.push_screen(NewGameScreen(setup, text, limit=self.limit), chosen)

    def action_rematch(self) -> None:
        self._start_game(replace(self.game, side=opposite(self.game.side)))

    def action_start(self) -> None:
        if not self._can_go():
            return
        if self.first is not None:
            self._submit(self.first)
        else:
            self._submit({"messages": [_human("go")]})

    def action_retry(self) -> None:
        if not self._can_retry():
            return
        self._submit({} if self._pending() else cast("dict[str, Any]", self.first))

    def action_resign(self) -> None:
        if not self._can_resign():
            return

        def confirmed(yes: bool | None) -> None:
            if yes and self._can_resign():
                self._submit({"messages": [_human(f"resign {self.game.side}")]})

        self.push_screen(ConfirmResign(), confirmed)

    def action_offer_draw(self) -> None:
        if self._can_offer_draw():
            self._submit({"messages": [_human(f"draw {self.game.side}")]})

    @on(Input.Submitted, "#move")
    def _typed_move(self, event: Input.Submitted) -> None:
        text = event.value.strip()
        event.input.value = ""
        self.query_one("#board", ChessBoard).focus()
        if text:
            self._play(text)

    def on_chess_board_moved(self, message: ChessBoard.Moved) -> None:
        self._play(message.uci)

    def on_chess_board_typed(self, message: ChessBoard.Typed) -> None:
        field = self.query_one("#move", Input)
        if field.disabled:
            return
        field.focus()
        field.insert_text_at_cursor(message.character)

    def _play(self, text: str) -> None:
        """A move, or `go`, `resign` or `draw` typed: the commands take the same path as their
        keys, confirmation and all, for the human's side whatever side was typed."""
        if self._over():
            self._say("The game is over.", error=True)
            return
        if not self._live():
            self._say("Back to live to move.", error=True)
            return
        try:
            command: ChatCommand | CommandError = parse_chat(self._latest(), text)
        except CommandError as e:
            command = e
        if isinstance(command, Go | Resign | OfferDraw):
            self._control(command)
        # Before the parse error: a move typed on the agent's turn is parsed for the agent.
        elif self.running or self._pending():
            self.notify("Wait for the agent, or retry its failed move.", severity="warning")
        elif self._latest().turn != self.human:
            self.notify("It's the agent's move.", severity="warning")
        elif isinstance(command, CommandError):
            self._say(str(command), error=True)
        elif self.first is None:
            uci = command.move.uci()
            self._submit({"messages": [_human(uci)]}, move=uci)
        else:
            # Until a turn accepts the chosen position, the first move goes in its packet.
            uci = command.move.uci()
            self.first = {"position": {"start_fen": self.game.start, "moves": [uci]}}
            self._submit(self.first)

    def _control(self, command: Go | Resign | OfferDraw) -> None:
        if isinstance(command, Go):
            able, act, why = self._can_go(), self.action_start, "It isn't the opponent's move."
        elif isinstance(command, Resign):
            able, act, why = self._can_resign(), self.action_resign, "You can't resign yet."
        else:
            able, act, why = (
                self._can_offer_draw(),
                self.action_offer_draw,
                "You can't offer a draw now.",
            )
        if able:
            act()
        else:
            self._say(why, error=True)

    def _say(self, text: str, *, error: bool = False) -> None:
        self.notice = (text, error)
        self._refresh()

    # ---- export -------------------------------------------------------------------------------

    def get_system_commands(self, screen: Screen) -> Iterable[SystemCommand]:
        yield from super().get_system_commands(screen)
        yield SystemCommand("New game", "Choose a side and an opponent", self.action_new_game)
        yield SystemCommand("Flip board", "Turn the board around", self.action_flip)
        yield SystemCommand("Copy PGN", "The game so far, to the clipboard", self.action_copy_pgn)
        yield SystemCommand("Copy FEN", "The position on the board", self.action_copy_fen)
        yield SystemCommand("Save PGN", "The game as a .pgn file here", self.action_save_pgn)
        yield SystemCommand("Analyze on Lichess", "Open the game in a browser", self.action_lichess)
        yield SystemCommand("Resign", "Resign this game, after a confirmation", self.action_resign)
        yield SystemCommand(
            "Offer draw", "The opponent accepts or declines", self.action_offer_draw
        )

    def pgn(self) -> str:
        values = {**self.values, "start_fen": self._start()}
        context = self.game.context
        comment = " · ".join(
            [opponent_label(context), *changed_knobs(context), f"Thread {self.thread}"]
        )
        fens = positions(values)
        return to_pgn(
            values,
            white=self._player("white"),
            black=self._player("black"),
            comment=comment,
            opening=openings.opening_at(fens, len(fens) - 1, openings.table()),
        )

    def _shown_fen(self) -> str:
        return positions({**self.values, "start_fen": self._start()})[self._index()]

    def action_copy_pgn(self) -> None:
        self.copy_to_clipboard(self.pgn())
        self.notify("Copied the PGN.")

    def action_copy_fen(self) -> None:
        self.copy_to_clipboard(self._shown_fen())
        self.notify("Copied the FEN.")

    def action_save_pgn(self) -> None:
        name = pgn_file_name(self.thread)
        with open(name, "w", encoding="utf-8") as file:
            file.write(self.pgn())
        self.notify(f"Saved {name}.")

    def action_lichess(self) -> None:
        url, fallback = lichess_url(self.pgn(), self._shown_fen())
        self.open_url(url)
        if fallback:
            self.notify("Opened the position; the game was too long to send.")

    # ---- runs ---------------------------------------------------------------------------------

    def _submit(self, payload: dict[str, Any], *, move: str | None = None) -> None:
        self.running, self.failed, self.analysis, self.notice = True, None, "", None
        self.analysis_id = None
        self.since = monotonic()
        self.run_from = turn_key(self.values)
        self.sent_from = _moving_from(payload, self._latest(), move)
        self._refresh()
        self.run_worker(self._invoke(payload, self.thread), group=RUN)

    async def _invoke(self, payload: dict[str, Any], thread: str) -> None:
        config: RunnableConfig = run_config("tui", thread, self.game.context)
        try:
            async for mode, chunk in self.agent.astream(
                payload, config, stream_mode=["messages", "values"]
            ):
                if mode == "values":
                    self.values = dict(cast("dict[str, Any]", chunk))
                    if self._pending():
                        self.run_from = turn_key(self.values)
                    self._refresh()
                    continue
                message, metadata = cast("tuple[Any, dict[str, Any]]", chunk)
                if metadata.get("langgraph_node") == "model":
                    # A new attempt replaces the last one's text, as the web's liveAnalysis does.
                    if message.id != self.analysis_id:
                        self.analysis_id, self.analysis = message.id, ""
                    self.analysis += text_of(message)
                    self._refresh()
        except Exception as e:  # the turn stays pending; retry resumes it
            self.failed = str(e) or type(e).__name__
        self.values = dict((await self.agent.aget_state(config)).values)
        if self.values.get("turns") or self.values.get("outcome"):
            self.first = None
        self.running = False
        self._refresh()

    async def _forget(self, thread: str, runs: Sequence[Worker]) -> None:
        """Nothing reopens a retired game; drop it once its runs have unwound."""
        for run in runs:
            with contextlib.suppress(WorkerCancelled, WorkerFailed):
                await run.wait()
        await self.checkpointer.adelete_thread(thread)


def _moving_from(payload: dict[str, Any], latest: chess.Board, move: str | None) -> str:
    """The position the agent moves from once `payload` lands: a packet's own, else the latest
    with the human's `move`."""
    if position := payload.get("position"):
        board = chess.Board(position["start_fen"])
        for uci in position.get("moves") or ():
            board.push_uci(uci)
        return board.fen()
    if move is not None:
        latest.push_uci(move)
    return latest.fen()


def _human(content: str) -> dict[str, Any]:
    return {"type": "human", "id": str(uuid.uuid4()), "content": content}
