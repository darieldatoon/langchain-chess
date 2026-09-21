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

from jev_chess.analysis.records import JevRecord, PositionRecord
from jev_chess.core import DescriptionStyle, all_move_facts, describe, material_balance, snapshot
from jev_chess.engines import MaiaOpponent, MaiaRating, Oracle, OracleConfig
from jev_chess.runner.game import GameRecord
from jev_chess.runner.match import Budget, MatchConfig
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
    with_nouls: Annotated[
        bool, typer.Option(help="also ask needs_calculation and tactics_present")
    ] = False,
) -> None:
    """Ask Jev to rank every legal move; prints the top of its distribution."""
    from jev_chess.policies import JevConfig, JevPolicy

    board = _board(fen)
    config = JevConfig(style=_style(style), with_eval=with_eval, with_nouls=with_nouls)
    ranking = JevPolicy.from_settings(config=config).rank(board)
    extras = [
        f"eval {ranking.eval_score:.2f}" if ranking.eval_score is not None else "",
        f"needs_calculation {ranking.needs_calculation:.2f}"
        if ranking.needs_calculation is not None
        else "",
        f"tactics_present {ranking.tactics_present:.2f}"
        if ranking.tactics_present is not None
        else "",
    ]
    console.print(
        f"[bold]{ranking.model}[/] {ranking.latency_ms:.0f}ms, "
        f"{ranking.input_tokens} in / {ranking.output_tokens} out tokens, "
        f"confidence {ranking.confidence:.2f}, margin {ranking.margin:.2f}"
        + "".join(f", {e}" for e in extras if e)
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
    with_eval: Annotated[bool, typer.Option(help="also ask for a position Score")] = False,
    with_nouls: Annotated[bool, typer.Option(help="also ask the two Nouls")] = False,
) -> None:
    """Ask Jev to rank every sampled position. Appends as it goes; reruns skip finished ids."""
    import asyncio

    from jev_chess.analysis import append_jsonl, existing_ids, rank_positions, read_jsonl
    from jev_chess.policies import JevConfig, JevPolicy

    done = existing_ids(out, JevRecord)
    records = [r for r in read_jsonl(positions, PositionRecord) if r.id not in done]
    config = JevConfig(model=model, style=_style(style), with_eval=with_eval, with_nouls=with_nouls)
    policy = JevPolicy.from_settings(config=config)
    with Progress(console=console) as progress:
        task = progress.add_task("ranking", total=len(records), completed=0)

        def on_done(record: JevRecord) -> None:
            append_jsonl(out, record)
            progress.advance(task)

        asyncio.run(rank_positions(records, policy, concurrency, progress=on_done))
    console.print(f"{len(records)} new rankings appended to {out} ({len(done)} were already done)")


@app.command("recall-report")
def recall_report_cmd(
    positions: Annotated[Path, typer.Option()] = Path("data/positions/maia_selfplay.jsonl"),
    labels: Annotated[Path, typer.Option()] = Path("data/positions/labels.jsonl"),
    rankings: Annotated[Path, typer.Option()] = Path("data/positions/jev_rich.jsonl"),
    k: Annotated[str, typer.Option(help="comma-separated k values")] = "1,3,5,8",
) -> None:
    """Recall@k of Stockfish's best move within Jev's top-k, plus calibration tables."""
    from jev_chess.analysis import (
        JevRecord,
        OracleLabel,
        gate_report,
        join,
        read_jsonl,
        recall_report,
        score_report,
        tactics_calibration,
    )

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

    gates = Table("gate signal", *(f">= {t:.2f}" for t in (0.5, 0.6, 0.7, 0.8, 0.9, 0.95)))
    gates.title = "Jev plays alone when signal clears threshold: kept share / top-1 accuracy"
    by_signal: dict[str, list[str]] = {}
    for point in gate_report(rows):
        acc = "" if point.accuracy is None else f"{point.accuracy:.0%}"
        by_signal.setdefault(point.signal, []).append(f"{point.kept:.0%} / {acc}")
    for signal, cells in by_signal.items():
        gates.add_row(signal, *cells)
    console.print(gates)

    scores = score_report(rows)
    if scores is not None:
        console.print(
            f"[bold]Score vs Stockfish rung[/] (n={scores.n}): exact {scores.exact:.1%}, "
            f"within one {scores.within_one:.1%}, mean abs error {scores.mean_abs_error:.2f} rungs"
        )
        confusion = Table("oracle rung", *(str(g) for g in range(7)))
        for truth in range(7):
            row = scores.confusion.get(truth, {})
            confusion.add_row(str(truth), *(str(row.get(g, 0)) for g in range(7)))
        console.print(confusion)

    tactics = tactics_calibration(rows)
    if any(b.count for b in tactics):
        tac = Table("tactics_present", "n", "tactic truly present")
        for b in tactics:
            if b.count:
                rate = "" if b.accuracy is None else f"{b.accuracy:.1%}"
                tac.add_row(f"{b.lower:.1f}-{b.upper:.1f}", str(b.count), rate)
        console.print(tac)


