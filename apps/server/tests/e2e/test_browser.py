"""The web app in a browser, on a real `langgraph dev` with a fake model: a setup's settings
reach the agent. Needs the built UI (`mise run build`) and Chromium; run with `mise run test:e2e`.
"""

import os
import time
from collections.abc import Callable, Iterator
from contextlib import AbstractContextManager, suppress
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

import pytest
from langgraph_sdk import get_sync_client
from langgraph_sdk.errors import NotFoundError
from playwright.sync_api import Page, expect, sync_playwright

from langchain_chess_server.app import STATIC_DIR
from langchain_chess_systemone.settings import ChessContext, dump

pytestmark = pytest.mark.e2e

GRAPH = str(Path(__file__).with_name("graph.py")) + ":make_graph"


@pytest.fixture(scope="module")
def server(
    tmp_path_factory: pytest.TempPathFactory,
    langgraph_dev: Callable[..., AbstractContextManager[str]],
) -> Iterator[str]:
    if not (STATIC_DIR / "index.html").is_file():
        pytest.fail("the web UI isn't built; run `mise run build` first")
    workdir = tmp_path_factory.mktemp("langgraph-dev-e2e")
    env_file = workdir / ".env"
    env_file.write_text(
        "LANGSMITH_GATEWAY=true\nLANGSMITH_GATEWAY_API_KEY=lsv2_test\nLANGSMITH_TRACING=false\n"
    )
    prefixes = ("LANGSMITH_", "LANGCHAIN_", "TYPESAFE_", "LC_")
    environ = {k: v for k, v in os.environ.items() if not k.startswith(prefixes)}
    with langgraph_dev(workdir, env_file=env_file, environ=environ, graphs={"chess": GRAPH}) as url:
        yield url


@pytest.fixture
def page() -> Iterator[Page]:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        try:
            yield browser.new_page()
        finally:
            browser.close()


def pick(page: Page, label: str, option: str) -> None:
    """`option` is its accessible name: the label, then the description."""
    page.get_by_label(label, exact=True).click()
    page.get_by_role("option", name=option, exact=True).click()


def game_state(server: str, page: Page) -> Any:
    """The thread the page plays on, once the agent has moved."""
    page.wait_for_url("**/ui/?thread=*")
    thread = parse_qs(urlparse(page.url).query)["thread"][0]
    client = get_sync_client(url=server)
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        with suppress(NotFoundError):  # the page names the thread before its first run creates it
            values = client.threads.get_state(thread)["values"]
            if values.get("plies"):
                return values
        time.sleep(0.2)
    pytest.fail("the agent never moved")


def test_a_setup_s_settings_reach_the_agent(server: str, page: Page):
    page.goto(f"{server}/ui/")
    page.get_by_text("Black", exact=True).click()
    page.get_by_role("button", name="Advanced").click()
    pick(page, "Moves Listed", "Candidates System 1's, when it has any")
    pick(page, "Draw Claims", "Never Only forced draws end the game")
    shortlist = page.get_by_label("Shortlist Size")
    shortlist.fill("2")
    page.get_by_role("button", name="Play").click()

    values = game_state(server, page)
    assert values["setup"] == dump(ChessContext(move_list="candidates", draw_claims="never", k=2))
    shown = values["plies"][0]["analysis"]
    assert "Suggested candidates: " in shown
    assert "Legal moves" not in shown
    shortlist_meta = values["plies"][0]["meta"]["SystemOneMiddleware"]["shortlist"]
    assert len(shortlist_meta) == 2
    expect(page.get_by_text("Your move.")).to_be_visible()
