"""The `lcchess` command line: `uci`, `play` and `grade`."""

import asyncio
import json
import logging
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING, Annotated, Any, Literal

import typer
from langgraph.graph.state import CompiledStateGraph
from langgraph.types import Checkpointer

from langchain_chess_cli.options import overlay
from langchain_chess_systemone.agent import build_agent
from langchain_chess_systemone.settings import ChessContext, load_file

if TYPE_CHECKING:
    from collections.abc import Callable, Coroutine

    from langsmith import Client

    from langchain_chess_cli.grade.batch import Summary

app = typer.Typer(
    name="lcchess",
    help="Play langchain-chess agents as a UCI engine or in the terminal, and grade their games.",
    no_args_is_help=True,
    add_completion=False,
)


def _setting(name: str, **extra: Any) -> Any:
    """A flag documented by its setting; left out, it keeps the setting's default."""
    default = ChessContext.model_fields[name].default
    shown = str(default).lower() if isinstance(default, bool) else str(default)
    extra.setdefault("show_default", False if default is None else shown)
    return typer.Option(help=ChessContext.model_fields[name].description, **extra)


# Typer can't read PEP 695 aliases, so the choices are spelled out here.
PolicyOption = Annotated[Literal["llm", "systemone", "hybrid"] | None, _setting("policy")]
ModelOption = Annotated[str | None, _setting("model")]
EffortOption = Annotated[Literal["low", "medium", "high"] | None, _setting("reasoning_effort")]
SystemOneOption = Annotated[str | None, _setting("systemone_model")]
ThresholdOption = Annotated[float | None, _setting("threshold", min=0.0, max=1.0)]
TournamentOption = Annotated[float | None, _setting("tournament_threshold", min=0.0, max=1.0)]
KOption = Annotated[int | None, _setting("k", min=1, max=255)]
TopPOption = Annotated[float | None, _setting("top_p", min=0.0, max=1.0)]
GateOption = Annotated[Literal["margin", "confidence"] | None, _setting("gate")]
StyleOption = Annotated[Literal["rich", "terse"] | None, _setting("style")]
SeedOption = Annotated[int | None, _setting("seed")]
MoveListOption = Annotated[
    Literal["both", "legal", "candidates", "none"] | None, _setting("move_list")
]
EvalOption = Annotated[bool | None, _setting("with_eval")]
NoulsOption = Annotated[bool | None, _setting("with_nouls")]
MemoryOption = Annotated[bool | None, _setting("memory")]
DrawClaimsOption = Annotated[Literal["auto", "never"] | None, _setting("draw_claims")]
SystemPromptOption = Annotated[str | None, _setting("system_prompt")]
FenOption = Annotated[bool | None, _setting("show_fen")]
BoardOption = Annotated[bool | None, _setting("show_board")]
ModelKwargsOption = Annotated[
    str | None, _setting("model_kwargs", metavar="JSON", show_default=False)
]


ConfigOption = Annotated[
    Path | None,
    typer.Option(
        exists=True,
        dir_okay=False,
        help="An opponent settings file (JSON); the flags given override it.",
    ),
]
ResetOption = Annotated[
    list[str] | None,
    typer.Option(help="Reset a setting from --config to its default, e.g. top_p; repeatable."),
]


def _settings(
    *,
    config: Path | None = None,
    reset: list[str] | None = None,
    model_kwargs: str | None = None,
    **flags: Any,
) -> ChessContext:
    try:
        if model_kwargs is not None:
            flags["model_kwargs"] = json.loads(model_kwargs)
        base = load_file(config) if config is not None else ChessContext()
        return overlay(base, flags, reset or ())
    except ValueError as e:
        raise typer.BadParameter(str(e)) from e


