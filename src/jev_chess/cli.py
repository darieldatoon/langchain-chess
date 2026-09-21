"""Command-line entry point. Subcommands are added per phase; see plans/implementation-plan.md."""

import logging
from collections.abc import Iterator
from pathlib import Path
from typing import Annotated, cast, get_args

import chess
import typer
from rich.console import Console
from rich.progress import Progress
from rich.table import Table

from jev_chess.analysis.records import PositionRecord
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


# --- Phase 2: Jev policy and the offline recall pipeline -------------------------------


def _parse_ks(text: str) -> tuple[int, ...]:
    try:
        ks = tuple(sorted({int(part) for part in text.split(",") if part.strip()}))
    except ValueError as exc:
        raise typer.BadParameter("expected comma-separated integers", param_hint="--k") from exc
    if not ks or min(ks) < 1:
        raise typer.BadParameter("k values must be positive", param_hint="--k")
    return ks


@app.command()
def jev(
    fen: str,
    style: Annotated[str, typer.Option(help="terse or rich")] = "rich",
    top: Annotated[int, typer.Option(min=1, max=50)] = 10,
    with_eval: Annotated[bool, typer.Option(help="also ask Jev for a position score")] = False,
) -> None:
    """Ask Jev to rank every legal move; prints the top of its distribution."""
    from jev_chess.policies import JevConfig, JevPolicy

    board = _board(fen)
    policy = JevPolicy.from_settings(config=JevConfig(style=_style(style), with_eval=with_eval))
    ranking = policy.rank(board)
    console.print(
        f"[bold]{ranking.model}[/] {ranking.latency_ms:.0f}ms, "
        f"{ranking.input_tokens} in / {ranking.output_tokens} out tokens, "
        f"confidence {ranking.confidence:.2f}, margin {ranking.margin:.2f}"
        + (f", eval {ranking.eval_score}" if ranking.eval_score is not None else "")
    )
    table = Table("rank", "uci", "san", "probability")
    for rank, candidate in enumerate(ranking.top_k(top), start=1):
        san = board.san(chess.Move.from_uci(candidate.uci))
        table.add_row(str(rank), candidate.uci, san, f"{candidate.probability:.3f}")
    console.print(table)


@app.command("sample-positions")
def sample_positions_cmd(
    out: Annotated[Path, typer.Option(help="JSONL to write")] = Path(
        "data/positions/maia_selfplay.jsonl"
    ),
    n: Annotated[int, typer.Option(min=1)] = 2000,
    per_game: Annotated[int, typer.Option(min=1)] = 4,
    seed: int = 7,
) -> None:
    """Sample human-like positions from Maia self-play with seeded random openings."""
    from jev_chess.analysis import SampleConfig, sample_positions, write_jsonl

    settings = EngineSettings()
    config = SampleConfig(n=n, per_game=per_game, seed=seed)
    players: dict[str, MaiaOpponent] = {}

    def player(rating: str) -> MaiaOpponent:
        if rating not in players:
            players[rating] = MaiaOpponent.open(
                _rating(int(rating)), settings.maia_weights_dir, settings.lc0_path
            )
        return players[rating]

    try:
        with Progress(console=console) as progress:
            task = progress.add_task("sampling", total=n)

            def tracked() -> Iterator[PositionRecord]:
                for record in sample_positions(player, config):
                    progress.advance(task)
                    yield record

            count = write_jsonl(out, tracked())
    finally:
        for engine in players.values():
            engine.close()
    console.print(f"wrote {count} positions to {out}")


@app.command("label-positions")
def label_positions_cmd(
    positions: Annotated[Path, typer.Option(help="positions JSONL")] = Path(
        "data/positions/maia_selfplay.jsonl"
    ),
    out: Annotated[Path, typer.Option(help="labels JSONL to write")] = Path(
        "data/positions/labels.jsonl"
    ),
    depth: Annotated[int, typer.Option(min=1, max=40)] = 16,
    multipv: Annotated[int, typer.Option(min=1, max=20)] = 5,
    workers: Annotated[int, typer.Option(min=1, max=32)] = 4,
) -> None:
    """Label each position with Stockfish's top moves, one engine process per worker."""
    from jev_chess.analysis import label_positions, read_jsonl, write_jsonl

    settings = EngineSettings()
    records = list(read_jsonl(positions, PositionRecord))
    config = OracleConfig(depth=depth, multipv=multipv)
    with Progress(console=console) as progress:
        task = progress.add_task("labelling", total=len(records))
        labels = label_positions(
            records,
            lambda: Oracle.open(settings.stockfish_path, config),
            depth,
            workers,
            progress=lambda _: progress.advance(task),
        )
    console.print(f"wrote {write_jsonl(out, labels)} labels to {out}")


