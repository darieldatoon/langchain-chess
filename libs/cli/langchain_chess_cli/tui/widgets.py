"""The game screen's widgets around the board: player strips, the move list and Last Reply.

Each one renders what the app hands it; the words come from `view` and `reply`. Text from the
model, errors and SAN go in as plain `Content`, never as markup.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from time import monotonic
from typing import TYPE_CHECKING, Any, ClassVar, cast

import chess
from textual import events
from textual.app import ComposeResult
from textual.binding import Binding, BindingType
from textual.containers import Horizontal, Vertical, VerticalScroll
from textual.content import Content
from textual.message import Message
from textual.widget import Widget
from textual.widgets import Button, Markdown, Static

from langchain_chess import turn_cost
from langchain_chess_cli.tui.board import ChessBoard, geometry
from langchain_chess_cli.tui.reply import (
    GameSoFar,
    Pending,
    Played,
    ReplyState,
    StageStatus,
    cost_text,
    gate_line,
    llm_notes,
    move_heading,
    pace_ratio,
    percent,
    rank_note,
    seconds,
    so_far_line,
    source_label,
    sources_line,
    stage_stats,
    stage_statuses,
    stat_text,
    systemone_meta,
)
from langchain_chess_cli.tui.theme import DARK_BOARD
from langchain_chess_cli.tui.view import MoveRow

if TYPE_CHECKING:
    from textual.timer import Timer

# ---- strips -------------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class Say:
    """Plain words on the strip's right, e.g. "Your turn" or "Won"."""

    text: str
    bold: bool = False


@dataclass(frozen=True, slots=True)
class Thinking:
    """Thinking, with the seconds since `since` (`time.monotonic`)."""

    since: float


@dataclass(frozen=True, slots=True)
class Act:
    """A button: Start, Ask opponent to move, or Retry."""

    label: str
    action: str
    primary: bool


type Status = Say | Thinking | Act | None


class PlayerStrip(Horizontal):
    """One line on the board's edge: who plays this side, what they're up, and a status."""

    DEFAULT_CSS = """
    PlayerStrip { height: 1; }
    PlayerStrip > .name { width: 1fr; }
    PlayerStrip > .status { width: auto; }
    PlayerStrip > Button { width: auto; min-width: 0; margin-left: 1; }
    """

    def __init__(self, *, id: str | None = None) -> None:
        super().__init__(id=id)
        self._status: Status = None
        self._ticker: Timer | None = None

    def compose(self) -> ComposeResult:
        yield Static(classes="name")
        yield Static(classes="status")

    def show(self, *, side: str, name: str, material: str, status: Status) -> None:
        dot = "○" if side == "white" else "●"
        self.query_one(".name", Static).update(
            Content.assemble(
                (f"{dot} ", "$text-muted"), (name, "bold"), (f"  {material}" if material else "")
            )
        )
        if status == self._status:
            return
        self._status = status
        for button in self.query(Button):
            button.remove()
        if self._ticker is not None:
            self._ticker.stop()
            self._ticker = None
        if isinstance(status, Act):
            self.mount(
                Button(
                    status.label,
                    variant="primary" if status.primary else "default",
                    compact=True,
                    action=status.action,
                )
            )
        if isinstance(status, Thinking):
            self._ticker = self.set_interval(1, self._tick)
        self._tick()

    def _tick(self) -> None:
        status = self._status
        label = self.query_one(".status", Static)
        if isinstance(status, Say):
            label.update(Content.styled(status.text, "bold" if status.bold else "$text-muted"))
        elif isinstance(status, Thinking):
            elapsed = int(monotonic() - status.since)
            label.update(Content.styled(f"Thinking… {elapsed}s", "$primary"))
        else:
            label.update("")


class BoardColumn(Vertical):
    """The board with a strip on each edge, all sized to the largest board that fits."""

    DEFAULT_CSS = """
    BoardColumn { align-horizontal: center; padding: 0 1; }
    BoardColumn > ChessBoard { width: auto; height: auto; }
    """

    def on_resize(self, event: events.Resize) -> None:
        self.fit()

    def fit(self) -> None:
        board = self.query_one(ChessBoard)
        # The parent's visible height, not the column's own: stacked, the column is as tall as
        # the board it holds.
        room = cast("Widget", self.parent).scrollable_content_region.height
        geo = geometry(self.content_size.width, room - 2, white_bottom=board.state.white_bottom)
        board.styles.width, board.styles.height = geo.width, geo.height
        for strip in self.query(PlayerStrip):
            strip.styles.width = geo.width


