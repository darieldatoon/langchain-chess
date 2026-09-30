import { fireEvent, render, screen, within } from "@testing-library/react";
import {
  DEFAULT_DISPLAY_PREFS,
  type OpeningTable,
  positionKey,
  replay,
  START_FEN,
  withAlpha,
} from "@langchain-chess/chess-ui";
import { CHART_STATUS_COLORS } from "@langchain/macaw-components/utils/chartColors";
import { describe, expect, it, vi } from "vite-plus/test";
import userEvent from "@testing-library/user-event";
import { openMenu } from "./support/menus";
import { EvalBar } from "../src/components/EvalBar";
import { GameList } from "../src/components/GameList";
import { game, graded, UNGRADED, values } from "./support/fixtures";
import { board } from "./support/mocks";
import { current, key, renderView, resolved, viewElement, viewProps } from "./support/view";

vi.mock("react-chessboard", async () => (await import("./support/mocks")).chessboardMock());
vi.mock("@langchain/macaw-components/LineChart", async () =>
  (await import("./support/mocks")).lineChartMock(),
);
vi.mock("@langchain/macaw-components/BarChart", async () =>
  (await import("./support/mocks")).barChartMock(),
);

describe("EvalBar", () => {
  it("fills White's share from the bottom, or the top when flipped", () => {
    const { rerender, container } = render(<EvalBar value={{ cp: 0 }} flipped={false} />);
    expect(screen.getByTestId("eval-white")).toHaveStyle({ height: "50%" });
    expect(container.firstChild?.firstChild).toHaveClass("flex-col-reverse");
    rerender(<EvalBar value={{ mate: 2, winner: "black" }} flipped />);
    expect(screen.getByLabelText("evaluation -#2")).toBeInTheDocument();
    expect(container.firstChild?.firstChild).not.toHaveClass("flex-col-reverse");
  });
});

const GAME_LIST = {
  selected: null,
  loading: false,
  onSelect: () => {},
  onMore: null,
  onRefresh: () => {},
  refreshing: false,
  now: new Date("2026-09-25T12:00:00Z"),
  openings: null,
};