@app.command()
def uci(
    config: ConfigOption = None,
    reset: ResetOption = None,
    policy: PolicyOption = None,
    model: ModelOption = None,
    reasoning_effort: EffortOption = None,
    systemone_model: SystemOneOption = None,
    threshold: ThresholdOption = None,
    tournament_threshold: TournamentOption = None,
    k: KOption = None,
    top_p: TopPOption = None,
    gate: GateOption = None,
    style: StyleOption = None,
    seed: SeedOption = None,
    move_list: MoveListOption = None,
    with_eval: EvalOption = None,
    with_nouls: NoulsOption = None,
    memory: MemoryOption = None,
    system_prompt: SystemPromptOption = None,
    show_fen: FenOption = None,
    show_board: BoardOption = None,
    model_kwargs: ModelKwargsOption = None,
) -> None:
    """Run as a UCI engine on stdin/stdout. Only protocol output goes to stdout.

    Draws are never claimed: the GUI adjudicates them.
    """
    from langchain_chess_cli.uci.engine import Engine, run

    logging.basicConfig(stream=sys.stderr, level=logging.WARNING)
    settings = _settings(
        config=config,
        reset=reset,
        policy=policy,
        model=model,
        reasoning_effort=reasoning_effort,
        systemone_model=systemone_model,
        threshold=threshold,
        tournament_threshold=tournament_threshold,
        k=k,
        top_p=top_p,
        gate=gate,
        style=style,
        seed=seed,
        move_list=move_list,
        with_eval=with_eval,
        with_nouls=with_nouls,
        memory=memory,
        system_prompt=system_prompt,
        show_fen=show_fen,
        show_board=show_board,
        model_kwargs=model_kwargs,
    )

    def factory(agent_settings: ChessContext, checkpointer: Checkpointer) -> CompiledStateGraph:
        return build_agent(agent_settings, checkpointer=checkpointer)

    def out(line: str) -> None:
        sys.stdout.write(line + "\n")
        sys.stdout.flush()

    try:
        engine = Engine(factory, settings, out=out)
    except ValueError as e:
        raise typer.BadParameter(str(e)) from e
    asyncio.run(run(engine))


SideOption = Annotated[Literal["white", "black"], typer.Option(help="The side you play.")]


@app.command()
def play(
    side: SideOption = "white",
    config: ConfigOption = None,
    reset: ResetOption = None,
    policy: PolicyOption = None,
    model: ModelOption = None,
    reasoning_effort: EffortOption = None,
    systemone_model: SystemOneOption = None,
    threshold: ThresholdOption = None,
    tournament_threshold: TournamentOption = None,
    k: KOption = None,
    top_p: TopPOption = None,
    gate: GateOption = None,
    style: StyleOption = None,
    seed: SeedOption = None,
    move_list: MoveListOption = None,
    with_eval: EvalOption = None,
    with_nouls: NoulsOption = None,
    memory: MemoryOption = None,
    draw_claims: DrawClaimsOption = None,
    system_prompt: SystemPromptOption = None,
    show_fen: FenOption = None,
    show_board: BoardOption = None,
    model_kwargs: ModelKwargsOption = None,
) -> None:
    """Play a game in the terminal (Textual)."""
    from langchain_chess_cli.tui.app import ChessApp

    settings = _settings(
        config=config,
        reset=reset,
        policy=policy,
        model=model,
        reasoning_effort=reasoning_effort,
        systemone_model=systemone_model,
        threshold=threshold,
        tournament_threshold=tournament_threshold,
        k=k,
        top_p=top_p,
        gate=gate,
        style=style,
        seed=seed,
        move_list=move_list,
        with_eval=with_eval,
        with_nouls=with_nouls,
        memory=memory,
        draw_claims=draw_claims,
        system_prompt=system_prompt,
        show_fen=show_fen,
        show_board=show_board,
        model_kwargs=model_kwargs,
    )

    def factory(checkpointer: Checkpointer) -> CompiledStateGraph:
        return build_agent(settings, checkpointer=checkpointer)

    ChessApp(factory, settings, side=side).run()


PositiveOption = Annotated[int | None, typer.Option(min=1)]


