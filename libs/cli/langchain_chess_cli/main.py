"""The `lcchess` command line: `uci`, `play` and `grade`."""

import asyncio
import logging
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING, Annotated, Literal

import typer
from langgraph.graph.state import CompiledStateGraph
from langgraph.types import Checkpointer

from langchain_chess_cli.options import AgentOptions, build_agent

if TYPE_CHECKING:
    from langsmith import Client

app = typer.Typer(
    name="lcchess",
    help="Play langchain-chess agents as a UCI engine or in the terminal, and grade their games.",
    no_args_is_help=True,
    add_completion=False,
)

# Typer can't read PEP 695 aliases, so the choices are spelled out here.
PolicyOption = Annotated[
    Literal["llm", "systemone", "hybrid"],
    typer.Option(help="llm: the model alone; systemone: System 1 alone; hybrid: both."),
]
ModelOption = Annotated[
    str, typer.Option(help="init_chat_model spec; a bare name needs its provider's package.")
]
EffortOption = Annotated[
    Literal["low", "medium", "high"], typer.Option(help="Reasoning effort for the model.")
]
SystemOneOption = Annotated[str, typer.Option(help="System 1 model (SemIf or Jev).")]
ThresholdOption = Annotated[
    float, typer.Option(min=0.0, max=1.0, help="System 1 plays at or above this gate signal.")
]
TournamentOption = Annotated[
    float | None, typer.Option(min=0.0, max=1.0, help="Threshold after a tournament.")
]
KOption = Annotated[int, typer.Option(min=1, max=255, help="Candidates suggested to the model.")]
TopPOption = Annotated[
    float | None, typer.Option(min=0.0, max=1.0, help="Cut suggestions at this probability mass.")
]
GateOption = Annotated[
    Literal["margin", "confidence"], typer.Option(help="The signal the threshold applies to.")
]
StyleOption = Annotated[
    Literal["rich", "terse"], typer.Option(help="How moves are described to System 1.")
]
SeedOption = Annotated[int, typer.Option(help="Seeds System 1's tournament and fallbacks.")]
LegalOption = Annotated[bool, typer.Option(help="List the legal moves in the prompt.")]
EvalOption = Annotated[bool, typer.Option(help="Ask System 1 to score the position.")]
NoulsOption = Annotated[bool, typer.Option(help="Ask System 1 about calculation and tactics.")]
MemoryOption = Annotated[
    Literal["none", "summarize"],
    typer.Option(help="What the model sees of earlier turns."),
]


@app.command()
def uci(
    policy: PolicyOption = "hybrid",
    model: ModelOption = "langsmith:anthropic/claude-opus-5-5",
    reasoning_effort: EffortOption = "medium",
    systemone_model: SystemOneOption = "semif-qwen3.5-4b",
    threshold: ThresholdOption = 0.9,
    tournament_threshold: TournamentOption = None,
    k: KOption = 5,
    top_p: TopPOption = None,
    gate: GateOption = "margin",
    style: StyleOption = "rich",
    seed: SeedOption = 0,
    show_legal_moves: LegalOption = True,
    with_eval: EvalOption = False,
    with_nouls: NoulsOption = False,
    memory: MemoryOption = "none",
) -> None:
    """Run as a UCI engine on stdin/stdout. Only protocol output goes to stdout."""
    from langchain_chess_cli.uci.engine import DRAW_CLAIMS, Engine, run

    logging.basicConfig(stream=sys.stderr, level=logging.WARNING)
    options = AgentOptions(
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
        show_legal_moves=show_legal_moves,
        with_eval=with_eval,
        with_nouls=with_nouls,
        memory=memory,
    )

    def factory(agent_options: AgentOptions, checkpointer: Checkpointer) -> CompiledStateGraph:
        return build_agent(agent_options, draw_claims=DRAW_CLAIMS, checkpointer=checkpointer)

    def out(line: str) -> None:
        sys.stdout.write(line + "\n")
        sys.stdout.flush()

    asyncio.run(run(Engine(factory, options, out=out)))


SideOption = Annotated[Literal["white", "black"], typer.Option(help="The side you play.")]


@app.command()
def play(
    side: SideOption = "white",
    policy: PolicyOption = "hybrid",
    model: ModelOption = "langsmith:anthropic/claude-opus-5-5",
    reasoning_effort: EffortOption = "medium",
    systemone_model: SystemOneOption = "semif-qwen3.5-4b",
    threshold: ThresholdOption = 0.9,
    tournament_threshold: TournamentOption = None,
    k: KOption = 5,
    top_p: TopPOption = None,
    gate: GateOption = "margin",
    style: StyleOption = "rich",
    seed: SeedOption = 0,
    show_legal_moves: LegalOption = True,
    with_eval: EvalOption = False,
    with_nouls: NoulsOption = False,
    memory: MemoryOption = "none",
) -> None:
    """Play a game in the terminal (Textual)."""
    from langgraph.checkpoint.memory import InMemorySaver

    from langchain_chess_cli.tui.app import DRAW_CLAIMS, ChessApp

    options = AgentOptions(
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
        show_legal_moves=show_legal_moves,
        with_eval=with_eval,
        with_nouls=with_nouls,
        memory=memory,
    )

    def factory() -> CompiledStateGraph:
        return build_agent(options, draw_claims=DRAW_CLAIMS, checkpointer=InMemorySaver())

    ChessApp(factory, options, side=side).run()


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
) -> None:
    """Grade games with a UCI engine and write the grades to their traces as feedback."""
    from langchain_chess.engine import EngineConfig, EnginePool
    from langchain_chess_cli.grade import cli
    from langchain_chess_cli.grade.batch import grade_batch
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
    except cli.OptionError as e:
        raise typer.BadParameter(str(e)) from e

    def echo(line: str) -> None:
        typer.echo(line, err=True)

    summary = asyncio.run(
        grade_batch(
            chosen,
            LangSmithStore(make_client()),
            lambda n: EnginePool(config, n),
            workers=workers or max(1, (os.cpu_count() or 1) // engine_threads),
            force=force,
            dry_run=dry_run,
            report=cli.printer(echo),
        )
    )
    if not dry_run:
        echo(f"done: {summary.graded} graded, {summary.skipped} skipped")


def make_client() -> "Client":
    from langsmith import Client

    return Client()
