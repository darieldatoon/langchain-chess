"""Against the real LLM Gateway: `uv run --all-packages --env-file .env pytest -m live --no-cov`."""

import pytest
from langgraph.checkpoint.memory import InMemorySaver
from textual.widgets import Input

from langchain_chess_cli.options import AgentOptions, build_agent
from langchain_chess_cli.tui.app import ChessApp

pytestmark = pytest.mark.live


async def test_a_short_tui_game_against_the_hybrid():
    options = AgentOptions(reasoning_effort="low")
    app = ChessApp(
        lambda: build_agent(options, draw_claims="auto", checkpointer=InMemorySaver()),
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
