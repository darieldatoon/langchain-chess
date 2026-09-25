"""The `lcchess` command line."""

import typer

app = typer.Typer(
    name="lcchess",
    help="Play langchain-chess agents as a UCI engine or in the terminal.",
    no_args_is_help=True,
    add_completion=False,
)


@app.command()
def uci() -> None:
    """Run as a UCI engine on stdin/stdout."""
    typer.echo("not implemented yet", err=True)
    raise typer.Exit(1)


@app.command()
def play() -> None:
    """Play a game in the terminal."""
    typer.echo("not implemented yet", err=True)
    raise typer.Exit(1)