# ---- the move list ------------------------------------------------------------------------------

CELL = 9
"""A move's cell: the longest SAN (`exd8=Q+`) and a space either side."""


def _colors(variables: Mapping[str, str], name: str) -> str:
    return variables.get(name, DARK_BOARD[name])


def move_cell(
    entry: Any, selected: int | None, variables: Mapping[str, str], marks: frozenset[int]
) -> Content:
    """A move as its own button: coloured by who played it, filled when it's on the board."""
    if entry is None:
        return Content(" " * CELL)
    text = f" {entry.san}{' ½?' if entry.ply in marks else ''}".ljust(CELL)
    if entry.ply == selected:
        fg, bg = _colors(variables, "move-active-text"), _colors(variables, "move-active")
        style = f"bold {fg} on {bg}"
    elif entry.source in ("systemone", "llm", "forced"):
        fg = _colors(variables, f"move-{entry.source}-text")
        style = f"{fg} on {_colors(variables, f'move-{entry.source}')}"
    else:
        style = ""
    return Content.styled(text, f"{style} @click=app.go({entry.ply + 1})".strip())


class MoveList(VerticalScroll, can_focus=True):
    """Three columns: number, White, Black. Click a move, or step with the arrow keys."""

    DEFAULT_CSS = """
    MoveList { height: 1fr; scrollbar-size-vertical: 1; }
    MoveList:focus { background-tint: $foreground 4%; }
    MoveList #move-rows { link-style: none; link-style-hover: bold; link-background-hover: $boost; }
    """
    BINDINGS: ClassVar[list[BindingType]] = [
        Binding("left,up", "app.step(-1)", "Back", show=False),
        Binding("right,down", "app.step(1)", "Forward", show=False),
        Binding("home", "app.go(0)", "First move", show=False),
        Binding("end", "app.go_live", "Last move", show=False),
    ]

    def __init__(self, *, id: str | None = None) -> None:
        super().__init__(id=id)
        self._shown: tuple[Any, ...] = ()

    def compose(self) -> ComposeResult:
        yield Static(id="opening")
        yield Static(id="move-rows")
        yield Static(id="result")

    def on_mount(self) -> None:
        self.app.theme_changed_signal.subscribe(self, lambda _theme: self._draw())

    def show(
        self,
        rows: Sequence[MoveRow],
        *,
        selected: int | None,
        opening: str | None,
        result: Content | None,
        draws: frozenset[int],
    ) -> None:
        """`selected` is the ply on the board, or None at the start; `draws` the plies after
        which a draw was offered (-1 before the first move)."""
        shown = (tuple(rows), selected, opening, result, draws)
        if shown == self._shown:
            return
        before = _ply_count(self._shown[0]) if self._shown else None
        at_end = self._latest_in_view()
        self._shown = shown
        self._draw()
        if before is not None and _ply_count(rows) > before:
            # A move arriving follows the end only while the reader is there; it never moves a
            # reader who scrolled away, or one browsing an earlier move.
            if at_end and selected == _ply_count(rows) - 1:
                self.scroll_end(animate=False)
        elif selected is not None:
            self.call_after_refresh(self._center, selected)

    def _draw(self) -> None:
        if not self._shown:
            return
        rows, selected, opening, result, draws = self._shown
        variables = self.app.theme_variables
        heading = self.query_one("#opening", Static)
        heading.update(Content.styled(opening, "$text-muted") if opening else "")
        heading.display = opening is not None
        lines = [
            Content.assemble(
                (f"{number:>3} ", "$text-muted"),
                move_cell(white, selected, variables, draws)
                if white
                else Content(" …".ljust(CELL)),
                move_cell(black, selected, variables, draws),
            )
            for number, white, black in rows
        ]
        before = [Content.styled(" ½?", "$text-muted")] if -1 in draws else []
        empty = [Content.styled("No moves yet.", "$text-muted")] if not rows else []
        self.query_one("#move-rows", Static).update(Content("\n").join(before + empty + lines))
        self.query_one("#result", Static).update(result or "")

    def _latest_in_view(self) -> bool:
        """Whether the reader can see the last move: arrivals follow only then."""
        if not self._shown or not self._shown[0]:
            return True
        y = self._line_of(len(self._shown[0]) - 1)
        return self.scroll_y <= y < self.scroll_y + self.size.height

    def _line_of(self, row: int) -> int:
        """The move row's line in the list, as laid out: the opening heading can wrap."""
        rows = self.query_one("#move-rows", Static)
        before = 1 if -1 in self._shown[4] else 0
        return rows.virtual_region.y + before + row

    def _center(self, ply: int) -> None:
        rows = self._shown[0]
        index = next((i for i, (_, w, b) in enumerate(rows) if ply in _plies(w, b)), 0)
        self.scroll_to(y=max(0, self._line_of(index) - self.size.height // 2), animate=False)


def _plies(*entries: Any) -> set[int]:
    return {e.ply for e in entries if e is not None}


def _ply_count(rows: Sequence[MoveRow]) -> int:
    return sum(len(_plies(white, black)) for _, white, black in rows)


# ---- Last Reply ---------------------------------------------------------------------------------

NUMBERS = ("①", "②")
STATUS_MARKS: Mapping[StageStatus, tuple[str, str]] = {
    "waiting": ("Waiting", "$text-muted"),
    "running": ("…", "$primary"),
    "done": ("✓", "$success"),
    "skipped": ("Skipped", "$text-muted"),
    "not-needed": ("Not needed", "$text-muted"),
    "failed": ("Failed", "$error"),
}
BAR = 14


class Stage(Vertical):
    """A stage's one-line header, which opens and closes it, and its body."""

    DEFAULT_CSS = """
    Stage { height: auto; margin-top: 1; }
    Stage > .stage-head { pointer: pointer; }
    Stage > .stage-body { height: auto; padding-left: 2; }
    """

    class Toggled(Message):
        def __init__(self, stage: str) -> None:
            super().__init__()
            self.stage = stage

    def __init__(self, *body: Widget, stage: str) -> None:
        super().__init__(id=f"stage-{stage}")
        self.stage = stage
        self._body = body

    def compose(self) -> ComposeResult:
        yield Static(classes="stage-head")
        with Vertical(classes="stage-body"):
            yield from self._body

    def show(self, head: Content, *, open: bool) -> None:
        self.query_one(".stage-head", Static).update(Content.assemble("▼ " if open else "▶ ", head))
        self.query_one(".stage-body").display = open

    def on_click(self, event: events.Click) -> None:
        if event.widget is not None and event.widget.has_class("stage-head"):
            self.post_message(self.Toggled(self.stage))


def _figures(status: StageStatus, stat: Any) -> str:
    if status == "not-needed" or stat is None:
        return ""
    return "…" if status in ("waiting", "running") else stat_text(stat)


def stage_head(
    number: str, name: str, model: str | None, status: StageStatus, stat: Any, width: int
) -> Content:
    """E.g. "① LLM · model    2.2 s · $0.0002 ✓", with the figures flush right."""
    mark, style = STATUS_MARKS[status]
    right = Content.assemble(_figures(status, stat), " ", (mark, style))
    left = Content.assemble((f"{number} {name}", "bold"), (f" · {model}" if model else "", ""))
    room = max(1, width - right.cell_length - 3)
    left = left.truncate(room, ellipsis=True)
    return Content.assemble(left, " " * max(1, room - left.cell_length + 1), right)


def bars(
    ranking: Sequence[Mapping[str, Any]],
    fen: str,
    played: str | None,
    extra: Mapping[str, Any] | None,
) -> Content:
    """System 1's top moves as probability bars; the played move in green, and outside the top
    moves after a `…`."""
    board = chess.Board(fen)

    def line(move: Mapping[str, Any]) -> Content:
        uci = chess.Move.from_uci(move["uci"])
        # `board.san` writes nonsense for an illegal move rather than raising.
        san = board.san(uci) if uci in board.legal_moves else move["uci"]
        filled = round(move["probability"] * BAR)
        mine = move["uci"] == played
        return Content.assemble(
            (san.ljust(7), "bold" if mine else ""),
            ("█" * filled, "$success" if mine else "$primary"),
            ("█" * (BAR - filled), "$panel"),
            (percent(move["probability"]).rjust(5), "$text-muted"),
        )

    lines = [Content.styled("System 1's top moves", "$text-muted"), *map(line, ranking)]
    if extra is not None:
        lines += [Content.styled("…", "$text-muted"), line(extra)]
    if not ranking:
        lines = [Content.styled("No System 1 moves.", "$text-muted")]
    return Content("\n").join(lines)


def _extra(ply: Mapping[str, Any], ranking: Sequence[Mapping[str, Any]]) -> Any:
    """The played move outside the top moves, unless it never reached the final."""
    meta = systemone_meta(ply)
    results = (meta or {}).get("played_move_result") or []
    played = results[-1] if results else None
    if any(m["uci"] == ply["uci"] for m in ranking) or played is None:
        return None
    if played["heat"] is not None or played["bye"]:
        return None
    return {"uci": ply["uci"], "probability": played["probability"]}


class ReplyPanel(VerticalScroll):
    """The agent's turn stage by stage: System 1's moves, why the LLM was called, its analysis
    as Markdown, and the game so far."""

    DEFAULT_CSS = """
    ReplyPanel { padding: 0 1; border: round $border; border-title-color: $text-muted; }
    ReplyPanel #analysis { margin: 0; padding: 0 1; background: $panel; }
    ReplyPanel #analysis > MarkdownBlock { margin: 0; }
    ReplyPanel #so-far { margin-top: 1; border-top: solid $border; }
    """

    def __init__(self, *, id: str | None = None) -> None:
        super().__init__(id=id)
        self._analysis = ""
        """What the Markdown shows; `_wanted` is what it should."""
        self._wanted = ""
        self._writing = False
        self._shown: tuple[Any, ...] | None = None

    def on_resize(self, event: events.Resize) -> None:
        # The header and stage lines are laid out to the panel's width.
        if self._shown is not None:
            reply, title, open_stages, game = self._shown
            self.show(reply, title=title, open_stages=open_stages, game=game)

    def compose(self) -> ComposeResult:
        yield Static(id="reply-head")
        yield Stage(Static(id="systemone-body"), stage="systemone")
        yield Stage(Markdown(id="analysis"), Static(id="llm-notes"), stage="llm")
        yield Static(id="so-far")

    def show(
        self,
        reply: ReplyState,
        *,
        title: str,
        open_stages: Mapping[str, bool],
        game: GameSoFar | None,
    ) -> None:
        self._shown = (reply, title, open_stages, game)
        self.border_title = title
        width = self.scrollable_content_region.width or 40
        head = self.query_one("#reply-head", Static)
        systemone, llm = self.query_one("#stage-systemone", Stage), self.query_one("#stage-llm")
        self.query_one("#so-far", Static).update(_so_far(game, reply))
        if reply is None:
            head.update(Content.styled("No reply yet.", "$text-muted"))
            systemone.display = llm.display = False
            return
        head.update(_header(reply, width))
        systemone_status, llm_status = stage_statuses(reply)
        stats = stage_stats(reply)
        meta = reply.systemone if isinstance(reply, Pending) else systemone_meta(reply.ply)
        ranking = (meta.get("top") or meta["shortlist"]) if meta else []
        systemone.display = systemone_status is not None
        if systemone_status is not None:
            systemone.show(
                stage_head(
                    "①",
                    "System 1",
                    meta["model"] if meta else None,
                    systemone_status,
                    stats.systemone,
                    width,
                ),
                open=open_stages["systemone"],
            )
            self.query_one("#systemone-body", Static).update(
                _systemone_body(reply, systemone_status, meta, ranking)
            )
        llm.display = llm_status is not None
        if llm_status is not None:
            assert isinstance(llm, Stage)
            number = NUMBERS[1] if systemone_status else NUMBERS[0]
            llm.show(
                stage_head(number, "LLM", _llm_model(reply), llm_status, stats.llm, width),
                open=open_stages["llm"],
            )
            self._show_analysis(_analysis_text(reply, llm_status))
            self.query_one("#llm-notes", Static).update(
                Content.styled(_notes(reply, llm_status, ranking, stats) or "", "$text-muted")
            )

    def _show_analysis(self, text: str) -> None:
        self._wanted = text
        if not self._writing:
            self._writing = True
            self.run_worker(self._write_analysis(), group="analysis")

    async def _write_analysis(self) -> None:
        """One Markdown write at a time, each awaited: `append` builds on what the last write
        rendered, so writes left to race render text twice. The latest text wins."""
        markdown = self.query_one("#analysis", Markdown)
        try:
            while self._analysis != self._wanted:
                text = self._wanted
                if self._analysis and text.startswith(self._analysis):
                    await markdown.append(text[len(self._analysis) :])
                else:
                    await markdown.update(text)
                self._analysis = text
        finally:
            self._writing = False


def _header(reply: Played | Pending, width: int) -> Content:
    if isinstance(reply, Played):
        right = Content(
            f"{seconds(reply.ply['latency_ms'])} · "
            f"{cost_text(turn_cost(reply.turn['calls'])) if reply.turn else '—'}"
        )
        source = Content.assemble(
            (f" {source_label(reply.ply['source'])} ", _badge(reply.ply["source"])),
            " ",
            (reply.ply["san"], "bold"),
        )
    else:
        right = Content.styled("Thinking…", "$primary") if reply.running else Content("Stopped")
        source = Content("")
    left = Content(move_heading(reply.fen_before))
    gap = " " * max(1, width - left.cell_length - right.cell_length)
    return Content("\n").join([Content.assemble(left, gap, right), source])


def _badge(source: str) -> str:
    return {
        "systemone": "$text-primary on $primary-muted",
        "llm": "$text-accent on $accent-muted",
        "forced": "$text-muted on $panel",
    }.get(source, "$text-warning on $warning-muted")


def _systemone_body(
    reply: Played | Pending,
    status: StageStatus,
    meta: Mapping[str, Any] | None,
    ranking: Sequence[Mapping[str, Any]],
) -> Content:
    if status in ("waiting", "running"):
        return Content.styled("Ranking the moves…", "$text-muted")
    if status == "failed":
        error = reply.error if isinstance(reply, Pending) else None
        return Content.styled(
            f"System 1 didn't finish: {error}" if error else "System 1 didn't finish.", "$error"
        )
    if meta is None:
        return bars([], reply.fen_before, None, None)
    if meta["status"] == "skipped":
        return Content.styled(
            f"System 1 skipped: {meta.get('error') or 'no reason given'}", "$error"
        )
    played = reply.ply["uci"] if isinstance(reply, Played) else None
    extra = _extra(reply.ply, ranking) if isinstance(reply, Played) else None
    lines = [bars(ranking, reply.fen_before, played, extra)]
    if reply.stages.llm:
        board = chess.Board(reply.fen_before)
        top = ranking[0]["uci"] if meta["status"] == "played" and ranking else None
        gate = gate_line(meta, board.san(chess.Move.from_uci(top)) if top else None)
        if gate:
            lines.append(Content.styled(gate, "$text-muted"))
    return Content("\n").join(lines)


def _llm_model(reply: Played | Pending) -> str | None:
    if isinstance(reply, Played) and reply.ply["source"] == "llm" and reply.ply["model"]:
        return reply.ply["model"]
    calls = reply.turn["calls"] if reply.turn else []
    return next((c["model"] for c in calls if c["kind"] == "llm"), None)


def _analysis_text(reply: Played | Pending, status: StageStatus) -> str:
    if status == "not-needed":
        return ""
    text = reply.analysis if isinstance(reply, Pending) else reply.ply.get("analysis")
    if text:
        return text
    if status in ("running", "waiting"):
        return "*Thinking…*"
    return "*No analysis before it stopped.*" if status == "failed" else "*No analysis.*"


def _notes(
    reply: Played | Pending,
    status: StageStatus,
    ranking: Sequence[Mapping[str, Any]],
    stats: Any,
) -> str | None:
    if status == "not-needed":
        return None
    played = reply if isinstance(reply, Played) else None
    rank = rank_note(ranking, played.ply["uci"], played.ply["san"]) if played and ranking else None
    calls = reply.turn["calls"] if reply.turn else []
    return llm_notes(
        error=reply.error if isinstance(reply, Pending) and status == "failed" else None,
        illegal_attempts=reply.turn["illegal_attempts"] if reply.turn else 0,
        san=played.ply["san"] if played else None,
        rank=rank,
        summary_cost=stats.summary_cost,
        summarized=any(c["kind"] == "summary" for c in calls),
    )


def _so_far(game: GameSoFar | None, reply: ReplyState) -> Content:
    if game is None:
        return Content("")
    pace = (
        pace_ratio(reply.ply["latency_ms"], game)
        if isinstance(reply, Played) and reply.turn
        else None
    )
    lines = [
        Content.assemble(("Game so far  ", "bold"), cost_text(game.cost)),
        Content.styled(so_far_line(game, pace), "$text-muted"),
    ]
    if sources := sources_line(game):
        lines.append(Content.styled(sources, "$text-muted"))
    return Content("\n").join(lines)
