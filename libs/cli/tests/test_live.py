"""Against the real LLM Gateway: `uv run --all-packages --env-file .env pytest -m live --no-cov`."""

import pytest
from textual.widgets import Input

from langchain_chess_cli.tui.app import ChessApp
from langchain_chess_systemone.agent import build_agent
from langchain_chess_systemone.settings import ChessContext

# One loop for the run: langchain-openai caches its async client across tests.
pytestmark = [pytest.mark.live, pytest.mark.asyncio(loop_scope="session")]


async def test_a_short_tui_game_against_the_hybrid():
    options = ChessContext(reasoning_effort="low")
    app = ChessApp(
        lambda saver: build_agent(options, checkpointer=saver),
        options,
        side="white",
    )
    async with app.run_test() as pilot:
        for move in ("e4", "Nf3"):
            app.query_one("#move", Input).focus()
            for key in move:
                await pilot.press(key)
            await pilot.press("enter")
            await app.workers.wait_for_complete()
            await pilot.pause()
    plies = app.values["plies"]
    assert len(plies) == 4
    assert {p["source"] for p in plies[1::2]} <= {"llm", "systemone"}
    assert app.failed is None
