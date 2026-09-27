"""`lcchess play`: a Textual game against an in-process chess agent.

Moves come from the drawn board (mouse, or arrow keys and Enter) or from the notation input,
which takes SAN or UCI; typing on the board starts a move there.

Start and retry are separate actions, as in the web UI: playing Black opens with `go`; after a
failed run, retry invokes the same thread with empty input. A new game is a new thread; it
cancels the previous game's run, then deletes that game's checkpoints.

With a time control the app keeps the clock: it cancels the agent's run when the agent's flag
falls, and it pauses while a failed turn waits for retry.
"""

import contextlib
import time
import uuid
from collections.abc import Callable, Sequence
from typing import TYPE_CHECKING, Any, ClassVar, Literal, cast

import chess
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph.state import CompiledStateGraph
from langgraph.types import Checkpointer
from rich.text import Text
from textual.app import App, ComposeResult
from textual.binding import Binding, BindingType
from textual.containers import Horizontal, Vertical, VerticalScroll
from textual.widgets import Footer, Header, Input, Static
from textual.worker import Worker, WorkerCancelled, WorkerFailed

from langchain_chess import TimeControl
from langchain_chess.parse import text_of
from langchain_chess_cli.options import run_config
from langchain_chess_cli.tui.board import ChessBoard
from langchain_chess_cli.tui.clock import (
    Clock,
    clock_text,
    control_text,
    flag_input,
    flagged,
    left,
    moved,
    new_clock,
    sent,
    settled,
    start,
    stop,
)
from langchain_chess_cli.tui.view import (
    board_of,
    describe_settings,
    move_list,
    ply_details,
    status_text,
)
from langchain_chess_systemone.settings import ChessContext

if TYPE_CHECKING:
    from langchain_core.runnables import RunnableConfig

type Side = Literal["white", "black"]

RUN = "agent-run"


