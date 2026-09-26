"""The UCI engine: an in-process adapter around a chess agent.

State machine: idle → searching → idle, with at most one search. Each search has an id, an
immutable root position, a deadline, and exactly one completion path, so `bestmove` is printed
once per `go`. Lifecycle changes are serialized: option rebuilds wait for the active search to
settle, and a new `go`, `ucinewgame` or `quit` settles the old search first.
"""

import asyncio
import contextlib
import dataclasses
import itertools
import sys
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, TextIO, cast

import chess
from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph.state import CompiledStateGraph
from langgraph.types import Checkpointer

from langchain_chess.parse import text_of
from langchain_chess.rules import DrawClaims, fingerprint
from langchain_chess_cli.options import AgentOptions, run_config
from langchain_chess_cli.uci.clock import deadline_ms
from langchain_chess_cli.uci.completion import (
    RunStatus,
    SearchResult,
    complete,
    info_lines,
    root_moves,
)
from langchain_chess_cli.uci.protocol import (
    Go,
    IsReady,
    PonderHit,
    Position,
    Quit,
    SetOption,
    Stop,
    Uci,
    UciNewGame,
    Unknown,
    parse,
)

type AgentFactory = Callable[[AgentOptions, Checkpointer], CompiledStateGraph]
type Output = Callable[[str], None]

NAME = "langchain-chess"
AUTHOR = "Dariel Dato-on"
DRAW_CLAIMS: DrawClaims = "never"
"""The GUI adjudicates draws."""


@dataclass(frozen=True, slots=True)
class Option:
    """One UCI option: its declaration and how its value lands on `AgentOptions`."""

    field: str
    declaration: str
    convert: Callable[[str], Any]


def _choice(*values: str) -> Callable[[str], str]:
    def convert(value: str) -> str:
        if value not in values:
            msg = f"expected one of {', '.join(values)}"
            raise ValueError(msg)
        return value

    return convert


def _effort(value: str) -> str | None:
    """`default` sends no effort, so the model uses its own (and non-reasoners work)."""
    effort = _choice("default", "low", "medium", "high")(value)
    return None if effort == "default" else effort


def _unit(value: str) -> float:
    number = float(value)
    if not 0.0 <= number <= 1.0:
        msg = "expected a number within 0..1"
        raise ValueError(msg)
    return number


def _spin(low: int, high: int) -> Callable[[str], int]:
    def convert(value: str) -> int:
        number = int(value)
        if not low <= number <= high:
            msg = f"expected an integer within {low}..{high}"
            raise ValueError(msg)
        return number

    return convert


def uci_options(defaults: AgentOptions) -> dict[str, Option]:
    """Keyed by lowercase name; UCI option names are case-insensitive."""
    d = defaults
    options = [
        Option("model", f"option name Model type string default {d.model}", str),
        Option(
            "reasoning_effort",
            f"option name ReasoningEffort type combo default {d.reasoning_effort or 'default'}"
            " var default var low var medium var high",
            _effort,
        ),
        Option(
            "systemone_model",
            f"option name SystemOneModel type string default {d.systemone_model}",
            str,
        ),
        Option(
            "policy",
            f"option name Policy type combo default {d.policy} var llm var systemone var hybrid",
            _choice("llm", "systemone", "hybrid"),
        ),
        Option("threshold", f"option name Threshold type string default {d.threshold}", _unit),
        Option("k", f"option name K type spin default {d.k} min 1 max 255", _spin(1, 255)),
        Option(
            "memory",
            f"option name Memory type combo default {d.memory} var none var summarize",
            _choice("none", "summarize"),
        ),
        Option(
            "seed",
            f"option name Seed type spin default {d.seed} min 0 max 2147483647",
            _spin(0, 2**31 - 1),
        ),
    ]
    return {o.declaration.split()[2].lower(): o for o in options}


@dataclass(eq=False)
class Search:
    id: int
    position: Position
    go: Go
    request: str
    pool: tuple[str, ...]
    held: bool
    """`go infinite` / `go ponder`: the result waits for `stop` or `ponderhit`."""
    task: asyncio.Task[None] | None = None
    runner: asyncio.Task[None] | None = None
    timer: asyncio.TimerHandle | None = None
    status: RunStatus = "finished"
    error: str | None = None
    done: bool = False
    settled: bool = False
    lines: list[str] = field(default_factory=list)