# --- Phase 3 / 5: play games ---------------------------------------------------------------


def _match_config(
    games: int,
    max_plies: int,
    seed: int,
    swap_colours: bool,
    workers: int,
    max_usd: float | None,
    adjudicate: bool,
    adjudication_depth: int,
) -> "MatchConfig":
    from jev_chess.runner import MatchConfig

    return MatchConfig(
        games=games,
        max_plies=max_plies,
        seed=seed,
        swap_colours=swap_colours,
        workers=workers,
        max_usd=max_usd,
        adjudicate=adjudicate,
        adjudication_depth=adjudication_depth,
    )


def _run_match(
    white: str, black: str, out: Path, config: MatchConfig, label: str, budget: Budget | None = None
) -> None:
    from jev_chess.runner import HybridSpec, JevSpec, LLMSpec, Match, SpecError, parse_spec
    from jev_chess.settings import GatewaySettings

    try:
        specs = (parse_spec(white), parse_spec(black))
    except SpecError as exc:
        raise typer.BadParameter(str(exc)) from exc
    needs_gateway = any(isinstance(s, (JevSpec, LLMSpec, HybridSpec)) for s in specs)
    gateway = GatewaySettings() if needs_gateway else None

    def on_game(record: GameRecord) -> None:
        wt, bt = record.white_totals, record.black_totals
        console.print(
            f"[bold]{record.game_id}[/] {record.white} vs {record.black}, {record.opening}: "
            f"{record.result} by {record.termination} after {record.plies} plies; "
            f"white {wt.latency_ms / 1000:.0f}s ${wt.cost_usd:.3f}, "
            f"black {bt.latency_ms / 1000:.0f}s ${bt.cost_usd:.3f}"
        )

    match = Match(
        specs[0], specs[1], config, out, EngineSettings(), gateway, on_game=on_game, budget=budget
    )
    played = match.run(label)
    console.print(
        f"{len(played)} games written to {out / 'games.jsonl'}; spent ${match.budget.spent_usd:.3f}"
        + (f"; {len(match.skipped)} games skipped by --max-usd" if match.skipped else "")
    )


@app.command()
def play(
    white: Annotated[
        str,
        typer.Option(
            help="e.g. jev, maia:1100, llm:claude-opus-5:low, hybrid:claude-opus-5:low:k5:t0.9"
        ),
    ],
    black: Annotated[str, typer.Option(help="player spec")],
    games: Annotated[int, typer.Option(min=1)] = 1,
    out: Annotated[Path, typer.Option(help="directory for plies.jsonl and games.jsonl")] = Path(
        "runs/scratch"
    ),
    max_plies: Annotated[int, typer.Option(min=2, max=600)] = 200,
    seed: int = 0,
    swap_colours: Annotated[bool, typer.Option(help="alternate colours each game")] = True,
    workers: Annotated[int, typer.Option(min=1, max=32, help="concurrent games")] = 1,
    max_usd: Annotated[
        float | None, typer.Option(help="stop starting games past this spend")
    ] = None,
    adjudicate: Annotated[
        bool, typer.Option(help="Stockfish adjudication of decided games")
    ] = True,
    adjudication_depth: Annotated[int, typer.Option(min=4, max=30)] = 12,
) -> None:
    """Play games between two players from the opening book, appending records as they go."""
    config = _match_config(
        games, max_plies, seed, swap_colours, workers, max_usd, adjudicate, adjudication_depth
    )
    _run_match(white, black, out, config, out.name)


