import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import App from "./App";
import { describeError, statusLine } from "./format";
import { saveSettings } from "./settings";
import { fake, resetFake } from "./test/fakeStream";
import { DEFAULT_CONTEXT, type PlyView } from "./types";

vi.mock("react-chessboard", () => ({
  Chessboard: ({
    options,
  }: {
    options: {
      onPieceDrop: (a: {
        piece: { pieceType: string };
        sourceSquare: string;
        targetSquare: string;
      }) => boolean;
    };
  }) => (
    <button
      type="button"
      data-testid="board"
      onClick={() =>
        options.onPieceDrop({ piece: { pieceType: "wP" }, sourceSquare: "e2", targetSquare: "e4" })
      }
    >
      board
    </button>
  ),
}));
vi.mock("@langchain/react", async () => (await import("./test/fakeStream")).useStreamMock());

const base = { status: "playing" as const, result: null, history: [], humanSide: "white" as const };

const ply: PlyView = {
  ply: 2,
  side: "black",
  san: "e5",
  uci: "e7e5",
  source: "jev",
  model: "jev-latest",
  latency_ms: 100,
};

beforeEach(() => resetFake());

describe("statusLine", () => {
  it("covers every game state", () => {
    expect(statusLine({ ...base, status: "checkmate", result: "1-0" })).toBe("Checkmate. 1-0");
    expect(statusLine({ ...base, status: "stalemate" })).toBe("Stalemate. Draw.");
    expect(statusLine({ ...base, status: "draw" })).toBe("Draw.");
    expect(statusLine({ ...base, status: "max_plies" })).toMatch(/Move limit/);
    expect(statusLine(base)).toBe("Your move.");
    expect(statusLine({ ...base, humanSide: "black" })).toMatch(/Press Start/);
    expect(statusLine({ ...base, history: ["e4"] })).toBe("Opponent to move.");
    expect(statusLine({ ...base, history: ["e4", "e5"] })).toBe("Your move.");
    expect(statusLine({ ...base, history: ["e4"], humanSide: "black" })).toBe("Your move.");
  });

  it("describes errors", () => {
    expect(describeError(undefined)).toBeNull();
    expect(describeError(new Error("boom"))).toBe("boom");
    expect(describeError("plain")).toBe("plain");
    expect(describeError({ detail: "x" })).toBe('{"detail":"x"}');
  });
});

describe("App", () => {
  it("shows the banner without a key and opens settings from it", () => {
    render(<App />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("LangSmith API key"), { target: { value: "lsv2_k" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(window.localStorage.getItem("jev-chess:settings")).toContain("lsv2_k");
  });

  it("hides the banner when a key is stored and shows game state", () => {
    saveSettings({ apiKey: "k", context: DEFAULT_CONTEXT });
    resetFake({
      fen: "FEN",
      history: ["e4", "e5"],
      plies: [{ ...ply, ply: 1, side: "white", san: "e4", uci: "e2e4", source: "human" }, ply],
      player: "jev",
      error: "e2e5 is not a legal move here.",
    });
    render(<App />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Jev played")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("not a legal move");
    expect(screen.getAllByText("jev").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("offers Start when the human is black and shows thinking while loading", async () => {
    saveSettings({ apiKey: "k", context: { ...DEFAULT_CONTEXT, human_side: "black" } });
    render(<App />);
    const start = screen.getByRole("button", { name: "Start" });
    await act(async () => {
      fireEvent.click(start);
    });
    expect(fake.submit).toHaveBeenCalledWith({}, expect.anything());
    resetFake({ human_side: "black" });
    fake.isLoading = true;
    render(<App />);
    expect(screen.getByText(/is thinking/)).toBeInTheDocument();
  });

  it("submits a dropped move through the game hook", async () => {
    saveSettings({ apiKey: "k", context: DEFAULT_CONTEXT });
    render(<App />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("board"));
    });
    expect(fake.submit).toHaveBeenCalledWith({ move: "e2e4" }, expect.anything());
  });

  it("offers a retry when the opponent failed to move", async () => {
    saveSettings({ apiKey: "k", context: DEFAULT_CONTEXT });
    resetFake({
      fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
      history: ["e4"],
      plies: [{ ...ply, ply: 1, side: "white", san: "e4", uci: "e2e4", source: "human" }],
      error: "llm failed to move: 400",
    });
    render(<App />);
    expect(screen.getByRole("status")).toHaveTextContent("failed to move");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry opponent move" }));
    });
    expect(fake.submit).toHaveBeenCalledWith({}, expect.anything());
  });

  it("shows stream errors and the thread id", () => {
    saveSettings({ apiKey: "k", context: DEFAULT_CONTEXT });
    fake.error = new Error("401 unauthorized");
    window.history.replaceState(null, "", "?thread=t-42");
    render(<App />);
    expect(screen.getByRole("status")).toHaveTextContent("401 unauthorized");
    expect(screen.getByText("t-42")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "New game" }));
    expect(screen.queryByText("t-42")).not.toBeInTheDocument();
    window.history.replaceState(null, "", "/");
  });
});