class Engine:
    def __init__(
        self,
        factory: AgentFactory,
        options: AgentOptions | None = None,
        *,
        out: Output,
        checkpointer: BaseCheckpointSaver | None = None,
    ) -> None:
        self._factory = factory
        self._options = options or AgentOptions()
        self._declared = uci_options(self._options)
        self._checkpointer = checkpointer or InMemorySaver()
        self._agent = factory(self._options, self._checkpointer)
        self._out = out
        self._queued: dict[str, Any] = {}
        self._position = Position()
        self._thread = self._new_thread()
        self._search: Search | None = None
        self._ids = itertools.count(1)
        self._settle_lock = asyncio.Lock()
        self.quitting = False

    @property
    def options(self) -> AgentOptions:
        return self._options

    # ---- plumbing -----------------------------------------------------------------------------

    @staticmethod
    def _new_thread() -> str:
        return f"uci-{uuid.uuid4()}"

    def _config(self) -> RunnableConfig:
        return run_config("uci", self._thread, self._options, draw_claims=DRAW_CLAIMS)

    def _info(self, text: str) -> None:
        for line in info_lines(text):
            self._out(line)

    def _apply_queued(self) -> None:
        if not self._queued:
            return
        options = dataclasses.replace(self._options, **self._queued)
        self._queued = {}
        try:
            agent = self._factory(options, self._checkpointer)
        except Exception as e:  # the options and the agent change together, or not at all
            self._info(f"options not applied: {e}")
            return
        self._options, self._agent = options, agent

    async def _replace_thread(self) -> None:
        """Only with no search outstanding: nothing can reopen the old game, so drop it."""
        old, self._thread = self._thread, self._new_thread()
        await self._checkpointer.adelete_thread(old)

    # ---- commands -----------------------------------------------------------------------------

    async def handle(self, line: str) -> None:
        command = parse(line)
        match command:
            case Uci():
                self._out(f"id name {NAME}")
                self._out(f"id author {AUTHOR}")
                for option in self._declared.values():
                    self._out(option.declaration)
                self._out("uciok")
            case IsReady():
                # During a search, answer at once; queued options apply once it settles.
                if self._search is None:
                    self._apply_queued()
                self._out("readyok")
            case SetOption(name=name, value=value):
                self._set_option(name, value)
            case UciNewGame():
                await self._retire()
                await self._replace_thread()
            case Position() as position:
                self._position = position
            case Go() as go:
                await self._retire()
                self._apply_queued()
                await self._start(go)
            case Stop():
                if self._search is not None:
                    await self._release(self._search)
            case PonderHit():
                if self._search is not None and self._search.held:
                    await self._ponderhit(self._search)
            case Quit():
                await self._retire()
                self.quitting = True
            case _:
                if isinstance(command, Unknown) and command.line.strip():
                    self._info(f"unknown command: {command.line}")

    def _set_option(self, name: str, value: str | None) -> None:
        option = self._declared.get(name.lower())
        if option is None:
            self._info(f"unknown option: {name}")
            return
        try:
            converted = option.convert(value if value is not None else "")
        except ValueError as e:
            self._info(f"invalid value for {name}: {e}")
            return
        self._queued[option.field] = converted
        if self._search is None:
            self._apply_queued()

    # ---- searches -----------------------------------------------------------------------------

    async def _thread_extends(self, position: Position) -> bool:
        values = (await self._agent.aget_state(self._config())).values
        root = values.get("start_fen")
        if root is None:
            return True
        moves = list(values.get("moves") or [])
        same_root = _normal_fen(position.start_fen) == _normal_fen(root)
        return same_root and list(position.moves[: len(moves)]) == moves

    async def _start(self, go: Go) -> None:
        position = self._position
        if not await self._thread_extends(position):
            # A takeback or a new game without `ucinewgame`: start a new thread.
            await self._replace_thread()
        restrict = None
        if go.searchmoves is not None:
            legal = set(root_moves(position.start_fen, position.moves, None))
            dropped = [u for u in go.searchmoves if u not in legal]
            if dropped:
                self._info(f"ignoring illegal searchmoves: {' '.join(dropped)}")
            # Never widen: an empty restriction is rejected by the agent.
            restrict = [u for u in go.searchmoves if u in legal]
        command: dict[str, Any] = {"start_fen": position.start_fen, "moves": list(position.moves)}
        if restrict is not None:
            command["restrict"] = restrict
        search = Search(
            id=next(self._ids),
            position=position,
            go=go,
            request=fingerprint(position.start_fen, position.moves, restrict),
            pool=tuple(root_moves(position.start_fen, position.moves, restrict)),
            held=go.infinite or go.ponder,
        )
        self._search = search
        search.task = asyncio.create_task(self._think(search, {"position": command}))
        search.runner = asyncio.create_task(self._supervise(search))
        self._arm(search)

    def _arm(self, search: Search) -> None:
        white = _white_to_move(search.position)
        if (limit := deadline_ms(search.go, white_to_move=white)) is not None:
            loop = asyncio.get_running_loop()
            search.timer = loop.call_later(limit / 1000, self._expire, search)

    def _expire(self, search: Search) -> None:
        assert search.task is not None
        search.task.cancel()  # a no-op once the task has finished

    async def _ponderhit(self, search: Search) -> None:
        """The ponder search becomes a normal one, on its own clock."""
        search.held = False
        search.go = dataclasses.replace(search.go, ponder=False, infinite=False)
        if search.done:
            await self._settle(search)
        else:
            self._arm(search)

    async def _think(self, search: Search, payload: dict[str, Any]) -> None:
        buffer = ""
        async for item in self._agent.astream(payload, self._config(), stream_mode="messages"):
            chunk, metadata = cast("tuple[Any, dict[str, Any]]", item)
            if search.settled or metadata.get("langgraph_node") != "model":
                continue
            buffer += text_of(chunk)
            *complete_lines, buffer = buffer.split("\n")
            for line in complete_lines:
                self._info(line)
        if buffer.strip() and not search.settled:
            self._info(buffer)

    async def _supervise(self, search: Search) -> None:
        assert search.task is not None
        try:
            await search.task
        except asyncio.CancelledError:
            search.status = "cancelled"
        except Exception as e:  # every failure still owes a bestmove
            search.status, search.error = "failed", str(e) or type(e).__name__
        search.done = True
        if search.timer is not None:
            search.timer.cancel()
        if not search.held:
            await self._settle(search)

    async def _settle(self, search: Search) -> None:
        async with self._settle_lock:
            if search.settled:
                return
            search.settled = True
            values = (await self._agent.aget_state(self._config())).values
            result = SearchResult(
                request=search.request,
                status=search.status,
                error=search.error,
                pool=search.pool,
                seed=f"{self._options.seed}:{search.request}",
            )
            for line in complete(values, result):
                self._out(line)
            # A new search starts only after the old one settles, so this is the current one.
            self._search = None
            self._apply_queued()

    async def _release(self, search: Search) -> None:
        """Cancel and settle through the single completion path, releasing a held result."""
        search.held = False
        assert search.task is not None
        assert search.runner is not None
        search.task.cancel()  # a no-op once the task has finished
        await search.runner
        await self._settle(search)

    async def _retire(self) -> None:
        if self._search is not None:
            await self._release(self._search)


def _normal_fen(fen: str) -> str:
    try:
        return chess.Board(fen).fen()
    except ValueError:
        return fen


def _white_to_move(position: Position) -> bool:
    try:
        board = chess.Board(position.start_fen)
    except ValueError:
        return True
    return (board.turn == chess.WHITE) == (len(position.moves) % 2 == 0)


async def run(engine: Engine, stdin: TextIO | None = None) -> None:
    """Read commands until `quit` or end of input. Only protocol output goes to stdout."""
    stdin = stdin or sys.stdin
    loop = asyncio.get_running_loop()
    while not engine.quitting:
        line = await loop.run_in_executor(None, stdin.readline)
        if not line:
            await engine.handle("quit")
            break
        await engine.handle(line.strip())
    with contextlib.suppress(Exception):
        sys.stdout.flush()
