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
from playwright.sync_api import Locator, Page, expect, sync_playwright

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


# Desktop, then a phone held upright and on its side.
CONTEXTS: dict[str, dict[str, Any]] = {
    "desktop": {"viewport": {"width": 1280, "height": 800}},
    "portrait": {
        "viewport": {"width": 390, "height": 844},
        "has_touch": True,
        "is_mobile": True,
        "device_scale_factor": 3,
    },
    "landscape": {
        "viewport": {"width": 844, "height": 390},
        "has_touch": True,
        "is_mobile": True,
        "device_scale_factor": 3,
    },
}
TOUCH = ["portrait", "landscape"]
MIN_TAP = 44


@pytest.fixture
def page(request: pytest.FixtureRequest) -> Iterator[Page]:
    """Desktop unless a test parametrizes it (`indirect=True`) with a `CONTEXTS` key."""
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        try:
            yield browser.new_context(**CONTEXTS[getattr(request, "param", "desktop")]).new_page()
        finally:
            browser.close()


def no_sideways_scroll(page: Page, selector: str | None = None) -> None:
    """Neither the document nor `selector` is wider than the viewport."""
    widths = page.evaluate(
        """(selector) => {
          const el = selector ? document.querySelector(selector) : null;
          return {
            inner: window.innerWidth,
            doc: document.documentElement.scrollWidth,
            el: el ? el.scrollWidth : 0,
            elBox: el ? el.getBoundingClientRect().right : 0,
          };
        }""",
        selector,
    )
    assert widths["doc"] <= widths["inner"], widths
    assert widths["el"] <= widths["inner"], widths
    assert widths["elBox"] <= widths["inner"], widths


def inside_viewport(page: Page, locator: Locator) -> None:
    """Fully on screen as the page stands, without scrolling it."""
    box = locator.bounding_box()
    viewport = page.viewport_size
    assert box is not None
    assert viewport is not None
    assert box["x"] >= 0, box
    assert box["y"] >= 0, box
    assert box["x"] + box["width"] <= viewport["width"], (box, viewport)
    assert box["y"] + box["height"] <= viewport["height"], (box, viewport)


def at_least_a_tap(locator: Locator) -> None:
    box = locator.bounding_box()
    assert box is not None
    assert box["width"] >= MIN_TAP, box
    assert box["height"] >= MIN_TAP, box


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
    pick(page, "Moves to list", "Candidates System 1's, when it has any")
    pick(page, "Claim draws", "No Only forced draws end the game")
    page.get_by_role("switch", name="Show the board").click()
    page.get_by_label("System prompt", exact=True).fill("Play fast.")
    shortlist = page.get_by_label("Candidates for the LLM", exact=True)
    shortlist.fill("2")
    page.get_by_role("button", name="Play", exact=True).click()

    values = game_state(server, page)
    expected = ChessContext(
        move_list="candidates",
        draw_claims="never",
        k=2,
        show_board=False,
        system_prompt="Play fast.",
    )
    assert values["setup"] == dump(expected)
    shown = values["plies"][0]["analysis"]
    assert "Board (ranks" not in shown
    assert "FEN: " in shown
    assert "Suggested candidates: " in shown
    assert "Legal moves" not in shown
    shortlist_meta = values["plies"][0]["meta"]["SystemOneMiddleware"]["shortlist"]
    assert len(shortlist_meta) == 2
    expect(page.get_by_text("Your move.")).to_be_visible()


def open_a_game(server: str, page: Page) -> None:
    """Plays the default setup as White, so a game is on screen and New game can be cancelled."""
    page.goto(f"{server}/ui/")
    page.get_by_role("button", name="Play", exact=True).tap()
    expect(page.get_by_role("dialog")).to_have_count(0)


@pytest.mark.parametrize("page", TOUCH, indirect=True)
def test_new_game_fits_a_phone_with_advanced_open_and_a_key_problem(server: str, page: Page):
    open_a_game(server, page)
    # The server now refuses the key, so Play shows the key banner.
    page.route("**/assistants/search", lambda route: route.fulfill(status=401, body="{}"))
    page.get_by_role("button", name="New game").tap()
    dialog = page.get_by_role("dialog", name="New game")
    dialog.get_by_role("button", name="Advanced").tap()
    dialog.get_by_role("button", name="Play", exact=True).tap()
    expect(dialog.get_by_text("LangSmith API key needed")).to_be_visible()

    no_sideways_scroll(page, "[role=dialog]")
    inside_viewport(page, dialog.get_by_role("button", name="Play", exact=True))
    for name in ("Close", "More", "Cancel", "Play"):
        at_least_a_tap(dialog.get_by_role("button", name=name, exact=True))
    help_icon = dialog.get_by_role("button", name="About Moves to list")
    help_icon.scroll_into_view_if_needed()
    help_icon.tap()
    expect(page.get_by_role("dialog").get_by_text("Which moves every turn")).to_be_visible()


@pytest.mark.parametrize("page", TOUCH, indirect=True)
def test_settings_open_from_new_game_and_fit_a_phone(server: str, page: Page):
    page.goto(f"{server}/ui/")
    page.get_by_role("button", name="More").tap()
    page.get_by_role("menuitem", name="Settings").tap()
    dialog = page.get_by_role("dialog", name="Settings")
    expect(dialog).to_be_visible()
    no_sideways_scroll(page, "[role=dialog]")
    inside_viewport(page, dialog.get_by_role("button", name="Save"))
    for name in ("Close", "Cancel", "Save"):
        at_least_a_tap(dialog.get_by_role("button", name=name, exact=True))
    dialog.get_by_role("button", name="Cancel").tap()
    expect(page.get_by_role("dialog", name="New game")).to_be_visible()
