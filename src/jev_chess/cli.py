"""Command-line entry point. Subcommands are added per phase; see plans/implementation-plan.md."""

import typer

app = typer.Typer(no_args_is_help=True, help="System 1 vs System 2 chess experiments.")


@app.callback()
def main() -> None:
    """Group callback so single-command apps still expose subcommands."""


@app.command()
def version() -> None:
    """Print the package version."""
    from importlib.metadata import version as pkg_version

    typer.echo(pkg_version("jev-chess"))
