"""The `lcchess` command line: `uci` and `play`."""

import asyncio
import logging
import sys
from typing import Annotated, Literal

import typer
from langgraph.graph.state import CompiledStateGraph
from langgraph.types import Checkpointer

from langchain_chess_cli.options import AgentOptions, build_agent

app = typer.Typer(
    name="lcchess",
    help="Play langchain-chess agents as a UCI engine or in the terminal.",
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
    Literal["none", "full", "summarize"],
    typer.Option(help="What the model sees of earlier turns."),
]
TriggerOption = Annotated[
    int | None, typer.Option(min=1, help="Summarize at this many tokens (profileless models).")
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
    summary_trigger_tokens: TriggerOption = None,
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
        summary_trigger_tokens=summary_trigger_tokens,
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
    summary_trigger_tokens: TriggerOption = None,
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
        summary_trigger_tokens=summary_trigger_tokens,
    )

    def factory() -> CompiledStateGraph:
        return build_agent(options, draw_claims=DRAW_CLAIMS, checkpointer=InMemorySaver())

    ChessApp(factory, options, side=side).run()