@app.command()
def sweep(
    players: Annotated[str, typer.Option(help="comma-separated player specs under test")],
    opponents: Annotated[str, typer.Option(help="comma-separated opponent specs")],
    out: Annotated[Path, typer.Option(help="run directory; one subdirectory per pairing")] = Path(
        "runs/sweep"
    ),
    games: Annotated[int, typer.Option(min=1)] = 10,
    max_plies: Annotated[int, typer.Option(min=2, max=600)] = 200,
    seed: int = 0,
    workers: Annotated[int, typer.Option(min=1, max=32)] = 4,
    max_usd: Annotated[float | None, typer.Option(help="total cap across all pairings")] = None,
    adjudicate: bool = True,
    adjudication_depth: Annotated[int, typer.Option(min=4, max=30)] = 12,
) -> None:
    """Every player against every opponent. Records land in out/<player>__<opponent>/."""
    config = _match_config(
        games, max_plies, seed, True, workers, max_usd, adjudicate, adjudication_depth
    )
    budget = Budget(max_usd)
    failed: list[str] = []
    for player in _split(players):
        for opponent in _split(opponents):
            label = f"{_slug(player)}__{_slug(opponent)}"
            console.rule(f"{player} vs {opponent}")
            try:
                _run_match(player, opponent, out / label, config, label, budget)
            except Exception as exc:  # one bad pairing must not sink the sweep
                failed.append(label)
                console.print(f"[red]{label} failed: {type(exc).__name__}: {exc}[/]")
    console.print(f"sweep spent ${budget.spent_usd:.3f} in total")
    if failed:
        console.print(f"[red]{len(failed)} pairing(s) failed: {', '.join(failed)}[/]")
        raise typer.Exit(code=1)


def _split(text: str) -> list[str]:
    return [part.strip() for part in text.split(",") if part.strip()]


def _slug(spec: str) -> str:
    return spec.replace(":", "-").replace("/", "-").replace(".", "_")


@app.command()
def grade(
    run: Annotated[Path, typer.Option(help="run directory containing plies.jsonl")],
    depth: Annotated[int, typer.Option(min=1, max=40)] = 16,
    workers: Annotated[int, typer.Option(min=1, max=32)] = 4,
) -> None:
    """Grade every recorded ply with the oracle; writes grades.jsonl next to plies.jsonl."""
    from jev_chess.analysis import grade_plies, read_jsonl, write_jsonl
    from jev_chess.runner import PlyRecord

    plies = [p for path in sorted(run.rglob("plies.jsonl")) for p in read_jsonl(path, PlyRecord)]
    if not plies:
        raise typer.BadParameter(f"no plies.jsonl under {run}", param_hint="--run")
    settings = EngineSettings()
    config = OracleConfig(depth=depth, multipv=1)
    with Progress(console=console) as progress:
        task = progress.add_task("grading", total=len(plies))
        grades = grade_plies(
            plies,
            lambda: Oracle.open(settings.stockfish_path, config),
            workers,
            progress=lambda _: progress.advance(task),
        )
    out = run / "grades.jsonl"
    console.print(f"wrote {write_jsonl(out, grades)} grades to {out}")


@app.command()
def report(
    run: Annotated[Path, typer.Option(help="run directory (searched recursively)")],
) -> None:
    """Per-player strength, cost, and latency from games, plies, and grades under a run."""
    from jev_chess.analysis import anchor_rows, pareto_rows, read_jsonl, summarise
    from jev_chess.analysis.grade import GradeRecord
    from jev_chess.runner import PlyRecord

    games = [g for path in sorted(run.rglob("games.jsonl")) for g in read_jsonl(path, GameRecord)]
    plies = [p for path in sorted(run.rglob("plies.jsonl")) for p in read_jsonl(path, PlyRecord)]
    grades = [
        g for path in sorted(run.rglob("grades.jsonl")) for g in read_jsonl(path, GradeRecord)
    ]
    if not games:
        raise typer.BadParameter(f"no games.jsonl under {run}", param_hint="--run")
    summaries = summarise(games, plies, grades)
    table = Table(
        "player",
        "games",
        "W-D-L",
        "score",
        "Elo",
        "ACPL",
        "blunder%",
        "s/move (median)",
        "$/game",
        "escalate%",
        "override%",
        "override gain cp",
        "fallbacks",
        "illegal",
    )
    for s in pareto_rows(list(summaries.values())):
        table.add_row(
            s.player,
            str(s.games),
            f"{s.wins}-{s.draws}-{s.losses}",
            f"{s.score:.0%}",
            f"{s.elo:.0f}" if s.elo is not None else "",
            f"{s.acpl:.0f}" if s.acpl is not None else "",
            f"{s.blunder_rate:.1%}" if s.blunder_rate is not None else "",
            f"{s.median_latency_ms / 1000:.1f}",
            f"{s.cost_per_game:.3f}" + ("" if s.cost_known else "+?"),
            f"{s.escalation_rate:.0%}",
            f"{s.override_rate:.0%}" if s.override_rate is not None else "",
            f"{s.mean_override_gain_cp:+.0f}" if s.mean_override_gain_cp is not None else "",
            str(s.fallbacks),
            str(s.illegal_attempts),
        )
    console.print(table)
    anchors = Table("engine", "games", "W-D-L", "Elo (Maia anchored)")
    for s in anchor_rows(list(summaries.values())):
        anchors.add_row(s.player, str(s.games), f"{s.wins}-{s.draws}-{s.losses}", f"{s.elo:.0f}")
    console.print(anchors)