describe("GameList", () => {
  const base = {
    selected: null,
    loading: false,
    onSelect: vi.fn(),
    onMore: null,
    onRefresh: vi.fn(),
    refreshing: false,
    now: new Date("2026-09-25T12:00:00Z"),
    openings: null,
  };

  it("lists games with their result, plies and accuracy", () => {
    const onSelect = vi.fn();
    const games = [
      game(),
      game({
        threadId: "t2",
        grading: UNGRADED,
        values: values({ moves: ["e2e4"], outcome: null }),
      }),
      game({
        threadId: "t3",
        values: null,
        grading: graded({ accuracy: { white: 88, black: null } }),
      }),
      game({ threadId: "t4", grading: graded({ accuracy: { white: null, black: 70 } }) }),
      game({ threadId: "t5", grading: { status: "invalid", problem: "it is not an object" } }),
    ];
    render(<GameList {...base} games={games} selected="t2" onSelect={onSelect} />);
    expect(screen.getAllByText("1-0")).toHaveLength(3);
    expect(screen.getByText("98 / 61")).toBeInTheDocument();
    expect(screen.getByText(/· 1 ply$/)).toBeInTheDocument();
    expect(screen.getAllByText(/· 7 plies$/)).toHaveLength(3);
    expect(screen.getByText("Not graded")).toBeInTheDocument();
    expect(screen.getByText("No record")).toBeInTheDocument();
    expect(screen.getByText("88 / –")).toBeInTheDocument();
    expect(screen.getByText("– / 70")).toBeInTheDocument();
    expect(screen.getByText("Unreadable review")).toBeInTheDocument();
    const [, ...rows] = screen.getAllByRole("button");
    expect(rows[1]).toHaveAttribute("aria-current", "true");
    fireEvent.click(rows[2]);
    expect(onSelect).toHaveBeenCalledWith("t3");
  });

  it("shows where each game's analysis stands, and refreshes", () => {
    const onRefresh = vi.fn();
    const mark = (startedAt: string) => ({ status: "analyzing" as const, id: "m", startedAt });
    const games = [
      game({ threadId: "t1", mark: mark("2026-09-25T11:58:00Z") }),
      game({ threadId: "t2", mark: mark("2026-09-25T11:00:00Z") }),
      game({ threadId: "t3", mark: { status: "failed", id: "m", log: "" } }),
    ];
    render(<GameList {...base} games={games} onRefresh={onRefresh} />);
    expect(screen.getByText("Analyzing…")).toBeInTheDocument();
    expect(screen.getByText("Analysis didn't finish")).toBeInTheDocument();
    expect(screen.getByText("Analysis failed")).toBeInTheDocument();
    expect(screen.queryByText("98 / 61")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(onRefresh).toHaveBeenCalled();
  });

  it("shows loading, empty and load-more states", () => {
    const onMore = vi.fn();
    const { rerender } = render(<GameList {...base} games={[]} loading />);
    expect(screen.queryByText("No games in this window.")).toBeNull();
    rerender(<GameList {...base} games={[]} />);
    expect(screen.getByText("No games in this window.")).toBeInTheDocument();
    rerender(<GameList {...base} games={[game()]} onMore={onMore} />);
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(onMore).toHaveBeenCalled();
  });
});

describe("GameView", () => {
  it("opens on the final position with its grade, result and who played it", () => {
    renderView();
    expect(current()).toBe("Qxf7#");
    expect(screen.getByLabelText("result")).toHaveTextContent("1-0Checkmate · White wins");
    expect(screen.getByLabelText("engine")).toBeInTheDocument();
    expect(screen.getByLabelText("who played it")).toHaveTextContent("Who Played It");
    expect(screen.getByLabelText("evaluation 1-0")).toBeInTheDocument();
    expect(board.options?.arrows).toHaveLength(1);
  });

  it("steps through the game by button, key, graph and move list", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Previous move" }));
    expect(current()).toBe("Nf6??");
    // The blunder: the move played and the better one.
    expect(board.options?.arrows).toHaveLength(2);
    // The result stays at the end of the list on every move.
    expect(screen.getByLabelText("result")).toBeInTheDocument();
    key("Home");
    expect(current()).toBe("Start");
    expect(board.options?.arrows).toEqual([]);
    expect(screen.getByRole("button", { name: "First move" })).toBeDisabled();
    key("ArrowLeft");
    expect(current()).toBe("Start");
    key("ArrowRight");
    expect(current()).toBe("e4");
    key("End");
    expect(current()).toBe("Qxf7#");
    key("a");
    expect(current()).toBe("Qxf7#");
    fireEvent.click(screen.getByRole("button", { name: "First move" }));
    fireEvent.click(screen.getByRole("button", { name: "Next move" }));
    expect(current()).toBe("e4");
    fireEvent.click(screen.getByRole("button", { name: "Last move" }));
    expect(current()).toBe("Qxf7#");
    const graph = screen.getByRole("button", { name: "White's winning chances by ply" });
    expect(graph).toHaveAttribute("data-x", "ply 3");
    expect(graph).toHaveAttribute("data-y", "50%");
    fireEvent.click(graph);
    expect(current()).toBe("Qh5");
    fireEvent.click(screen.getByRole("button", { name: /^Nc6/ }));
    expect(current()).toBe("Nc6");
  });

  it("steps on the wheel when asked to, and fades the arrows by grade", () => {
    renderView(game(), vi.fn(), { prefs: { ...DEFAULT_DISPLAY_PREFS, wheelSteps: true } });
    fireEvent.wheel(screen.getByTestId("board"), { deltaY: -100 });
    expect(current()).toBe("Nf6??");
    const [played, best] = board.options!.arrows as { color: string }[];
    // A blunder's arrow is the error colour and the best move's the success colour, both pale.
    expect(played.color).toBe(withAlpha(resolved(CHART_STATUS_COLORS.negative), 0.5));
    expect(best.color).toBe(withAlpha(resolved(CHART_STATUS_COLORS.positive), 0.5));
    key("ArrowLeft");
    const [good] = board.options!.arrows as { color: string }[];
    expect(good.color).toBe(withAlpha(resolved("var(--bg-brand)"), 0.5));
    fireEvent.wheel(screen.getByTestId("board"), { deltaY: 100 });
    expect(current()).toBe("Nf6??");
  });

  it("ignores keys typed into a field", () => {
    renderView();
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: "Home" });
    expect(current()).toBe("Qxf7#");
    input.remove();
  });

  it("names the strips, shows each side's accuracy and result, and lists the keys", () => {
    renderView();
    const white = screen.getByLabelText("white player");
    expect(white).toHaveTextContent("Won");
    expect(screen.getByLabelText("black player")).toHaveTextContent("Checkmated");
    expect(white.textContent).toMatch(/Accuracy \d+%/);
    key("Home");
    expect(
      within(screen.getByLabelText("who played it")).getByText("Start position."),
    ).toBeVisible();
    key("?");
    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("flips the board and opens the move's trace", () => {
    const onOpenTrace = vi.fn();
    renderView(game(), onOpenTrace);
    key("f");
    expect(board.options?.boardOrientation).toBe("black");
    key("f");
    expect(board.options?.boardOrientation).toBe("white");
    const last = { threadId: "thread-1", runId: "run-3", runStartTime: "2026-09-25T12:30:00Z" };
    fireEvent.click(screen.getByRole("button", { name: /Open trace/ }));
    expect(onOpenTrace).toHaveBeenLastCalledWith(last);
    // An earlier move's run, whose start time wasn't loaded.
    fireEvent.click(screen.getByRole("button", { name: /^Nc6/ }));
    fireEvent.click(screen.getByRole("button", { name: /Open trace/ }));
    expect(onOpenTrace).toHaveBeenLastCalledWith({ ...last, runId: "run-2", runStartTime: null });
    key("Home");
    fireEvent.click(screen.getByRole("button", { name: /Open trace/ }));
    expect(onOpenTrace).toHaveBeenLastCalledWith(last);
  });

  it("offers to analyze an ungraded game, which shows no engine output", () => {
    const onAnalyze = vi.fn();
    renderView(game({ grading: UNGRADED }), vi.fn(), { onAnalyze });
    expect(screen.getByText("Not graded yet")).toBeInTheDocument();
    expect(screen.getByText("lcchess grade --thread thread-1")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^evaluation/)).toBeNull();
    expect(screen.queryByLabelText("engine")).toBeNull();
    expect(screen.queryByRole("button", { name: "Re-analyze" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));
    expect(onAnalyze).toHaveBeenCalled();
  });

  it("says why a review can't be drawn instead of drawing it, and offers to redo it", () => {
    const onAnalyze = vi.fn();
    const g = game({ grading: { status: "invalid", problem: "evaluation 3 is malformed" } });
    renderView(g, vi.fn(), { onAnalyze });
    expect(screen.getByText(/evaluation 3 is malformed/)).toBeInTheDocument();
    expect(screen.getByText("lcchess grade --thread thread-1 --force")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^evaluation/)).toBeNull();
    expect(current()).toBe("Qxf7#");
    fireEvent.click(screen.getByRole("button", { name: "Re-analyze" }));
    expect(onAnalyze).toHaveBeenCalled();
  });

  it("re-analyzes a graded game from the board's controls", () => {
    const onAnalyze = vi.fn();
    const { rerender } = renderView(game(), vi.fn(), { onAnalyze });
    fireEvent.click(screen.getByRole("button", { name: "Re-analyze" }));
    expect(onAnalyze).toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
    rerender(
      viewElement(viewProps(game(), vi.fn(), { onAnalyze, launch: { status: "starting" } })),
    );
    expect(screen.getByRole("button", { name: /Re-analyze/ })).toBeDisabled();
  });

  it("shows a running analysis, and hides the button meanwhile", () => {
    renderView(game(), vi.fn(), { analysis: { status: "analyzing" } });
    expect(screen.getByText("Analyzing…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /analyze/i })).toBeNull();
    expect(screen.getByLabelText("engine")).toBeInTheDocument();
    renderView(game({ grading: UNGRADED }), vi.fn(), { launch: { status: "started" } });
    expect(screen.getAllByText("Analyzing…")).toHaveLength(2);
    expect(screen.queryByText("Not graded yet")).toBeNull();
  });

  it("offers a retry after an analysis stalls, fails or can't start", () => {
    const onAnalyze = vi.fn();
    const mark = { status: "failed" as const, id: "m", log: "RuntimeError: engine died" };
    renderView(game({ grading: UNGRADED }), vi.fn(), {
      analysis: { status: "stalled", mark },
      onAnalyze,
    });
    expect(screen.getByText("Analysis didn't finish")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onAnalyze).toHaveBeenCalledTimes(1);

    renderView(game(), vi.fn(), { analysis: { status: "failed", mark, log: mark.log } });
    expect(screen.getByText("Analysis failed")).toBeInTheDocument();
    expect(screen.getByText("RuntimeError: engine died")).toBeInTheDocument();
    renderView(game(), vi.fn(), { analysis: { status: "failed", mark, log: "" } });
    expect(screen.getByText("The job left no log.")).toBeInTheDocument();

    renderView(game(), vi.fn(), {
      launch: { status: "error", message: "Sandboxes aren't enabled for this organization." },
    });
    expect(screen.getByText("Analysis couldn't start")).toBeInTheDocument();
    expect(screen.getByText(/Sandboxes aren't enabled/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Re-analyze" })).toBeNull();
  });

  it("copes with missing plies, turns and moves", () => {
    const root = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 5";
    const bare = game({
      grading: UNGRADED,
      values: values({
        start_fen: root,
        moves: ["e7e5", "a1a8"],
        plies: undefined,
        turns: undefined,
      }),
    });
    renderView(bare);
    // Without records, SAN is replayed; a move that doesn't replay shows as UCI.
    expect(current()).toBe("a1a8");
    expect(screen.getByRole("button", { name: "e5" })).toBeInTheDocument();
    const once = game({
      grading: UNGRADED,
      values: values({ start_fen: root, moves: undefined, outcome: null }),
    });
    renderView(once);
    expect(screen.getAllByRole("button", { name: "Last move" }).at(-1)).toBeDisabled();
  });

  it("steps through a game that starts with Black to move", () => {
    const root = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 5";
    const g = game({
      grading: UNGRADED,
      values: values({
        start_fen: root,
        moves: ["e7e5", "g1f3"],
        plies: values()
          .plies!.slice(0, 2)
          .map((p, i) => ({ ...p, san: ["e5", "Nf3"][i] })),
        turns: undefined,
        outcome: null,
      }),
    });
    renderView(g);
    expect(current()).toBe("Nf3");
    expect(screen.queryByLabelText("result")).not.toBeInTheDocument();
    key("ArrowLeft");
    expect(current()).toBe("e5");
  });
});

describe("openings and export in the review", () => {
  const TABLE: OpeningTable = {
    [positionKey(replay(START_FEN, ["e2e4", "e7e5"]).fen)]: ["C20", "King's Pawn Game"],
  };

  it("puts the opening in a copied PGN", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderView(game(), vi.fn(), { openings: TABLE });
    await openMenu("Board menu");
    await userEvent.click(screen.getByRole("menuitem", { name: "Copy PGN" }));
    expect(writeText.mock.lastCall![0]).toMatch(/\{\[%eval [^\]]+\] C20 King's Pawn Game\}/);
  });

  it("names the opening over the moves, marks its move, and in the game list", () => {
    renderView(game(), vi.fn(), { openings: TABLE });
    expect(screen.getByLabelText("opening")).toHaveTextContent("C20 · King's Pawn Game");
    expect(
      screen.getByRole("button", { name: "Opening: C20 · King's Pawn Game" }),
    ).toBeInTheDocument();
    render(
      <GameList
        {...GAME_LIST}
        games={[
          game(),
          game({ threadId: "t-bare", values: null }),
          game({ threadId: "t-empty", values: {} }),
        ]}
        openings={TABLE}
      />,
    );
    expect(within(screen.getByLabelText("games")).getAllByLabelText("opening")).toHaveLength(1);
    expect(within(screen.getByLabelText("games")).getByLabelText("opening")).toHaveTextContent(
      "C20 · King's Pawn Game",
    );
  });

  it("copies the FEN and the graded PGN, and opens the game on Lichess in a new tab", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const openUrl = vi.fn();
    renderView(game(), vi.fn(), { openUrl });
    await openMenu("Board menu");
    await userEvent.click(screen.getByRole("menuitem", { name: "Copy PGN" }));
    const pgn = writeText.mock.lastCall![0];
    expect(pgn).toContain('[Site "LangSmith"]');
    expect(pgn).toContain("$4");
    expect(pgn).toContain("[%eval");
    expect(await screen.findByLabelText("export")).toHaveTextContent("Copied the PGN.");
    await openMenu("Board menu");
    await userEvent.click(screen.getByRole("menuitem", { name: "Copy FEN" }));
    expect(writeText).toHaveBeenLastCalledWith(
      values().start_fen ? expect.any(String) : expect.stringContaining(" w "),
    );
    await openMenu("Board menu");
    await userEvent.click(screen.getByRole("menuitem", { name: "Analyze on Lichess" }));
    expect(openUrl).toHaveBeenCalledWith(expect.stringContaining("lichess.org/analysis/pgn/"), {
      newTab: true,
    });
    expect(screen.queryByLabelText("export")).not.toBeInTheDocument();
  });

  // 1,600 plies, the heaviest render in the suite: a loaded runner needs more than 5s.
  it("says when the browser refuses a copy, and when a game is too long for a link", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: () => Promise.reject(new Error("denied")) },
      configurable: true,
    });
    const long = values({
      moves: Array.from({ length: 1600 }, (_, i) => ["g1f3", "g8f6", "f3g1", "f6g8"][i % 4]),
      plies: [],
      outcome: null,
    });
    renderView(game({ values: long, grading: { status: "ungraded" } }), vi.fn());
    await openMenu("Board menu");
    await userEvent.click(screen.getByRole("menuitem", { name: "Copy FEN" }));
    expect(await screen.findByLabelText("export")).toHaveTextContent(
      "The browser didn't allow copying.",
    );
    await openMenu("Board menu");
    await userEvent.click(screen.getByRole("menuitem", { name: "Analyze on Lichess" }));
    expect(screen.getByLabelText("export")).toHaveTextContent(
      "Opened the position; the game was too long to send.",
    );
  }, 20_000);
});
