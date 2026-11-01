"""The web app in a browser, on a real `langgraph dev` with a fake model: a setup's settings
reach the agent. Needs the built UI (`mise run build`) and Chromium; run with `mise run test:e2e`.
"""

import json
import os
import time
from collections.abc import Callable, Iterator
from contextlib import AbstractContextManager, suppress
from itertools import pairwise
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

import pytest
from langgraph_sdk import get_sync_client
from langgraph_sdk.errors import NotFoundError
from playwright.sync_api import Locator, Page, Request, Route, expect, sync_playwright

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
    "small": {
        "viewport": {"width": 320, "height": 568},
        "has_touch": True,
        "is_mobile": True,
        "device_scale_factor": 2,
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
    """Nothing overflows sideways: the document, `main` (which clips it), and `selector`'s
    element within its own width and the viewport."""
    widths = page.evaluate(
        """(selector) => {
          const measure = (el) =>
            el ? { scroll: el.scrollWidth, client: el.clientWidth,
                   right: el.getBoundingClientRect().right } : null;
          return {
            inner: window.innerWidth,
            doc: document.documentElement.scrollWidth,
            main: measure(document.querySelector("main")),
            el: selector ? measure(document.querySelector(selector)) : null,
          };
        }""",
        selector,
    )
    assert widths["doc"] <= widths["inner"], widths
    for name in ("main", "el"):
        box = widths[name]
        if box is not None:
            assert box["scroll"] <= box["client"], (name, widths)
            assert box["right"] <= widths["inner"], (name, widths)


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
    page.get_by_role("radiogroup", name="Play As").get_by_text("Black", exact=True).click()
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
    expect(page.get_by_label("black player").get_by_text("Your turn")).to_be_visible()


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
    expect(dialog.get_by_text("Sign-in needed")).to_be_visible()

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
    expect(dialog.get_by_text("This server needs no sign-in.")).to_be_visible()
    inside_viewport(page, dialog.get_by_role("button", name="Done"))
    for name in ("Close", "Done"):
        at_least_a_tap(dialog.get_by_role("button", name=name, exact=True))
    dialog.get_by_role("button", name="Done").tap()
    expect(page.get_by_role("dialog", name="New game")).to_be_visible()


def square(page: Page, name: str) -> Locator:
    return page.locator(f"[data-square={name}]")


def moves_of(server: str, page: Page, count: int) -> list[str]:
    """The thread's moves once it has `count` of them."""
    page.wait_for_url("**/ui/?thread=*")
    thread = parse_qs(urlparse(page.url).query)["thread"][0]
    client = get_sync_client(url=server)
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        with suppress(NotFoundError):
            moves = client.threads.get_state(thread)["values"].get("moves") or []
            if len(moves) >= count:
                return moves
        time.sleep(0.2)
    pytest.fail(f"the thread never reached {count} moves")


def drag(page: Page, source: Locator, target: Locator) -> None:
    """A real press, move and release: the board's drag sensor ignores a single jump."""
    start, end = source.bounding_box(), target.bounding_box()
    assert start is not None
    assert end is not None
    page.mouse.move(start["x"] + start["width"] / 2, start["y"] + start["height"] / 2)
    page.mouse.down()
    page.mouse.move(end["x"] + end["width"] / 2, end["y"] + end["height"] / 2, steps=12)
    page.mouse.up()


@pytest.mark.parametrize("page", ["portrait"], indirect=True)
def test_a_phone_plays_a_move_with_two_taps(server: str, page: Page):
    open_a_game(server, page)
    no_sideways_scroll(page)
    square(page, "e2").tap()
    square(page, "e4").tap()
    assert moves_of(server, page, 2)[0] == "e2e4"
    expect(page.get_by_label("white player").get_by_text("Your turn")).to_be_visible()
    no_sideways_scroll(page)


def test_desktop_plays_a_move_by_dragging(server: str, page: Page):
    page.goto(f"{server}/ui/")
    page.get_by_role("button", name="Play", exact=True).click()
    expect(page.get_by_role("dialog")).to_have_count(0)
    drag(page, square(page, "d2"), square(page, "d4"))
    assert moves_of(server, page, 2)[0] == "d2d4"
    no_sideways_scroll(page)
    no_sideways_scroll(page, "[data-slot=table]")


def test_the_reply_card_shows_the_turn_stage_by_stage(server: str, page: Page):
    page.goto(f"{server}/ui/")
    page.get_by_role("button", name="Play", exact=True).click()
    square(page, "e2").click()
    square(page, "e4").click()
    card = page.get_by_label("last reply", exact=True)
    expect(card.get_by_text("LLM chose")).to_be_visible()
    system_one = card.get_by_role("region", name="System 1 stage")
    expect(system_one.get_by_label("system 1 moves")).to_be_visible()
    expect(system_one.get_by_text("asked the LLM")).to_be_visible()
    expect(card.get_by_role("region", name="LLM stage")).to_contain_text("MOVE:")
    expect(card.get_by_label("game so far")).to_contain_text("1 move")


@pytest.mark.parametrize("page", ["portrait"], indirect=True)
def test_a_phone_customizes_the_reply_card_with_taps(server: str, page: Page):
    open_a_game(server, page)
    square(page, "e2").tap()
    square(page, "e4").tap()
    card = page.get_by_label("last reply", exact=True)
    expect(card.get_by_text("LLM chose")).to_be_visible()
    for name in ("Customize", "Hide System 1", "Hide LLM"):
        at_least_a_tap(card.get_by_role("button", name=name, exact=True))
    card.get_by_role("button", name="Customize", exact=True).tap()
    tokens = page.get_by_role("switch", name="Token details")
    expect(tokens).to_be_visible()
    tokens.tap()
    expect(card.get_by_label("token details").first).to_be_visible()
    no_sideways_scroll(page)


@pytest.mark.parametrize("page", ["landscape"], indirect=True)
def test_a_phone_on_its_side_never_scrolls_sideways(server: str, page: Page):
    open_a_game(server, page)
    no_sideways_scroll(page)
    no_sideways_scroll(page, "[data-slot=table]")
    inside_viewport(page, square(page, "a1"))


def seeded(server: str, fen: str) -> str:
    """A thread from `fen`, Black to move: the agent answers, and the human plays White."""
    client = get_sync_client(url=server)
    thread = client.threads.create()["thread_id"]
    client.runs.wait(thread, "chess", input={"position": {"start_fen": fen}})
    return thread


@pytest.mark.parametrize("page", ["portrait"], indirect=True)
def test_a_phone_promotes_on_a_flipped_board_and_can_cancel(server: str, page: Page):
    thread = seeded(server, "4k3/P6P/8/8/8/8/8/4K3 b - - 0 1")
    page.goto(f"{server}/ui/?thread={thread}")
    expect(page.get_by_label("white player").get_by_text("Your turn")).to_be_visible()
    page.get_by_role("button", name="Flip board").tap()
    square(page, "a7").tap()
    square(page, "a8").tap()
    page.get_by_role("button", name="Cancel promotion").tap()
    expect(page.get_by_role("group", name="Promote to")).to_have_count(0)
    square(page, "a7").tap()
    square(page, "a8").tap()
    knight = page.get_by_role("button", name="Promote to knight")
    at_least_a_tap(knight)
    knight.tap()
    moves = moves_of(server, page, 3)
    assert moves[1] == "a7a8n"


@pytest.mark.parametrize("page", ["small"], indirect=True)
@pytest.mark.parametrize("flip", [False, True])
def test_a_small_phone_s_promotion_choices_fit_the_board(server: str, page: Page, flip: bool):
    thread = seeded(server, "4k3/P6P/8/8/8/8/8/4K3 b - - 0 1")
    page.goto(f"{server}/ui/?thread={thread}")
    expect(page.get_by_label("white player").get_by_text("Your turn")).to_be_visible()
    if flip:
        page.get_by_role("button", name="Flip board").tap()
    square(page, "a7").tap()
    square(page, "a8").tap()
    board = page.locator("[data-slot=board]").bounding_box()
    assert board is not None
    boxes = []
    for piece in ("queen", "knight", "rook", "bishop"):
        box = page.get_by_role("button", name=f"Promote to {piece}").bounding_box()
        assert box is not None
        assert box["width"] >= MIN_TAP, box
        assert box["height"] >= MIN_TAP, box
        assert box["x"] >= board["x"] - 0.5, (box, board)
        assert box["x"] + box["width"] <= board["x"] + board["width"] + 0.5, (box, board)
        assert box["y"] >= board["y"] - 0.5, (box, board)
        assert box["y"] + box["height"] <= board["y"] + board["height"] + 0.5, (box, board)
        boxes.append(box)
    for above, below in pairwise(boxes):
        top, bottom = sorted((above, below), key=lambda b: b["y"])
        assert top["y"] + top["height"] <= bottom["y"] + 0.5, (top, bottom)


def test_desktop_resigns_after_one_move(server: str, page: Page):
    page.goto(f"{server}/ui/")
    page.get_by_role("button", name="Play", exact=True).click()
    expect(page.get_by_role("dialog")).to_have_count(0)
    drag(page, square(page, "e2"), square(page, "e4"))
    moves_of(server, page, 2)
    page.get_by_role("button", name="Resign").click()
    page.get_by_role("button", name="Confirm resignation").click()
    expect(page.get_by_label("white player").get_by_text("Resigned")).to_be_visible()
    expect(page.get_by_label("black player").get_by_text("Won")).to_be_visible()
    thread = parse_qs(urlparse(page.url).query)["thread"][0]
    outcome = get_sync_client(url=server).threads.get_state(thread)["values"]["outcome"]
    assert outcome == {"kind": "resignation", "winner": "black", "reason": "resigned"}


def test_a_game_from_a_fen_where_the_agent_is_to_move_starts_itself(server: str, page: Page):
    fen = "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1"
    page.goto(f"{server}/ui/")
    page.get_by_role("radiogroup", name="Play As").get_by_text("Black", exact=True).click()
    page.get_by_label("Starting position").fill(fen)
    expect(page.get_by_label("starting position preview")).to_be_visible()
    page.get_by_role("button", name="Play", exact=True).click()
    moves_of(server, page, 1)
    thread = parse_qs(urlparse(page.url).query)["thread"][0]
    values = get_sync_client(url=server).threads.get_state(thread)["values"]
    assert values["start_fen"] == fen
    expect(page.get_by_label("black player").get_by_text("Your turn")).to_be_visible()


def test_a_first_move_the_server_took_but_never_heard_back_from_is_played_once(
    server: str, page: Page
):
    fen = "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1"
    starts: list[Any] = []

    def record(request: Request) -> None:
        body = json.loads(request.post_data or "{}")
        if request.url.endswith("/commands") and body.get("method") == "run.start":
            starts.append(body["params"]["input"])

    def drop_the_answer(route: Route) -> None:
        # The server runs the packet; the page never hears back.
        route.fetch()
        route.abort()

    page.on("request", record)
    page.route("**/commands", drop_the_answer, times=1)
    page.goto(f"{server}/ui/")
    page.get_by_label("Starting position").fill(fen)
    page.get_by_role("button", name="Play", exact=True).click()
    expect(page.get_by_role("dialog")).to_have_count(0)
    square(page, "e2").click()
    square(page, "e4").click()
    moves_of(server, page, 2)
    expect(page.get_by_label("white player").get_by_text("Your turn")).to_be_visible()
    # Whoever resent it, the SDK or Retry, sent the same packet, and the server played it once.
    first = {"position": {"start_fen": fen, "moves": ["e2e4"]}}
    assert len(starts) >= 2
    assert all(start == first for start in starts)
    thread = parse_qs(urlparse(page.url).query)["thread"][0]
    values = get_sync_client(url=server).threads.get_state(thread)["values"]
    assert len(values["moves"]) == 2
    assert len(values["turns"]) == 1
    assert values["start_fen"] == fen
