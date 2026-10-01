import { fireEvent, screen, within } from "@testing-library/react";
import { DEFAULT_DISPLAY_PREFS, replay, START_FEN } from "@langchain-chess/chess-ui";
import { systemOne } from "@langchain-chess/chess-ui/testing";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import userEvent from "@testing-library/user-event";
import { getCategoricalFillChartColor } from "@langchain/macaw-components/utils/chartColors";
import { game, MOVES, review, UNGRADED, values } from "./support/fixtures";
import { openMenu } from "./support/menus";
import { board, charts } from "./support/mocks";
import { current, key, renderView } from "./support/view";

vi.mock("react-chessboard", async () => (await import("./support/mocks")).chessboardMock());
vi.mock("@langchain/macaw-components/LineChart", async () =>
  (await import("./support/mocks")).lineChartMock(),
);
vi.mock("@langchain/macaw-components/BarChart", async () =>
  (await import("./support/mocks")).barChartMock(),
);

afterEach(() => vi.restoreAllMocks());

const FENS = replay(START_FEN, MOVES).fens;
/** 3...d5 4.Bxd5, the engine's line instead of the blunder. */
const LINE = replay(FENS[5], ["d7d5", "c4d5"]).fens;
const position = () => board.options?.position;
const lines = () => within(screen.getByLabelText("engine lines"));
const bar = () => within(screen.getByRole("group", { name: "preview" }));

describe("engine output", () => {
  it("heads the tools with the engine, the evaluation and the move's facts", () => {
    renderView();
    const engine = within(screen.getByLabelText("engine"));
    expect(engine.getByText("Stockfish 19 · depth 16 · Graded analysis")).toBeInTheDocument();
    expect(engine.getByLabelText("evaluation")).toHaveTextContent("1-0");
    expect(engine.getByText("Best move: Qxf7#")).toBeInTheDocument();
    expect(engine.getByLabelText("move facts")).toHaveTextContent(
      "#1 → 1-0 · 0.0% chances lost · 0 cp lost · 100% accuracy",
    );
    // Qxf7# has no lines, but keeps the row the blunder's line needs.
    expect(lines().getByText("Before 4. Qxf7#")).toBeInTheDocument();
    expect(screen.getByLabelText("engine lines").children).toHaveLength(2);
    key("ArrowLeft");
    expect(lines().getByText("Before 3… Nf6")).toBeInTheDocument();
    expect(lines().getByText("+0.3")).toBeInTheDocument();
    expect(lines().getByText("3…")).toBeInTheDocument();
    expect(lines().getByRole("button", { name: "Bxd5" })).toBeInTheDocument();
    key("Home");
    expect(screen.getByLabelText("move facts")).toHaveTextContent("Start position.");
    expect(screen.queryByLabelText("engine lines")).toBeNull();
  });

  it("shows each move's eval, and a note under a flaw unless notes are off", () => {
    const { unmount } = renderView();
    const evals = document.querySelectorAll("[data-eval]");
    expect([...evals].map((e) => e.textContent)).toEqual([
      "+0.3",
      "+0.3",
      "-0.2",
      "+0.4",
      "+0.3",
      "#1",
      "1-0",
    ]);
    const note = screen.getByLabelText("mistake note");
    expect(note).toHaveTextContent("Blunder. d5 was best.d5 Bxd5");
    expect(note).toHaveClass("bg-error-subtle");
    unmount();
    renderView(game(), vi.fn(), { prefs: { ...DEFAULT_DISPLAY_PREFS, mistakeNotes: false } });
    expect(screen.queryByLabelText("mistake note")).toBeNull();
  });
});