@app.command("jev-rank")
def jev_rank_cmd(
    positions: Annotated[Path, typer.Option(help="positions JSONL")] = Path(
        "data/positions/maia_selfplay.jsonl"
    ),
    out: Annotated[Path, typer.Option(help="rankings JSONL to write")] = Path(
        "data/positions/jev_rich.jsonl"
    ),
    style: Annotated[str, typer.Option(help="terse or rich")] = "rich",
    concurrency: Annotated[int, typer.Option(min=1, max=64)] = 4,
    model: str = "jev-latest",
) -> None:
    """Ask Jev to rank every sampled position; writes its full distribution per position."""
    import asyncio

    from jev_chess.analysis import rank_positions, read_jsonl, write_jsonl
    from jev_chess.policies import JevConfig, JevPolicy

    records = list(read_jsonl(positions, PositionRecord))
    policy = JevPolicy.from_settings(config=JevConfig(model=model, style=_style(style)))
    with Progress(console=console) as progress:
        task = progress.add_task("ranking", total=len(records))
        rankings = asyncio.run(
            rank_positions(records, policy, concurrency, progress=lambda _: progress.advance(task))
        )
    console.print(f"wrote {write_jsonl(out, rankings)} rankings to {out}")


@app.command("recall-report")
def recall_report_cmd(
    positions: Annotated[Path, typer.Option()] = Path("data/positions/maia_selfplay.jsonl"),
    labels: Annotated[Path, typer.Option()] = Path("data/positions/labels.jsonl"),
    rankings: Annotated[Path, typer.Option()] = Path("data/positions/jev_rich.jsonl"),
    k: Annotated[str, typer.Option(help="comma-separated k values")] = "1,3,5,8",
) -> None:
    """Recall@k of Stockfish's best move within Jev's top-k, plus calibration tables."""
    from jev_chess.analysis import JevRecord, OracleLabel, join, read_jsonl, recall_report

    rows = join(
        read_jsonl(positions, PositionRecord),
        read_jsonl(labels, OracleLabel),
        read_jsonl(rankings, JevRecord),
    )
    report = recall_report(rows, _parse_ks(k))
    console.print(
        f"[bold]{report.n} positions[/], mean {report.mean_latency_ms:.0f}ms, "
        f"{report.mean_input_tokens:.0f} input tokens"
    )
    recall = Table("k", "best in Jev top-k", "any oracle top-3 in Jev top-k")
    for kk in report.recall_at:
        recall.add_row(
            str(kk), f"{report.recall_at[kk]:.1%}", f"{report.oracle_top3_hit_at[kk]:.1%}"
        )
    console.print(recall)
    phases = Table("phase", *(f"recall@{kk}" for kk in report.recall_at))
    for phase, table in report.recall_by_phase.items():
        phases.add_row(phase, *(f"{table[kk]:.1%}" for kk in report.recall_at))
    console.print(phases)
    loss = (
        "n/a"
        if report.mean_cp_loss is None or report.median_cp_loss is None
        else f"mean {report.mean_cp_loss:.0f} cp, median {report.median_cp_loss:.0f} cp"
    )
    console.print(
        f"cp loss of Jev's top move (capped at 1000): {loss} "
        f"(known for {report.cp_loss_coverage:.0%} of positions)"
    )
    for title, buckets in (
        ("confidence", report.confidence_calibration),
        ("margin", report.margin_calibration),
    ):
        cal = Table(title, "n", "top-1 accuracy")
        for b in buckets:
            if b.count:
                acc = "" if b.accuracy is None else f"{b.accuracy:.1%}"
                cal.add_row(f"{b.lower:.1f}-{b.upper:.1f}", str(b.count), acc)
        console.print(cal)
