import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { act, fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import App from "./App";
import { saveSettings, saveSide } from "./settings";
import { fake, optionsLog, resetFake } from "./test/fakeStream";
import { AFTER_E4, E4_E5, ply, turn } from "./test/fixtures";
import { renderWithProviders as render } from "./test/renderApp";
import { DEFAULT_CONTEXT, START_FEN, type ChessContext } from "./types";

interface BoardOptions {
  position: string;
  boardOrientation: string;
  allowDragging: boolean;
  onPieceDrop: (a: {
    piece: { pieceType: string };
    sourceSquare: string;
    targetSquare: string;
  }) => boolean;
}

vi.mock("react-chessboard", () => ({
  Chessboard: ({ options }: { options: BoardOptions }) => (
    <div
      data-testid="board"
      data-position={options.position}
      data-orientation={options.boardOrientation}
      data-draggable={String(options.allowDragging)}
    >
      {[
        ["e2", "e4"],
        ["e7", "e5"],
      ].map(([from, to]) => (
        <button
          key={from}
          type="button"
          onClick={() =>
            options.onPieceDrop({
              piece: { pieceType: "wP" },
              sourceSquare: from,
              targetSquare: to,
            })
          }
        >
          drop {from}
          {to}
        </button>
      ))}
    </div>
  ),
}));
vi.mock("@langchain/react", async () => (await import("./test/fakeStream")).useStreamMock());
vi.mock("@langchain/macaw-components/Select", async () =>
  (await import("./test/macawShims")).selectShim(),
);
vi.mock("@langchain/macaw-components/Slider", async () =>
  (await import("./test/macawShims")).sliderShim(),
);

const board = () => screen.getByTestId("board");
const button = (name: string) => screen.getByRole("button", { name });
const withKey = (context: ChessContext = DEFAULT_CONTEXT) => saveSettings({ apiKey: "k", context });

async function click(name: string) {
  await act(async () => {
    fireEvent.click(button(name));
  });
}

beforeEach(() => {
  resetFake();
  window.history.replaceState(null, "", "/");
});

describe("App", () => {
  it("shows the banner without a key and opens settings from it", () => {
    render(<App />);
    expect(screen.getByText("LangChain Chess")).toBeInTheDocument();
    expect(screen.getByText("No LangSmith API key")).toBeInTheDocument();
    fireEvent.click(button("Open settings"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("LangSmith API Key"), { target: { value: "lsv2_k" } });
    fireEvent.click(button("Save"));
    expect(screen.queryByText("No LangSmith API key")).not.toBeInTheDocument();
    expect(window.localStorage.getItem("langchain-chess:settings")).toContain("lsv2_k");
  });

  it("migrates old settings on load and never sends obsolete knobs", async () => {
    window.localStorage.setItem(
      "jev-chess:settings",
      JSON.stringify({ apiKey: "k", context: { policy: "random", human_side: "black", k: 4 } }),
    );
    render(<App />);
    expect(board()).toHaveAttribute("data-orientation", "white");
    await click("drop e2e4");
    const [, options] = fake.submit.mock.calls[0];
    expect(options.config.configurable).toEqual({ ...DEFAULT_CONTEXT, k: 4 });
  });

  it("renders the record: board, move list, last reply, and the opponent", () => {
    withKey();
    resetFake(E4_E5);
    render(<App />);
    expect(screen.queryByText("No LangSmith API key")).not.toBeInTheDocument();
    expect(board()).toHaveAttribute(
      "data-position",
      "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
    );
    expect(screen.getByText("System 1 played")).toBeInTheDocument();
    expect(screen.getByLabelText("move list")).toHaveTextContent("1.e4e5");
    expect(screen.getByText("Hybrid: semif-qwen3.5-4b + claude-opus-5")).toBeInTheDocument();
    expect(screen.getByText("Your move.")).toBeInTheDocument();
    fireEvent.click(button("Settings"));
    fireEvent.click(button("Cancel"));
  });

  it("names single-policy opponents", () => {
    withKey({ ...DEFAULT_CONTEXT, policy: "llm" });
    render(<App />);
    expect(screen.getByText("LLM only: claude-opus-5")).toBeInTheDocument();
    withKey({ ...DEFAULT_CONTEXT, policy: "systemone" });
    render(<App />);
    expect(screen.getByText("System 1 only: semif-qwen3.5-4b")).toBeInTheDocument();
  });

  it("submits a dropped move as a human message with the settings context", async () => {
    const context = { ...DEFAULT_CONTEXT, threshold: 0.4, policy: "llm" as const };
    withKey(context);
    render(<App />);
    expect(board()).toHaveAttribute("data-draggable", "true");
    await click("drop e2e4");
    expect(fake.submit).toHaveBeenCalledWith(
      { messages: [{ type: "human", id: expect.any(String), content: "e2e4" }] },
      { config: { configurable: context }, multitaskStrategy: "reject" },
    );
    await click("drop e2e4");
    const ids = fake.submit.mock.calls.map(([input]) => input.messages[0].id);
    expect(ids[1]).toBe(ids[0]);
  });

  it("shows the optimistic move until the run settles", async () => {
    withKey();
    let finish: () => void = () => {};
    fake.submit = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    render(<App />);
    await click("drop e2e4");
    expect(board()).toHaveAttribute("data-position", AFTER_E4);
    expect(board()).toHaveAttribute("data-draggable", "false");
    expect(screen.queryByRole("button", { name: "Start" })).not.toBeInTheDocument();
    await act(async () => finish());
    expect(board()).not.toHaveAttribute("data-position", AFTER_E4);
  });

  it("plays Black: Start sends `go`, then the human answers the opponent's first move", async () => {
    withKey();
    render(<App />);
    await act(async () => {
      fireEvent.click(screen.getByText("Black"));
    });
    expect(board()).toHaveAttribute("data-orientation", "black");
    expect(board()).toHaveAttribute("data-draggable", "false");
    expect(screen.getByText(/Press Start/)).toBeInTheDocument();
    await click("Start");
    expect(fake.submit).toHaveBeenLastCalledWith(
      { messages: [{ type: "human", id: expect.any(String), content: "go" }] },
      expect.objectContaining({ multitaskStrategy: "reject" }),
    );

    fake.values = {
      moves: ["e2e4"],
      plies: [ply({ source: "llm", turn_id: "turn-1", model: "anthropic:claude-opus-5" })],
      turns: [turn({ ply: 0, opened_message_id: "go-1" })],
    };
    fireEvent.click(button("Settings"));
    fireEvent.click(button("Cancel"));
    expect(screen.getByText("Your move.")).toBeInTheDocument();
    expect(board()).toHaveAttribute("data-draggable", "true");
    await click("drop e7e5");
    expect(fake.submit).toHaveBeenLastCalledWith(
      { messages: [{ type: "human", id: expect.any(String), content: "e7e5" }] },
      expect.anything(),
    );
  });

  it("offers Retry, not Start, when the first turn as Black failed", async () => {
    withKey();
    window.history.replaceState(null, "", "?thread=t-b");
    saveSide("t-b", "black");
    resetFake({ moves: [], plies: [], turns: [turn({ status: "pending", ply: null })] });
    fake.error = new Error("provider 529");
    render(<App />);
    expect(screen.queryByRole("button", { name: "Start" })).not.toBeInTheDocument();
    expect(screen.getByText("Opponent to move.")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("provider 529");
    await click("Retry");
    expect(fake.submit).toHaveBeenCalledWith(
      {},
      { config: { configurable: DEFAULT_CONTEXT }, multitaskStrategy: "reject" },
    );
  });

  it("offers Retry mid-game and locks the board while the turn is pending", () => {
    withKey();
    resetFake({
      moves: ["e2e4"],
      plies: [ply()],
      turns: [turn({ status: "pending", ply: null })],
    });
    render(<App />);
    expect(button("Retry")).toBeInTheDocument();
    expect(board()).toHaveAttribute("data-draggable", "false");
    fake.isLoading = true;
    render(<App />);
    expect(screen.getAllByRole("button", { name: "Retry" })).toHaveLength(1);
  });

  it("asks the opponent to move when it is its turn with nothing pending", async () => {
    withKey();
    resetFake({ moves: ["e2e4"], plies: [ply()], turns: [] });
    render(<App />);
    await click("Ask opponent to move");
    expect(fake.submit.mock.lastCall?.[0].messages[0].content).toBe("go");
  });

  it("restores the side for a thread on reload", () => {
    withKey();
    saveSide("abc", "black");
    window.history.replaceState(null, "", "?thread=abc");
    render(<App />);
    expect(board()).toHaveAttribute("data-orientation", "black");
    expect(screen.getByText("abc")).toBeInTheDocument();
    expect(optionsLog.at(-1)).toMatchObject({ threadId: "abc" });
  });

  it("streams the live analysis while the opponent thinks", () => {
    withKey();
    resetFake({ moves: ["e2e4"], plies: [ply()], turns: [turn({ status: "pending" })] }, [
      new HumanMessage({ id: "msg-1", content: "e2e4" }),
      new AIMessage({ id: "a1", content: [{ type: "text", text: "**e5** mirrors the centre." }] }),
    ]);
    fake.isLoading = true;
    render(<App />);
    expect(screen.getByText("Opponent is thinking")).toBeInTheDocument();
    expect(screen.getByLabelText("live analysis")).toHaveTextContent("e5 mirrors the centre.");
    expect(board()).toHaveAttribute("data-draggable", "false");
  });

  it("shows the outcome and locks the board", () => {
    withKey();
    resetFake({
      ...E4_E5,
      outcome: { kind: "resignation", winner: "white", reason: "illegal_moves" },
    });
    render(<App />);
    expect(screen.getByText("Black resigns after repeated illegal moves. 1-0")).toBeInTheDocument();
    expect(board()).toHaveAttribute("data-draggable", "false");
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("shows the rejection reason as a dismissible notice that re-arms on the next command", async () => {
    withKey();
    resetFake({ error: "`e2e5` is neither `go` nor a legal move" });
    render(<App />);
    expect(screen.getByText(/neither `go` nor a legal move/)).toBeInTheDocument();
    fireEvent.click(button("Close"));
    expect(screen.queryByText(/neither `go` nor a legal move/)).not.toBeInTheDocument();
    await click("drop e2e4");
    expect(screen.getByText(/neither `go` nor a legal move/)).toBeInTheDocument();
  });

  it("starts a new game from the colour tabs and the New game button", async () => {
    withKey();
    window.history.replaceState(null, "", "?thread=t-old");
    render(<App />);
    expect(screen.getByText("t-old")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByText("Black"));
    });
    expect(window.location.search).toBe("");
    expect(button("Start")).toBeInTheDocument();
    fireEvent.click(button("New game"));
    expect(board()).toHaveAttribute("data-orientation", "black");
  });

  it("ignores late events from the previous game after switching", async () => {
    withKey();
    window.history.replaceState(null, "", "?thread=t-old");
    fake.threads["t-old"] = { values: {} };
    let finish: () => void = () => {};
    fake.submit = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    render(<App />);
    await click("drop e2e4");
    fake.threads["t-old"] = {
      values: { moves: ["e2e4"], plies: [ply()], turns: [turn({ status: "pending" })] },
      isLoading: true,
      messages: [
        new HumanMessage({ id: "msg-1", content: "e2e4" }),
        new AIMessage({ id: "a1", content: "old thinking" }),
      ],
    };
    fireEvent.click(button("Settings"));
    fireEvent.click(button("Cancel"));
    expect(screen.getByText("Opponent is thinking")).toBeInTheDocument();
    const old = optionsLog.at(-1) as { onThreadId: (id: string) => void };

    await act(async () => {
      fireEvent.click(screen.getByText("Black"));
    });
    fake.threads["t-old"] = {
      values: { ...E4_E5, outcome: { kind: "checkmate", winner: "white" } },
      isLoading: false,
    };
    await act(async () => {
      old.onThreadId("t-old-2");
      finish();
    });
    fireEvent.click(button("Settings"));
    fireEvent.click(button("Cancel"));

    expect(window.location.search).toBe("");
    expect(window.localStorage.getItem("langchain-chess:side:t-old-2")).toBeNull();
    expect(board()).toHaveAttribute("data-position", START_FEN);
    expect(board()).toHaveAttribute("data-orientation", "black");
    expect(screen.queryByText("Opponent is thinking")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("live analysis")).not.toBeInTheDocument();
    expect(screen.queryByText(/Checkmate/)).not.toBeInTheDocument();
    expect(screen.getByText("No moves yet.")).toBeInTheDocument();
    expect(button("Start")).toBeInTheDocument();
  });
});