describe("preview", () => {
  it("offers no preview of a System 1 move that can't be played there", () => {
    const top = systemOne({ top: [{ uci: "a1a8", probability: 0.5 }] });
    const plies = values().plies!.map((p) =>
      p.ply === 5 ? { ...p, source: "systemone", meta: { SystemOneMiddleware: { ...top } } } : p,
    );
    renderView(game({ values: values({ plies }) }));
    key("ArrowLeft");
    expect(screen.queryByRole("button", { name: "Preview a1a8" })).toBeNull();
    expect(within(screen.getByLabelText("system 1 moves")).getByText("a1a8")).toBeInTheDocument();
    expect(position()).toBe(FENS[6]);
  });

  it("names the cursor's own move when records are missing before it", () => {
    const plies = values().plies!.filter((p) => p.ply !== 0 && p.ply !== 5);
    renderView(game({ values: values({ plies }) }));
    key("ArrowLeft");
    expect(lines().getByText("Before 3… Nf6")).toBeInTheDocument();
    key("Home");
    key("ArrowRight");
    expect(current()).toBe("e4");
  });

  it("shows the engine's lines for a graded game with no ply records", () => {
    renderView(game({ values: values({ plies: undefined }) }));
    key("ArrowLeft");
    expect(lines().getByText("Before 3… Nf6")).toBeInTheDocument();
    fireEvent.click(lines().getByRole("button", { name: "d5" }));
    expect(position()).toBe(LINE[1]);
  });

  it("pins a line without moving the cursor, and keeps the keys inside it", () => {
    renderView();
    key("ArrowLeft");
    expect(position()).toBe(FENS[6]);
    fireEvent.click(lines().getByRole("button", { name: "d5" }));
    expect(position()).toBe(LINE[1]);
    expect(current()).toBe("Nf6??");
    expect(board.options?.arrows).toEqual([]);
    expect(bar().getByRole("button", { name: "Previous preview move" })).toBeDisabled();
    key("ArrowRight");
    expect(position()).toBe(LINE[2]);
    // The strips follow the preview: White has won a pawn.
    expect(screen.getByLabelText("white player")).toHaveTextContent("+1");
    key("ArrowRight");
    expect(position()).toBe(LINE[2]);
    expect(bar().getByRole("button", { name: "Next preview move" })).toBeDisabled();
    key("Home");
    expect(position()).toBe(LINE[1]);
    key("End");
    expect(position()).toBe(LINE[2]);
    // The game's keys are suspended: no flip, no help, no step.
    key("f");
    key("?");
    key("a");
    expect(board.options?.boardOrientation).toBe("white");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(current()).toBe("Nf6??");
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: "ArrowLeft" });
    input.remove();
    expect(position()).toBe(LINE[2]);
    key("Escape");
    expect(position()).toBe(FENS[6]);
    expect(screen.queryByRole("group", { name: "preview" })).toBeNull();
    key("ArrowLeft");
    expect(current()).toBe("Bc4");
  });

  it("steps by the bar's buttons and moves, and leaves by Back to game or a cursor change", () => {
    renderView();
    key("ArrowLeft");
    fireEvent.click(lines().getByRole("button", { name: "d5" }));
    expect(lines().getByRole("button", { name: "d5" })).toHaveClass("bg-brand");
    fireEvent.click(bar().getByRole("button", { name: "Next preview move" }));
    expect(position()).toBe(LINE[2]);
    fireEvent.click(bar().getByRole("button", { name: "Previous preview move" }));
    expect(position()).toBe(LINE[1]);
    fireEvent.click(bar().getByRole("button", { name: "Bxd5" }));
    expect(bar().getByRole("button", { name: "Bxd5" })).toHaveAttribute("aria-current", "step");
    fireEvent.click(bar().getByRole("button", { name: "Back to game" }));
    expect(position()).toBe(FENS[6]);
    fireEvent.click(lines().getByRole("button", { name: "Bxd5" }));
    expect(position()).toBe(LINE[2]);
    fireEvent.click(screen.getByRole("button", { name: /^Nc6/ }));
    expect(current()).toBe("Nc6");
    expect(screen.queryByRole("group", { name: "preview" })).toBeNull();
  });

  it("previews on hover until the pointer leaves, but not over a pinned line", () => {
    renderView();
    key("ArrowLeft");
    fireEvent.mouseEnter(lines().getByRole("button", { name: "Bxd5" }));
    expect(position()).toBe(LINE[2]);
    expect(screen.queryByRole("group", { name: "preview" })).toBeNull();
    fireEvent.mouseLeave(lines().getByRole("button", { name: "Bxd5" }));
    expect(position()).toBe(FENS[6]);
    fireEvent.click(lines().getByRole("button", { name: "d5" }));
    fireEvent.mouseEnter(lines().getByRole("button", { name: "Bxd5" }));
    expect(position()).toBe(LINE[1]);
  });

  it("doesn't preview on hover for a finger", () => {
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query: string) =>
        ({
          matches: query.includes("coarse"),
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList,
    );
    renderView();
    key("ArrowLeft");
    fireEvent.mouseEnter(lines().getByRole("button", { name: "Bxd5" }));
    expect(position()).toBe(FENS[6]);
    fireEvent.click(lines().getByRole("button", { name: "Bxd5" }));
    expect(position()).toBe(LINE[2]);
  });

  it("previews System 1's top moves from the position the move was chosen in", () => {
    const top = systemOne({
      top: [
        { uci: "g8f6", probability: 0.6 },
        { uci: "d7d5", probability: 0.3 },
      ],
    });
    const plies = values().plies!.map((p) =>
      p.ply === 5 ? { ...p, source: "systemone", meta: { SystemOneMiddleware: { ...top } } } : p,
    );
    renderView(game({ values: values({ plies }) }));
    key("ArrowLeft");
    const d5 = screen.getByRole("button", { name: "Preview d5" });
    fireEvent.mouseEnter(d5);
    expect(position()).toBe(LINE[1]);
    fireEvent.mouseLeave(d5);
    expect(position()).toBe(FENS[6]);
    fireEvent.click(d5);
    expect(position()).toBe(LINE[1]);
    expect(d5).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Preview Nf6" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(bar().getByRole("button", { name: "Next preview move" })).toBeDisabled();
    // An engine line's pin marks no System 1 move.
    fireEvent.click(lines().getByRole("button", { name: "d5" }));
    expect(d5).toHaveAttribute("aria-pressed", "false");
  });
});

