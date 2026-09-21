"""Command-line entry point. Subcommands are added per phase; see plans/implementation-plan.md."""

import logging
from typing import Annotated, cast, get_args

import chess
import typer
from rich.console import Console
from rich.table import Table

from jev_chess.core import DescriptionStyle, all_move_facts, describe, material_balance, snapshot
from jev_chess.engines import MaiaOpponent, MaiaRating, Oracle, OracleConfig
from jev_chess.settings import EngineSettings

app = typer.Typer(no_args_is_help=True, help="System 1 vs System 2 chess experiments.")
console = Console()
_DEFAULT_ORACLE = OracleConfig()


@app.callback()
def main() -> None:
    """Group callback so single-command apps still expose subcommands."""
    # python-chess echoes engine stderr (lc0 backend banners) at WARNING; keep the CLI quiet.
    logging.getLogger("chess.engine").setLevel(logging.ERROR)


@app.command()
def version() -> None:
    """Print the package version."""
    from importlib.metadata import version as pkg_version

    typer.echo(pkg_version("jev-chess"))


def _board(fen: str) -> chess.Board:
    try:
        return chess.Board(fen)
    except ValueError as exc:
        raise typer.BadParameter(str(exc), param_hint="FEN") from exc


def _style(style: str) -> DescriptionStyle:
    if style not in get_args(DescriptionStyle.__value__):
        raise typer.BadParameter("style must be terse or rich", param_hint="--style")
    return cast("DescriptionStyle", style)


def _rating(rating: int) -> MaiaRating:
    if rating not in get_args(MaiaRating.__value__):
        raise typer.BadParameter("rating must be 1100..1900 in steps of 100", param_hint="--rating")
    return cast("MaiaRating", rating)


@app.command()
def facts(
    fen: str,
    style: Annotated[str, typer.Option(help="terse or rich")] = "rich",
) -> None:
    """Show board-verified facts and descriptions for every legal move."""
    chosen = _style(style)
    board = _board(fen)
    position = snapshot(board)
    balance = material_balance(board)
    console.print(f"[bold]{position.side}[/] to move, material {balance.white}:{balance.black}")
    table = Table("uci", "see", "description")
    for f in all_move_facts(board):
        table.add_row(f.uci, f"{f.see_gain:+d}", describe(f, chosen))
    console.print(table)


@app.command()
def oracle(
    fen: str,
    depth: Annotated[int, typer.Option(min=1, max=40)] = _DEFAULT_ORACLE.depth,
    multipv: Annotated[int, typer.Option(min=1, max=10)] = _DEFAULT_ORACLE.multipv,
) -> None:
    """Rank the top moves with full-strength Stockfish."""
    settings = EngineSettings()
    board = _board(fen)
    config = OracleConfig(depth=depth, multipv=multipv)
    with Oracle.open(settings.stockfish_path, config) as engine:
        evaluation = engine.evaluate(board)
    table = Table("rank", "uci", "san", "cp", "mate", "cp loss")
    for rank, move in enumerate(evaluation.ranked, start=1):
        table.add_row(
            str(rank),
            move.uci,
            board.san(chess.Move.from_uci(move.uci)),
            "" if move.cp is None else str(move.cp),
            "" if move.mate is None else str(move.mate),
            str(evaluation.cp_loss(move.uci)),
        )
    console.print(table)


@app.command()
def maia(
    fen: str,
    rating: Annotated[int, typer.Option(help="1100..1900 in steps of 100")] = 1100,
) -> None:
    """Ask Maia what a human at the given rating would play."""
    chosen = _rating(rating)
    settings = EngineSettings()
    board = _board(fen)
    with MaiaOpponent.open(chosen, settings.maia_weights_dir, settings.lc0_path) as engine:
        move = engine.play(board)
    console.print(f"maia-{chosen}: {board.san(move)} ({move.uci()})")
