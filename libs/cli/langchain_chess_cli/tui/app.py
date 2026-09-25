"""`lcchess play`: a Textual game against an in-process chess agent.

Start and retry are separate actions, as in the web UI: playing Black opens with `go`; after a
failed run, retry invokes the same thread with empty input. A new game is a new thread, and a
generation counter drops late events from the previous one.
"""

import uuid
from collections.abc import Callable
from typing import TYPE_CHECKING, Any, ClassVar, Literal, cast

import chess
from langgraph.graph.state import CompiledStateGraph
from textual.app import App, ComposeResult
from textual.binding import Binding, BindingType
from textual.containers import Horizontal, Vertical
from textual.widgets import Footer, Header, Input, Static

from langchain_chess.parse import text_of
from langchain_chess_cli.options import AgentOptions
from langchain_chess_cli.tui.view import (
    board_of,
    board_text,
    describe_options,
    move_list,
    ply_details,
    status_text,
)

if TYPE_CHECKING:
    from langchain_core.runnables import RunnableConfig

type Side = Literal["white", "black"]


class ChessApp(App[None]):
    TITLE = "langchain-chess"
    CSS = """
    #top { height: auto; }
    #board { width: 30; padding: 0 1; }
    #side { width: 1fr; }
    #status { text-style: bold; margin-bottom: 1; }
    #details { margin-bottom: 1; }
    #moves { height: auto; max-height: 12; }
    #analysis { height: 1fr; border: round $secondary; padding: 0 1; }
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
        factory: Callable[[], CompiledStateGraph],
        options: AgentOptions,
        *,
        side: Side = "white",
    ) -> None:
        super().__init__()
        self.agent = factory()
        self.options = options
        self.side: Side = side
        self.thread = ""
        self.generation = 0
        self.values: dict[str, Any] = {}
        self.running = False
        self.failed: str | None = None
        self.analysis = ""

    # ---- layout -------------------------------------------------------------------------------

    def compose(self) -> ComposeResult:
        yield Header()
        with Horizontal(id="top"):
            yield Static(id="board")
            with Vertical(id="side"):
                yield Static(id="status")
                yield Static(id="details")
                yield Static(id="moves")
        yield Static(id="analysis")
        yield Input(placeholder="Your move (SAN or UCI)", id="move")
        yield Footer()

    def on_mount(self) -> None:
        self.sub_title = describe_options(self.options)
        self.action_new_game()

    @property
    def human(self) -> chess.Color:
        return chess.WHITE if self.side == "white" else chess.BLACK

    def _pending(self) -> bool:
        turns = self.values.get("turns") or []
        return bool(turns) and turns[-1]["status"] == "pending"

    def _refresh(self) -> None:
        board = board_of(self.values)
        plies = self.values.get("plies") or []
        last = plies[-1]["uci"] if plies else None
        self.query_one("#board", Static).update(
            board_text(board, white_bottom=self.side == "white", last_move=last)
        )
        status = status_text(
            self.values, human=self.human, running=self.running, failed=self.failed
        )
        if error := self.values.get("error"):
            status += f"\n[red]{error}[/]"
        self.query_one("#status", Static).update(status)
        self.query_one("#details", Static).update(ply_details(self.values))
        self.query_one("#moves", Static).update(move_list(self.values))
        self.query_one("#analysis", Static).update(self.analysis)

    # ---- actions ------------------------------------------------------------------------------

    def action_new_game(self) -> None:
        self.generation += 1
        self.thread = f"tui-{uuid.uuid4()}"
        self.values, self.running, self.failed, self.analysis = {}, False, None, ""
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
        if not text:
            return
        if self.running or self._pending() or self.values.get("outcome") is not None:
            self.notify("Wait for the agent, or retry its failed move.", severity="warning")
            return
        if board_of(self.values).turn != self.human:
            self.notify("It's the agent's move.", severity="warning")
            return
        self._submit({"messages": [_human(text)]})

    # ---- runs ---------------------------------------------------------------------------------

    def _submit(self, payload: dict[str, Any]) -> None:
        self.running, self.failed, self.analysis = True, None, ""
        self._refresh()
        self.run_worker(self._invoke(payload, self.generation, self.thread))

    async def _invoke(self, payload: dict[str, Any], generation: int, thread: str) -> None:
        config: RunnableConfig = {"configurable": {"thread_id": thread}}
        try:
            async for mode, chunk in self.agent.astream(
                payload, config, stream_mode=["messages", "values"]
            ):
                if generation != self.generation:
                    return
                if mode == "values":
                    self.values = dict(cast("dict[str, Any]", chunk))
                else:
                    message, metadata = cast("tuple[Any, dict[str, Any]]", chunk)
                    if metadata.get("langgraph_node") == "model":
                        self.analysis += text_of(message)
                self._refresh()
        except Exception as e:  # the turn stays pending; retry resumes it
            if generation == self.generation:
                self.failed = str(e) or type(e).__name__
        if generation == self.generation:
            self.values = dict((await self.agent.aget_state(config)).values)
            self.running = False
            self._refresh()


def _human(content: str) -> dict[str, Any]:
    return {"type": "human", "id": str(uuid.uuid4()), "content": content}