describe("summary", () => {
  it("counts each side's flaws, jumps to the next, and splits by source", () => {
    renderView();
    const black = within(screen.getByLabelText("black summary"));
    const white = within(screen.getByLabelText("white summary"));
    expect(white.getByRole("button", { name: "0 blunders" })).toBeDisabled();
    expect(white.getByLabelText("accuracy")).toHaveTextContent("Accuracy 98%");
    expect(black.getByLabelText("accuracy")).toHaveTextContent("Accuracy 61%");
    expect(black.getByText("Average centipawn loss 333")).toBeInTheDocument();
    expect(black.getByLabelText("LLM")).toHaveTextContent(
      "LLM · 3 moves · 0 ?! · 0 ? · 1 ?? · ACPL 333 · mean move accuracy 71%",
    );
    fireEvent.click(black.getByRole("button", { name: "1 blunder" }));
    expect(current()).toBe("Nf6??");
    fireEvent.click(black.getByRole("button", { name: "1 blunder" }));
    expect(current()).toBe("Nf6??");
  });

  it("dashes a side with no accuracy or graded moves", () => {
    const r = review({
      accuracy: { white: null, black: 40 },
      plies: review().plies.map((p) => ({ ...p, side: "black" as const })),
    });
    renderView(game({ grading: { status: "graded", review: r } }));
    const white = within(screen.getByLabelText("white summary"));
    expect(white.getByLabelText("accuracy")).toHaveTextContent("Accuracy —");
    expect(white.getByText("Average centipawn loss —")).toBeInTheDocument();
    expect(white.queryByRole("list")).toBeNull();
  });
});

