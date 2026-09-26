"""Option parsing and progress lines for `lcchess grade`."""

from collections.abc import Callable, Sequence
from datetime import datetime
from pathlib import Path

from langchain_chess.engine import SearchKind, SearchLimit
from langchain_chess_cli.grade.batch import Event, Planned, Selection, Skipped, Threads
from langchain_chess_cli.grade.store import ProjectQuery


class OptionError(ValueError):
    """Shown to the user as a usage error."""


def search_limit(depth: int | None, nodes: int | None, movetime: int | None) -> SearchLimit:
    options: tuple[tuple[SearchKind, int | None], ...] = (
        ("depth", depth),
        ("nodes", nodes),
        ("movetime", movetime),
    )
    given = [SearchLimit(kind, value) for kind, value in options if value is not None]
    if len(given) > 1:
        msg = "pick one of --depth, --nodes and --movetime"
        raise OptionError(msg)
    return given[0] if given else SearchLimit("depth", 16)


def metadata_pairs(items: Sequence[str]) -> tuple[tuple[str, str], ...]:
    pairs = []
    for item in items:
        key, sep, value = item.partition("=")
        if not sep or not key:
            msg = f"--metadata takes key=value, not {item!r}"
            raise OptionError(msg)
        pairs.append((key, value))
    return tuple(pairs)


def thread_ids(threads: Sequence[str], threads_file: Path | None) -> tuple[str, ...]:
    """One id per line in the file; blank lines and `#` comments are skipped."""
    ids = list(threads)
    if threads_file is not None:
        for line in threads_file.read_text().splitlines():
            text = line.split("#", 1)[0].strip()
            if text:
                ids.append(text)
    return tuple(ids)


def _aware(moment: datetime | None) -> datetime | None:
    """A naive time is local time."""
    return moment if moment is None or moment.tzinfo else moment.astimezone()


def selection(
    project: str | None,
    ids: tuple[str, ...],
    *,
    since: datetime | None,
    until: datetime | None,
    limit: int | None,
    metadata: tuple[tuple[str, str], ...],
) -> Selection:
    if not project:
        msg = "set --project or LANGSMITH_PROJECT"
        raise OptionError(msg)
    if ids:
        if since or until or limit or metadata:
            msg = "--since, --until, --limit and --metadata select from a project, not --thread"
            raise OptionError(msg)
        return Threads(project, ids)
    return ProjectQuery(
        project,
        since=_aware(since),
        until=_aware(until),
        metadata=metadata,
        limit=limit,
    )


def _settings(planned: Planned) -> str:
    return ", ".join(f"{k} {v}" for k, v in planned.grader.settings.items())


def _accuracy(value: float | None) -> str:
    return "-" if value is None else f"{value:.1f}"


def _plies(n: int) -> str:
    return "1 ply" if n == 1 else f"{n} plies"


def printer(echo: Callable[[str], None]) -> Callable[[Event], None]:
    def report(event: Event) -> None:
        match event:
            case Skipped(thread_id=t, reason="no_game"):
                echo(f"skip {t}: no game in its traces")
            case Skipped(thread_id=t):
                echo(f"skip {t}: already graded with these settings (--force redoes it)")
            case Planned(games=()):
                echo("nothing to grade")
            case Planned() as p if p.dry_run:
                echo(f"would grade {len(p.games)} games, {p.positions} positions")
                echo(f"  engine: {p.workers} x {p.grader.engine} ({_settings(p)})")
                for game in p.games:
                    echo(f"  {game.thread_id}: {_plies(len(game.moves))}")
            case Planned() as p:
                echo(
                    f"grading {len(p.games)} games, {p.positions} positions on "
                    f"{p.workers} x {p.grader.engine} ({_settings(p)})"
                )
            case _:
                g = event
                rate = g.positions_done / g.elapsed_s if g.elapsed_s > 0 else 0.0
                echo(
                    f"graded {g.record.thread_id}: {_plies(len(g.record.moves))}, "
                    f"accuracy white {_accuracy(g.grade.accuracy['white'])} "
                    f"black {_accuracy(g.grade.accuracy['black'])} "
                    f"[{g.positions_done}/{g.positions_total} positions, {rate:.1f}/s]"
                )

    return report