class ChessApp(App[None]):
    TITLE = "langchain-chess"
    CSS = """
    #main { height: 1fr; }
    #board { width: 2fr; height: 1fr; padding: 1 1 0 1; }
    #side { width: 1fr; min-width: 36; padding: 0 1; }
    #clock { margin-top: 1; }
    #status { text-style: bold; margin: 1 0; }
    #details { margin-bottom: 1; }
    #moves { height: auto; max-height: 12; margin-bottom: 1; }
    #analysis-box { height: 1fr; border: round $secondary; border-title-color: $text-muted; }
    #analysis { padding: 0 1; }
    """
    BINDINGS: ClassVar[list[BindingType]] = [
        Binding("ctrl+n", "new_game", "New game"),
        Binding("ctrl+f", "switch_sides", "New game, other side"),
        Binding("ctrl+s", "start", "Start"),
        Binding("ctrl+r", "retry", "Retry"),
        Binding("ctrl+q", "quit", "Quit"),
    ]

    def __init__(
        self,
        factory: Callable[[Checkpointer], CompiledStateGraph],
        settings: ChessContext,
        *,
        side: Side = "white",
        time_control: TimeControl | None = None,
        monotonic: Callable[[], float] = time.monotonic,
    ) -> None:
        super().__init__()
        self.checkpointer = InMemorySaver()
        self.agent = factory(self.checkpointer)
        self.settings = settings
        self.side: Side = side
        self.thread = ""
        self.values: dict[str, Any] = {}
        self.running = False
        self.failed: str | None = None
        self.analysis = ""
        self.time_control = time_control
        self.monotonic = monotonic
        self.clock: Clock | None = None
        self.before: Clock | None = None
        """The clock as the human's move was sent, restored if the move is rejected."""

    # ---- layout -------------------------------------------------------------------------------

    def compose(self) -> ComposeResult:
        yield Header()
        with Horizontal(id="main"):
            yield ChessBoard(id="board")
            # Model output, errors and SAN are shown literally, never parsed as markup.
            with Vertical(id="side"):
                yield Static(id="clock", markup=False)
                yield Static(id="status", markup=False)
                yield Static(id="details", markup=False)
                yield Static(id="moves", markup=False)
                with VerticalScroll(id="analysis-box") as box:
                    box.border_title = "Analysis"
                    yield Static(id="analysis", markup=False)
        # Typing on the board moves focus here mid-word, so focus must not select the text.
        yield Input(
            placeholder="Type a move (SAN or UCI), or click the board",
            id="move",
            select_on_focus=False,
        )
        yield Footer()

    def on_mount(self) -> None:
        self.sub_title = describe_settings(self.settings)
        clock = self.query_one("#clock", Static)
        clock.display = self.time_control is not None
        if self.time_control is not None:
            self.sub_title += f" · {control_text(self.time_control)}"
            # The widget's timer, not the app's: it must stop before the widget is removed.
            clock.set_interval(0.1, self._tick)
        self.action_new_game()
        self.query_one("#board", ChessBoard).focus()

    @property
    def human(self) -> chess.Color:
        return chess.WHITE if self.side == "white" else chess.BLACK

    @property
    def agent_side(self) -> Side:
        return "black" if self.side == "white" else "white"

    def _pending(self) -> bool:
        turns = self.values.get("turns") or []
        return bool(turns) and turns[-1]["status"] == "pending"

    def _can_move(self) -> bool:
        return (
            not self.running
            and not self._pending()
            and self.values.get("outcome") is None
            and board_of(self.values).turn == self.human
        )

    def _refresh(self) -> None:
        board = board_of(self.values)
        plies = self.values.get("plies") or []
        last = plies[-1]["uci"] if plies else None
        self.query_one("#board", ChessBoard).show(
            board,
            white_bottom=self.side == "white",
            last_move=last,
            interactive=self._can_move(),
        )
        status = Text(
            status_text(self.values, human=self.human, running=self.running, failed=self.failed)
        )
        if error := self.values.get("error"):
            status.append(f"\n{error}", style="red")
        self.query_one("#status", Static).update(status)
        self.query_one("#details", Static).update(ply_details(self.values))
        self.query_one("#moves", Static).update(move_list(self.values))
        self.query_one("#analysis", Static).update(self.analysis)
        self._show_clock()

    def _show_clock(self) -> None:
        if self.clock is None:
            return
        now = self.monotonic()
        sides: tuple[Side, Side] = ("white", "black")
        self.query_one("#clock", Static).update(
            "   ".join(
                f"{'▸' if self.clock.running == s else ' '} {s.capitalize()} "
                f"{clock_text(left(self.clock, s, now))}"
                for s in sides
            )
        )

    def _tick(self) -> None:
        self._show_clock()
        if self.clock is None or self.values.get("outcome") is not None:
            return
        if (side := flagged(self.clock, self.monotonic())) is None:
            return
        self.clock = stop(self.clock, self.monotonic())
        self.running = True
        runs = self.workers.cancel_group(self, RUN)
        self.run_worker(self._flag(side, runs, self.thread), group=RUN)

    async def _flag(self, side: Side, runs: Sequence[Worker], thread: str) -> None:
        """The agent's run is cancelled first; a move it committed in time still counts."""
        for run in runs:
            with contextlib.suppress(WorkerCancelled, WorkerFailed):
                await run.wait()
        assert self.clock is not None
        config: RunnableConfig = run_config("tui", thread, self.settings)
        values = dict((await self.agent.aget_state(config)).values)
        if values.get("outcome") is None and _to_move(values) == side:
            await self.agent.ainvoke(flag_input(self.clock, side, self.monotonic()), config)
            values = dict((await self.agent.aget_state(config)).values)
        self.values = values
        self.clock = settled(None, self.clock, self.values, human=self.side, now=self.monotonic())
        self.running = False
        self._refresh()

    # ---- actions ------------------------------------------------------------------------------

    def action_new_game(self) -> None:
        runs = self.workers.cancel_group(self, RUN)
        if self.thread:
            self.run_worker(self._forget(self.thread, runs))
        self.thread = f"tui-{uuid.uuid4()}"
        self.values, self.running, self.failed, self.analysis = {}, False, None, ""
        self.clock = new_clock(self.time_control) if self.time_control is not None else None
        self._refresh()
        if self.side == "black":
            self.action_start()

    def action_switch_sides(self) -> None:
        self.side = "black" if self.side == "white" else "white"
        self.action_new_game()

    def action_start(self) -> None:
        board = board_of(self.values)
        if self.running or self._pending() or self.values.get("moves") or board.turn == self.human:
            return
        self._submit({"messages": [_human("go")]})

    def action_retry(self) -> None:
        if not self.running and self._pending():
            self._submit({})

    def on_input_submitted(self, event: Input.Submitted) -> None:
        text = event.value.strip()
        event.input.value = ""
        self.query_one("#board", ChessBoard).focus()
        if text:
            self._play(text)

    def on_chess_board_moved(self, message: ChessBoard.Moved) -> None:
        self._play(message.uci)

    def on_chess_board_typed(self, message: ChessBoard.Typed) -> None:
        field = self.query_one("#move", Input)
        field.focus()
        field.insert_text_at_cursor(message.character)

    def _play(self, text: str) -> None:
        if self.clock is not None and flagged(self.clock, self.monotonic()) is not None:
            self._tick()  # the timer may not have fired yet; a flag that fell can't move
            return
        if self.running or self._pending() or self.values.get("outcome") is not None:
            self.notify("Wait for the agent, or retry its failed move.", severity="warning")
            return
        if board_of(self.values).turn != self.human:
            self.notify("It's the agent's move.", severity="warning")
            return
        self._submit({"messages": [_human(text)]}, human_moved=True)

    # ---- runs ---------------------------------------------------------------------------------

    def _submit(self, payload: dict[str, Any], *, human_moved: bool = False) -> None:
        if self.clock is not None:
            now = self.monotonic()
            self.before = self.clock if human_moved else None
            clock = moved(self.clock, self.side, now) if human_moved else stop(self.clock, now)
            payload = {**payload, "clock": sent(clock, now)}
            self.clock = start(clock, self.agent_side, now)
        self.running, self.failed, self.analysis = True, None, ""
        self._refresh()
        self.run_worker(self._invoke(payload, self.thread), group=RUN)

    async def _invoke(self, payload: dict[str, Any], thread: str) -> None:
        config: RunnableConfig = run_config("tui", thread, self.settings)
        try:
            async for mode, chunk in self.agent.astream(
                payload, config, stream_mode=["messages", "values"]
            ):
                if mode == "values":
                    self.values = dict(cast("dict[str, Any]", chunk))
                    self._refresh()
                    continue
                message, metadata = cast("tuple[Any, dict[str, Any]]", chunk)
                if metadata.get("langgraph_node") == "model":
                    self.analysis += text_of(message)
                    self.query_one("#analysis", Static).update(self.analysis)
        except Exception as e:  # the turn stays pending; retry resumes it
            self.failed = str(e) or type(e).__name__
        self.values = dict((await self.agent.aget_state(config)).values)
        if self.clock is not None:
            now = self.monotonic()
            self.clock = settled(self.before, self.clock, self.values, human=self.side, now=now)
        self.running = False
        self._refresh()

    async def _forget(self, thread: str, runs: Sequence[Worker]) -> None:
        """Nothing reopens a retired game; drop it once its runs have unwound."""
        for run in runs:
            with contextlib.suppress(WorkerCancelled, WorkerFailed):
                await run.wait()
        await self.checkpointer.adelete_thread(thread)


def _to_move(values: dict[str, Any]) -> Side:
    return "white" if board_of(values).turn == chess.WHITE else "black"


def _human(content: str) -> dict[str, Any]:
    return {"type": "human", "id": str(uuid.uuid4()), "content": content}