describe("tabs under the board", () => {
  it("draws the grades on the graph as points on the line", () => {
    renderView();
    const series = charts.line!.series as {
      id: string;
      strokeWidth?: number;
      points: { x: number; y: number | null }[];
    }[];
    expect(series.map((s) => s.id)).toEqual(["white", "inaccuracy", "mistake", "blunder"]);
    expect(charts.line!.showPoints).toBe(true);
    const blunders = series[3];
    expect(blunders.strokeWidth).toBe(0);
    expect(blunders.points.filter((p) => p.y !== null)).toEqual([
      { x: 6, y: series[0].points[6].y },
    ]);
    expect(series[1].points.every((p) => p.y === null)).toBe(true);
  });

  it("times the agent's moves, reads out the bar under the pointer, and jumps on a click", async () => {
    renderView();
    await userEvent.click(screen.getByRole("tab", { name: "Agent latency" }));
    const chart = within(screen.getByRole("group", { name: "Agent latency by ply" }));
    expect(screen.getByRole("group", { name: "Agent latency by ply" })).toHaveAttribute(
      "data-y",
      "2 s",
    );
    expect(chart.getAllByRole("button")).toHaveLength(3);
    const readout = screen.getByLabelText("latency readout");
    expect(readout).toHaveTextContent("4. Qxf7# · Human · no agent turn");
    const e5 = chart.getByRole("button", { name: "1… e5 · LLM chose · 0.0 s · —" });
    fireEvent.mouseEnter(e5);
    expect(readout).toHaveTextContent("1… e5 · LLM chose");
    fireEvent.mouseLeave(e5);
    expect(readout).toHaveTextContent("4. Qxf7#");
    fireEvent.click(e5);
    expect(current()).toBe("e5");
    key("Home");
    expect(readout).toHaveTextContent(/^$/);
  });

  it("colours sources in a fixed order, a new one last, and names it in the summary", async () => {
    const plies = values().plies!.map((p) => (p.ply === 1 ? { ...p, source: "oracle" } : p));
    renderView(game({ values: values({ plies }) }), vi.fn(), { tab: "latency" });
    const series = charts.bar!.series as { id: string; color: string }[];
    expect(series.map((s) => s.id)).toEqual(["llm", "oracle"]);
    // LLM keeps its colour whether or not System 1 played in this game.
    expect(series.map((s) => s.color)).toEqual([
      getCategoricalFillChartColor(1),
      getCategoricalFillChartColor(3),
    ]);
    expect(
      within(screen.getByLabelText("black summary")).getByLabelText("oracle"),
    ).toHaveTextContent("oracle · 1 move");
  });

  it("says when there are no agent moves to time", async () => {
    const plies = values().plies!.map((p) => ({ ...p, source: "external", turn_id: null }));
    renderView(game({ values: values({ plies }) }), vi.fn(), { tab: "latency" });
    expect(screen.getByText("No agent moves to time.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Graph" }));
    expect(screen.getByRole("button", { name: "White's winning chances by ply" })).toBeVisible();
  });

  it("exports the position and the game from the Export tab", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const openUrl = vi.fn();
    renderView(game(), vi.fn(), { tab: "export", openUrl });
    const fen = screen.getByRole("textbox", { name: "FEN" }) as HTMLInputElement;
    expect(fen.value).toBe(FENS[7]);
    fireEvent.focus(fen);
    expect(fen.selectionEnd).toBe(fen.value.length);
    const pgn = screen.getByRole("textbox", { name: "PGN" }) as HTMLTextAreaElement;
    expect(pgn.value).toContain('[Site "LangSmith"]');
    fireEvent.focus(pgn);
    expect(pgn.selectionEnd).toBe(pgn.value.length);
    await userEvent.click(screen.getByRole("button", { name: "Copy FEN" }));
    expect(writeText).toHaveBeenLastCalledWith(FENS[7]);
    await userEvent.click(screen.getByRole("button", { name: "Copy PGN" }));
    expect(writeText).toHaveBeenLastCalledWith(pgn.value);
    expect(await screen.findByLabelText("export")).toHaveTextContent("Copied the PGN.");
    await userEvent.click(screen.getByRole("button", { name: /Analyze on Lichess/ }));
    expect(openUrl).toHaveBeenCalledWith(expect.stringContaining("lichess.org"), { newTab: true });
  });

  it("opens the Export tab when the browser refuses a copy", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: () => Promise.reject(new Error("denied")) },
      configurable: true,
    });
    renderView();
    await openMenu("Board menu");
    await userEvent.click(screen.getByRole("menuitem", { name: "Copy PGN" }));
    expect(await screen.findByLabelText("export")).toHaveTextContent(
      "The browser didn't allow copying. Select the PGN in the Export tab.",
    );
    expect(screen.getByRole("tab", { name: "Export" })).toHaveAttribute("aria-selected", "true");
  });
});

describe("an ungraded game", () => {
  it("keeps the board, moves, who played it and Export, and shows no engine output", async () => {
    renderView(game({ grading: UNGRADED }));
    expect(current()).toBe("Qxf7#");
    expect(screen.getByLabelText("who played it")).toBeInTheDocument();
    expect(screen.queryByLabelText("engine")).toBeNull();
    expect(screen.queryByLabelText("engine lines")).toBeNull();
    expect(screen.queryByLabelText("summary")).toBeNull();
    expect(screen.queryByLabelText("mistake note")).toBeNull();
    expect(document.querySelector("[data-eval]")).toBeNull();
    expect(screen.getByText("Not graded.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Export" }));
    expect(screen.getByRole("textbox", { name: "FEN" })).toHaveValue(FENS[7]);
  });
});

describe("layout", () => {
  it("keeps the tools beside the board to what fits, and puts who played it and the summary under them", () => {
    renderView();
    const tools = within(screen.getByLabelText("tools"));
    expect(tools.getByLabelText("move list")).toBeInTheDocument();
    expect(tools.queryByLabelText("who played it")).toBeNull();
    const under = within(document.querySelector<HTMLElement>("[data-slot=under-table]")!);
    expect(under.getByLabelText("who played it")).toBeInTheDocument();
    expect(under.getByLabelText("summary")).toBeInTheDocument();
  });
});

describe("back to live", () => {
  it("shows only while the game is still being played", () => {
    const { unmount } = renderView();
    key("ArrowLeft");
    expect(screen.queryByRole("button", { name: "Back to live" })).toBeNull();
    unmount();
    renderView(game({ values: values({ outcome: null }) }));
    key("ArrowLeft");
    fireEvent.click(screen.getByRole("button", { name: "Back to live" }));
    expect(current()).toBe("Qxf7#");
  });
});