@app.command()
def grade(
    thread: Annotated[
        list[str] | None, typer.Option(help="A thread (game) to grade; repeatable.")
    ] = None,
    threads_file: Annotated[
        Path | None,
        typer.Option(exists=True, dir_okay=False, help="Thread ids, one per line."),
    ] = None,
    project: Annotated[
        str | None, typer.Option(envvar="LANGSMITH_PROJECT", help="The tracing project.")
    ] = None,
    since: Annotated[
        datetime | None, typer.Option(help="Games with a turn at or after this (local time).")
    ] = None,
    until: Annotated[datetime | None, typer.Option(help="Games with a turn before this.")] = None,
    limit: Annotated[
        int | None, typer.Option(min=1, help="At most this many games, newest first.")
    ] = None,
    metadata: Annotated[
        list[str] | None, typer.Option(help="key=value on the runs, e.g. surface=web; repeatable.")
    ] = None,
    force: Annotated[
        bool, typer.Option(help="Re-grade games graded with the same settings.")
    ] = False,
    dry_run: Annotated[
        bool, typer.Option(help="List what would be graded; write nothing.")
    ] = False,
    engine: Annotated[
        str, typer.Option(envvar="STOCKFISH_PATH", help="A UCI engine binary.")
    ] = "stockfish",
    depth: Annotated[int | None, typer.Option(min=1, help="Search depth (default 16).")] = None,
    nodes: Annotated[
        int | None,
        typer.Option(min=1, help="Nodes per position: the same grades on any machine."),
    ] = None,
    movetime: Annotated[int | None, typer.Option(min=1, help="Milliseconds per position.")] = None,
    multipv: Annotated[int, typer.Option(min=1, help="Lines per position.")] = 1,
    engine_threads: Annotated[
        int, typer.Option(min=1, help="Per engine; more than one is nondeterministic.")
    ] = 1,
    hash_mb: Annotated[int, typer.Option("--hash", min=1, help="Hash per engine, in MB.")] = 256,
    workers: Annotated[
        int | None, typer.Option(min=1, help="Engines in parallel (default: cores / threads).")
    ] = None,
    sandbox_job: Annotated[
        bool,
        typer.Option(
            help="As the review app's Analyze job: settle each game's grade_status mark, "
            "then delete this sandbox."
        ),
    ] = False,
) -> None:
    """Grade games with a UCI engine and write the grades to their traces as feedback."""
    from langchain_chess.engine import EngineConfig, EnginePool
    from langchain_chess_cli.grade import cli, job
    from langchain_chess_cli.grade.batch import Event, Threads, grade_batch
    from langchain_chess_cli.grade.store import LangSmithStore

    try:
        chosen = cli.selection(
            project,
            cli.thread_ids(thread or [], threads_file),
            since=since,
            until=until,
            limit=limit,
            metadata=cli.metadata_pairs(metadata or []),
        )
        config = EngineConfig(
            path=engine,
            limit=cli.search_limit(depth, nodes, movetime),
            multipv=multipv,
            threads=engine_threads,
            hash_mb=hash_mb,
        )
        if sandbox_job and not isinstance(chosen, Threads):
            msg = "--sandbox-job grades the games given with --thread"
            raise cli.OptionError(msg)
    except cli.OptionError as e:
        raise typer.BadParameter(str(e)) from e

    def echo(line: str) -> None:
        typer.echo(line, err=True)

    store = LangSmithStore(make_client())

    def batch(report: "Callable[[Event], None]") -> "Coroutine[None, None, Summary]":
        return grade_batch(
            chosen,
            store,
            lambda n: EnginePool(config, n),
            workers=workers or max(1, (os.cpu_count() or 1) // engine_threads),
            force=force,
            dry_run=dry_run,
            report=report,
        )

    if isinstance(chosen, Threads) and sandbox_job:
        run = job.sandbox_job(
            chosen, store, batch, echo=echo, delete_sandbox=lambda: delete_own_sandbox(echo)
        )
    else:
        run = batch(cli.printer(echo))
    summary = asyncio.run(run)
    if not dry_run:
        echo(f"done: {summary.graded} graded, {summary.skipped} skipped")


def delete_own_sandbox(echo: "Callable[[str], None]") -> None:
    """The idle TTL is the backstop when this fails, so a failure is only reported."""
    from langsmith.sandbox import SandboxClient

    name = os.environ.get("LANGSMITH_SANDBOX_NAME")
    if not name:
        echo("not in a sandbox: nothing to delete")
        return
    try:
        SandboxClient().delete_sandbox(name)
    except Exception as e:
        echo(f"could not delete sandbox {name}: {e}")


def make_client() -> "Client":
    from langsmith import Client

    return Client()
