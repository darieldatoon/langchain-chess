import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import App from "../src/App";
import { checkApiKey, type KeyCheck } from "../src/auth";
import { fetchModelFacts } from "../src/modelFacts";
import { DEFAULT_SETUP } from "../src/setup";
import {
  APP_KEY,
  DISPLAY_KEY,
  loadDisplayPrefs,
  loadSetup,
  saveDisplayPrefs,
  saveAppSettings,
  savePlyView,
  saveSetup,
  VIEW_KEY,
} from "../src/storage";
import { fake, lastOptions, optionsLog, resetFake } from "./support/fakeStream";
import { AFTER_E4, E4_E5, ply, turn } from "@langchain-chess/chess-ui/testing";
import { WEB_TRACE } from "../src/useGame";
import { openMenu } from "./support/menus";
import userEvent from "@testing-library/user-event";
import { renderWithProviders as render } from "./support/renderApp";
import {
  DEFAULT_CONTEXT,
  START_FEN,
  type ChessContext,
  type ChessValues,
} from "@langchain-chess/chess-ui";

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
  defaultPieces: new Proxy({}, { get: () => () => null }),
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
const keyCheck = vi.hoisted(() => ({ result: { kind: "ok" } as KeyCheck }));
vi.mock("../src/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/auth")>()),
  checkApiKey: vi.fn(() => Promise.resolve(keyCheck.result)),
}));
const downloads = vi.hoisted(() => [] as [string, unknown][]);
vi.mock("../src/files", () => ({
  downloadJson: (name: string, value: unknown) => downloads.push([name, value]),
  downloadText: (name: string, text: string) => downloads.push([name, text]),
}));
vi.mock("../src/modelFacts", () => ({
  fetchModelFacts: vi.fn(() =>
    Promise.resolve({ kind: "known", maxInputTokens: 968000, takesEffort: true }),
  ),
}));
vi.mock("@langchain/react", async () => (await import("./support/fakeStream")).useStreamMock());
vi.mock("@langchain/macaw-components/Select", async () =>
  (await import("./support/macawShims")).selectShim(),
);
vi.mock("@langchain/macaw-components/Slider", async () =>
  (await import("./support/macawShims")).sliderShim(),
);

const LLM_HIGH: ChessContext = {
  ...DEFAULT_CONTEXT,
  policy: "llm",
  model: "langsmith:openai/gpt-6-luna",
  reasoning_effort: "high",
};

const board = () => screen.getByTestId("board");
const strip = (side: "white" | "black") => screen.getByLabelText(`${side} player`);
const button = (name: string) => screen.getByRole("button", { name });
const dialog = () => screen.queryByRole("dialog");
const change = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const submitted = () => fake.submit.mock.calls.map(([input]) => input.messages?.[0]?.content);
const lastConfigurable = () => fake.submit.mock.lastCall?.[1].config.configurable;

async function click(name: string) {
  await act(async () => {
    fireEvent.click(button(name));
  });
}

/** Opens a game from its link, its thread holding `values` and the `setup` it recorded. */
function onThread(threadId: string, values: ChessValues = {}, setup = DEFAULT_CONTEXT) {
  fake.threads[threadId] = { values: { ...values, setup } };
  window.history.replaceState(null, "", `?thread=${threadId}`);
}

/** Opens a game from its link whose thread predates `setup`. */
function onOldThread(threadId: string, values: ChessValues) {
  fake.threads[threadId] = { values };
  window.history.replaceState(null, "", `?thread=${threadId}`);
}

/** The opponent opened 1. e4; the human, Black, is to move. */
const E4_AS_BLACK: ChessValues = {
  moves: ["e2e4"],
  plies: [ply({ source: "llm", turn_id: "turn-1" })],
  turns: [turn({ ply: 0 })],
};
/** The human, White, played 1. e4 and nothing is pending. */
const E4_AS_WHITE: ChessValues = { moves: ["e2e4"], plies: [ply()], turns: [] };

/** Opens the app with no game and plays whatever the modal holds. */
async function playFromModal(random?: () => number) {
  const view = render(<App random={random} />);
  await click("Play");
  return view;
}

function reportThread(threadId: string) {
  const options = lastOptions.current as { onThreadId: (id: string) => void };
  act(() => options.onThreadId(threadId));
}

beforeEach(() => {
  keyCheck.result = { kind: "ok" };
  vi.mocked(checkApiKey).mockClear();
  resetFake();
  window.history.replaceState(null, "", "/");
});

describe("new game", () => {
  it("opens the modal when there is no game in the URL and plays the defaults as White", async () => {
    render(<App />);
    expect(screen.getByRole("dialog", { name: "New game" })).toBeInTheDocument();
    await click("Play");
    expect(dialog()).not.toBeInTheDocument();
    expect(board()).toHaveAttribute("data-orientation", "white");
    expect(strip("black")).toHaveTextContent("SemIf + GLM-5.3 Flash");
    expect(strip("white")).toHaveTextContent("You");
    expect(strip("white")).toHaveTextContent("Your turn");
    expect(fake.submit).not.toHaveBeenCalled();
    expect(loadSetup()).toEqual(DEFAULT_SETUP);
    await click("drop e2e4");
    expect(fake.submit).toHaveBeenCalledWith(
      { messages: [{ type: "human", id: expect.any(String), content: "e2e4" }] },
      {
        config: { configurable: DEFAULT_CONTEXT, ...WEB_TRACE },
        metadata: { surface: "web" },
        multitaskStrategy: "reject",
      },
    );
  });

  it("asks the server about the model with the saved key", async () => {
    saveAppSettings({ apiKey: "lsv2_k" });
    render(<App />);
    await waitFor(() =>
      expect(fetchModelFacts).toHaveBeenCalledWith(
        expect.any(String),
        "lsv2_k",
        DEFAULT_CONTEXT.model,
      ),
    );
  });

  it("does not open the modal for a game in the URL", () => {
    onThread("abc");
    render(<App />);
    expect(dialog()).not.toBeInTheDocument();
  });

  it("stays open over a locked board until a game starts, with a way to settings", async () => {
    render(<App />);
    expect(board()).toHaveAttribute("data-position", START_FEN);
    expect(board()).toHaveAttribute("data-draggable", "false");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "New game" })).toBeInTheDocument();
    fireEvent.keyDown(button("More"), { key: "Enter" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Settings" }));
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();
    await click("Cancel");
    expect(screen.getByRole("dialog", { name: "New game" })).toBeInTheDocument();
  });

  it("remembers the last setup and pre-fills the modal with it", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("radio", { name: "Black" }));
    change("LLM", "custom");
    change("Model Spec", "openai:gpt-5.6-sol");
    await click("Play");
    expect(loadSetup()).toMatchObject({
      side: "black",
      llm: "custom",
      customModel: "openai:gpt-5.6-sol",
    });
    await click("New game");
    expect(screen.getByRole("radio", { name: "Black" })).toBeChecked();
    expect(screen.getByLabelText("LLM")).toHaveValue("custom");
    expect(screen.getByLabelText("Model Spec")).toHaveValue("openai:gpt-5.6-sol");
    await click("Cancel");
    expect(dialog()).not.toBeInTheDocument();
  });

  it("resolves Random through the injected source", async () => {
    saveSetup({ ...DEFAULT_SETUP, side: "random" });
    await playFromModal(() => 0.9);
    expect(board()).toHaveAttribute("data-orientation", "black");
    expect(submitted()).toEqual(["go"]);
    await click("New game");
    expect(screen.getByRole("radio", { name: "Random" })).toBeChecked();
  });

  it("resolves Random to White for a low draw", async () => {
    saveSetup({ ...DEFAULT_SETUP, side: "random" });
    await playFromModal(() => 0.1);
    expect(board()).toHaveAttribute("data-orientation", "white");
    expect(fake.submit).not.toHaveBeenCalled();
  });
});

describe("a game's own setup", () => {
  it("plays its picks: a later setup never reaches it, and a reload continues from its thread", async () => {
    saveSetup({ ...DEFAULT_SETUP, systemOneOff: true, llm: "langsmith:openai/gpt-6-luna" });
    const view = await playFromModal();
    reportThread("t-1");
    const luna: ChessContext = {
      ...DEFAULT_CONTEXT,
      policy: "llm",
      model: "langsmith:openai/gpt-6-luna",
    };

    // Changing the last setup, in the modal or in storage, leaves the game on screen alone.
    await click("New game");
    change("System 1", "typesafe/jev-latest");
    await click("Cancel");
    saveSetup({ ...DEFAULT_SETUP, llm: "none" });
    await click("drop e2e4");
    expect(lastConfigurable()).toEqual(luna);
    expect(Object.keys(window.localStorage)).toEqual(["langchain-chess:setup"]);

    // A new game takes the new setup; the old one keeps its own.
    await click("New game");
    change("System 1", "semif-qwen3.5-4b");
    change("LLM", "none");
    await click("Play");
    expect(window.location.search).toBe("");
    await click("drop e2e4");
    expect(lastConfigurable()).toMatchObject({ policy: "systemone" });

    view.unmount();
    onThread("t-1", E4_AS_WHITE, luna);
    render(<App />);
    expect(board()).toHaveAttribute("data-orientation", "white");
    await click("Ask opponent to move");
    expect(lastConfigurable()).toEqual(luna);
  });

  it("rematches or exports a recorded game's opponent mid-game", async () => {
    onThread("abc", E4_AS_BLACK, LLM_HIGH);
    render(<App />);
    await click("Export");
    expect(downloads.at(-1)).toEqual(["opponent.json", LLM_HIGH]);
    await click("Rematch");
    expect(board()).toHaveAttribute("data-orientation", "white");
    await click("drop e2e4");
    expect(lastConfigurable()).toEqual(LLM_HIGH);
  });

  it("continues a Black game from its thread in a browser that has never seen it", async () => {
    onThread("abc", E4_AS_BLACK, LLM_HIGH);
    render(<App />);
    expect(window.localStorage.length).toBe(0);
    expect(board()).toHaveAttribute("data-orientation", "black");
    expect(board()).toHaveAttribute("data-draggable", "true");
    expect(screen.getByText("abc")).toBeInTheDocument();
    expect(strip("white")).toHaveTextContent("GPT-6 Luna · high");
    expect(strip("black")).toHaveTextContent("Your turn");
    expect(optionsLog.at(-1)).toMatchObject({ threadId: "abc" });
    await click("drop e7e5");
    expect(submitted()).toEqual(["e7e5"]);
    expect(lastConfigurable()).toEqual(LLM_HIGH);
  });

  it("continues a White game from its thread", () => {
    onThread("abc", E4_E5);
    render(<App />);
    expect(board()).toHaveAttribute("data-orientation", "white");
    expect(board()).toHaveAttribute("data-draggable", "true");
    expect(strip("white")).toHaveTextContent("Your turn");
  });

  it("notes advanced knobs that differ from the defaults", () => {
    onThread("abc", E4_E5, { ...DEFAULT_CONTEXT, threshold: 0.5, k: 3 });
    render(<App />);
    expect(
      within(screen.getByLabelText("opponent")).getByText("threshold 0.5 · k 3"),
    ).toBeVisible();
  });

  it("shows a thread without a setup read-only, rather than play it with defaults", () => {
    onOldThread("old", { moves: ["e2e4"], plies: [ply()], turns: [] });
    fake.isThreadLoading = true;
    const view = render(<App />);
    expect(screen.queryByText("View only")).not.toBeInTheDocument();
    view.unmount();

    fake.isThreadLoading = false;
    // This browser's pin from before games recorded their setup is not read.
    window.localStorage.setItem(
      "langchain-chess:game:old",
      JSON.stringify({ side: "white", context: DEFAULT_CONTEXT }),
    );
    render(<App />);
    expect(screen.getByText("View only")).toBeInTheDocument();
    expect(screen.getByText(/can't read this game's settings/)).toBeInTheDocument();
    expect(board()).toHaveAttribute("data-draggable", "false");
    // No side is claimed: the strips are named by colour, with no status.
    expect(strip("white")).toHaveTextContent(/^White$/);
    expect(strip("black")).toHaveTextContent(/^Black$/);
    expect(screen.queryByRole("button", { name: "Ask opponent to move" })).not.toBeInTheDocument();
    expect(within(screen.getByLabelText("opponent")).getByText("Unknown")).toBeVisible();
    expect(fake.submit).not.toHaveBeenCalled();
  });

  it("shows a thread whose setup this app can't read read-only", () => {
    onThread("odd", E4_E5, { ...DEFAULT_CONTEXT, k: 0 });
    render(<App />);
    expect(screen.getByText("View only")).toBeInTheDocument();
    expect(board()).toHaveAttribute("data-draggable", "false");
  });

  it("shows the result of an unrecorded game without claiming a side or offering a rematch", () => {
    onOldThread("old", { ...E4_E5, outcome: { kind: "checkmate", winner: "white" } });
    render(<App />);
    expect(screen.getByLabelText("result")).toHaveTextContent("1-0Checkmate · White wins");
    expect(strip("white")).toHaveTextContent("Won");
    // A new game, but no rematch: this browser can't say which side was whose.
    const over = screen.getByLabelText("game over");
    expect(within(over).queryByRole("button", { name: "Rematch" })).not.toBeInTheDocument();
    expect(within(over).getByRole("button", { name: "New game" })).toBeInTheDocument();
    expect(screen.queryByLabelText("headline")).not.toBeInTheDocument();
  });

  it("locks a game whose thread failed to load, and reloads it", async () => {
    onThread("abc", E4_E5);
    const failure = new Error("Thread state request failed: 503 Service Unavailable");
    fake.hydrationPromise = Promise.reject(failure);
    fake.error = failure;
    render(<App />);
    await act(async () => {});
    expect(screen.getByText("Couldn't load this game")).toBeInTheDocument();
    expect(board()).toHaveAttribute("data-draggable", "false");
    expect(screen.getByRole("status")).toHaveTextContent("503");

    fake.hydrationPromise = Promise.resolve();
    fake.error = undefined;
    await click("Reload");
    expect(screen.queryByText("Couldn't load this game")).not.toBeInTheDocument();
    expect(optionsLog.at(-1)).toMatchObject({ threadId: "abc" });
    expect(board()).toHaveAttribute("data-draggable", "true");
  });

  it("locks a game the server doesn't have, rather than start it over empty", async () => {
    onOldThread("gone", {});
    fake.getThread = () => undefined;
    render(<App />);
    await act(async () => {});
    expect(screen.getByText("This game isn't on the server")).toBeInTheDocument();
    expect(screen.queryByText("View only")).not.toBeInTheDocument();
    expect(board()).toHaveAttribute("data-draggable", "false");
    expect(screen.queryByRole("button", { name: "Start" })).not.toBeInTheDocument();
    expect(fake.submit).not.toHaveBeenCalled();
  });
});

describe("browser storage", () => {
  it("warns when storage refuses a write, and still plays", async () => {
    const full = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });
    try {
      render(<App />);
      expect(screen.queryByText("This browser isn't saving")).not.toBeInTheDocument();
      await click("Play");
      expect(screen.getByText("This browser isn't saving")).toBeInTheDocument();
      reportThread("t-1");
      expect(window.location.search).toBe("?thread=t-1");
      await click("drop e2e4");
      expect(submitted()).toEqual(["e2e4"]);
    } finally {
      full.mockRestore();
    }
  });

  it("warns where the browser hands over storage that refuses every read", () => {
    const read = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    });
    try {
      render(<App />);
      expect(screen.getByRole("dialog", { name: "New game" })).toBeInTheDocument();
      expect(screen.getByText("This browser isn't saving")).toBeInTheDocument();
    } finally {
      read.mockRestore();
    }
  });

  it("opens with the defaults where the browser blocks storage outright", () => {
    const blocked = vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    });
    try {
      render(<App />);
      expect(screen.getByRole("dialog", { name: "New game" })).toBeInTheDocument();
      expect(screen.getByText("This browser isn't saving")).toBeInTheDocument();
    } finally {
      blocked.mockRestore();
    }
  });

  it("says nothing while storage works", () => {
    render(<App />);
    expect(screen.queryByText("This browser isn't saving")).not.toBeInTheDocument();
  });
});

describe("playing Black", () => {
  it("starts automatically with `go`, then the human answers the opponent's first move", async () => {
    saveSetup({ ...DEFAULT_SETUP, side: "black" });
    await playFromModal();
    expect(board()).toHaveAttribute("data-orientation", "black");
    expect(board()).toHaveAttribute("data-draggable", "false");
    expect(fake.submit).toHaveBeenCalledTimes(1);
    expect(fake.submit).toHaveBeenLastCalledWith(
      { messages: [{ type: "human", id: expect.any(String), content: "go" }] },
      {
        config: { configurable: DEFAULT_CONTEXT, ...WEB_TRACE },
        metadata: { surface: "web" },
        multitaskStrategy: "reject",
      },
    );

    fake.values = {
      moves: ["e2e4"],
      plies: [ply({ source: "llm", turn_id: "turn-1", model: "anthropic:claude-opus-5" })],
      turns: [turn({ ply: 0, opened_message_id: "go-1" })],
    };
    fireEvent.click(button("Settings"));
    fireEvent.click(button("Cancel"));
    expect(strip("black")).toHaveTextContent("Your turn");
    expect(board()).toHaveAttribute("data-draggable", "true");
    await click("drop e7e5");
    expect(submitted()).toEqual(["go", "e7e5"]);
  });

  it("keeps Start as a fallback when the automatic start failed", async () => {
    saveSetup({ ...DEFAULT_SETUP, side: "black" });
    fake.submit = vi.fn(() => Promise.reject(new Error("Failed to fetch")));
    await playFromModal();
    expect(screen.getByRole("status")).toHaveTextContent("Failed to fetch");
    expect(within(strip("white")).getByRole("button", { name: "Start" })).toBeInTheDocument();
    fake.submit = vi.fn(() => Promise.resolve());
    await click("Start");
    expect(submitted()).toEqual(["go"]);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("offers Retry, not Start, when the first turn as Black failed, from the thread alone", async () => {
    onThread("t-b", { moves: [], plies: [], turns: [turn({ status: "pending", ply: null })] });
    fake.error = new Error("provider 529");
    render(<App />);
    expect(board()).toHaveAttribute("data-orientation", "black");
    expect(screen.queryByRole("button", { name: "Start" })).not.toBeInTheDocument();
    expect(strip("black")).not.toHaveTextContent("Your turn");
    expect(screen.getByRole("status")).toHaveTextContent("provider 529");
    expect(screen.queryByText("LangSmith API key needed")).not.toBeInTheDocument();
    await click("Retry");
    expect(fake.submit).toHaveBeenCalledWith(
      {},
      {
        config: { configurable: DEFAULT_CONTEXT, ...WEB_TRACE },
        metadata: { surface: "web" },
        multitaskStrategy: "reject",
      },
    );
  });
});

describe("after the game", () => {
  const MATE = { ...E4_E5, outcome: { kind: "checkmate", winner: "white" } } as const;

  it("shows the result, locks the board, and rematches with colours swapped", async () => {
    onThread("t-1", MATE, LLM_HIGH);
    render(<App />);
    expect(screen.getByLabelText("headline")).toHaveTextContent("You won · Checkmate · White wins");
    expect(document.title).toBe("Game over · LangChain Chess");
    expect(screen.queryByRole("button", { name: "Resign" })).not.toBeInTheDocument();
    expect(strip("white")).toHaveTextContent("Won");
    expect(strip("black")).toHaveTextContent("Checkmated");
    expect(board()).toHaveAttribute("data-draggable", "false");
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(
        within(screen.getByLabelText("game over")).getByRole("button", { name: "Rematch" }),
      );
    });
    expect(window.location.search).toBe("");
    expect(board()).toHaveAttribute("data-orientation", "black");
    expect(board()).toHaveAttribute("data-position", START_FEN);
    expect(submitted()).toEqual(["go"]);
    expect(lastConfigurable()).toEqual(LLM_HIGH);
  });

  it("rematches as White without starting", async () => {
    onThread("t-1", {
      ...E4_AS_BLACK,
      moves: ["e2e4", "e7e5"],
      plies: [...(E4_AS_BLACK.plies ?? []), ply({ ply: 1, side: "black", uci: "e7e5", san: "e5" })],
      outcome: { kind: "checkmate", winner: "white" },
    });
    render(<App />);
    expect(screen.getByLabelText("headline")).toHaveTextContent("You lost");
    await act(async () => {
      fireEvent.click(
        within(screen.getByLabelText("game over")).getByRole("button", { name: "Rematch" }),
      );
    });
    expect(board()).toHaveAttribute("data-orientation", "white");
    expect(fake.submit).not.toHaveBeenCalled();
  });

  it("opens the modal pre-filled with the last setup from the result card", async () => {
    saveSetup({ ...DEFAULT_SETUP, llm: "langsmith:baseten/zai-org/GLM-5.3" });
    onThread("t-1", { ...E4_E5, outcome: { kind: "draw", reason: "threefold" } });
    render(<App />);
    expect(screen.getByLabelText("headline")).toHaveTextContent(
      "Draw · Draw by threefold repetition",
    );
    await act(async () => {
      fireEvent.click(
        within(screen.getByLabelText("game over")).getByRole("button", { name: "New game" }),
      );
    });
    expect(screen.getByRole("dialog", { name: "New game" })).toBeInTheDocument();
    expect(screen.getByLabelText("LLM")).toHaveValue("langsmith:baseten/zai-org/GLM-5.3");
  });
});

describe("app settings and auth", () => {
  const unauthorized = Object.assign(new Error("HTTP 401: Unauthorized"), { status: 401 });

  it("shows no API key banner without an auth failure, even with no key", () => {
    onThread("abc");
    render(<App />);
    expect(screen.queryByText("LangSmith API key needed")).not.toBeInTheDocument();
  });

  it("shows the banner when the server rejects the stream for auth, and opens settings", async () => {
    onThread("abc");
    fake.error = unauthorized;
    render(<App />);
    expect(screen.getByText("LangSmith API key needed")).toBeInTheDocument();
    await click("Open settings");
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();
    change("LangSmith API Key", "lsv2_k");
    await click("Save");
    expect(dialog()).not.toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(APP_KEY) ?? "{}")).toEqual({ apiKey: "lsv2_k" });
    expect(window.localStorage.getItem("langchain-chess:setup")).toBeNull();
    expect(lastOptions.current).toMatchObject({ apiKey: "lsv2_k" });
  });

  it("shows the banner when a submit is refused as forbidden", async () => {
    fake.submit = vi.fn(() => Promise.reject(new Error("HTTP 403: Forbidden")));
    await playFromModal();
    await click("drop e2e4");
    expect(screen.getByText("LangSmith API key needed")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("HTTP 403: Forbidden");
  });

  it("sends a stored key, and cancels settings without saving", async () => {
    saveAppSettings({ apiKey: "lsv2_saved" });
    onThread("abc");
    render(<App />);
    expect(lastOptions.current).toMatchObject({ apiKey: "lsv2_saved" });
    await click("Settings");
    change("LangSmith API Key", "other");
    await click("Cancel");
    expect(lastOptions.current).toMatchObject({ apiKey: "lsv2_saved" });
  });
});

describe("key check on Play", () => {
  it("keeps the modal up on a missing key, then plays with the key saved from settings", async () => {
    keyCheck.result = { kind: "missing" };
    render(<App />);
    fireEvent.click(screen.getByRole("radio", { name: "Black" }));
    await click("Play");
    expect(screen.getByRole("dialog", { name: "New game" })).toBeInTheDocument();
    expect(screen.getByText("LangSmith API key needed")).toBeInTheDocument();
    expect(fake.submit).not.toHaveBeenCalled();

    await click("Open settings");
    change("LangSmith API Key", "lsv2_new");
    keyCheck.result = { kind: "ok" };
    await click("Save");
    expect(screen.getByRole("dialog", { name: "New game" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Black" })).toBeChecked();
    expect(screen.queryByText("LangSmith API key needed")).not.toBeInTheDocument();

    await click("Play");
    expect(checkApiKey).toHaveBeenLastCalledWith(expect.any(String), "lsv2_new");
    expect(dialog()).not.toBeInTheDocument();
    expect(board()).toHaveAttribute("data-orientation", "black");
  });

  it("returns to the game, not the modal, from settings opened in the header", async () => {
    onThread("abc");
    render(<App />);
    await click("New game");
    fireEvent.keyDown(button("More"), { key: "Enter" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Settings" }));
    await click("Cancel");
    expect(screen.getByRole("dialog", { name: "New game" })).toBeInTheDocument();
    await click("Cancel");
    expect(dialog()).not.toBeInTheDocument();
  });
});

describe("the game screen", () => {
  it("renders the record: board, move list, last reply, and the opponent", () => {
    onThread("abc", E4_E5);
    render(<App />);
    expect(board()).toHaveAttribute(
      "data-position",
      "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
    );
    expect(screen.getByText("System 1 played")).toBeInTheDocument();
    expect(screen.getByLabelText("move list")).toHaveTextContent("1e4e5");
    expect(strip("white")).toHaveTextContent("Your turn");
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  });

  it("steps back through the game, locked, and returns to play", async () => {
    const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    const LIVE = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2";
    onThread("abc", E4_E5);
    render(<App />);
    expect(board()).toHaveAttribute("data-draggable", "true");
    expect(button("Next move")).toBeDisabled();

    await click("e4");
    expect(board()).toHaveAttribute("data-position", AFTER_E4);
    // Looking back never plays from there.
    expect(board()).toHaveAttribute("data-draggable", "false");
    await click("First move");
    expect(board()).toHaveAttribute("data-position", START);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(board()).toHaveAttribute("data-position", AFTER_E4);
    fireEvent.keyDown(window, { key: "End" });
    expect(board()).toHaveAttribute("data-position", LIVE);
    expect(board()).toHaveAttribute("data-draggable", "true");
    await click("Previous move");
    await click("Last move");
    expect(board()).toHaveAttribute("data-position", LIVE);
  });

  it("flips the board without changing sides", async () => {
    onThread("abc", E4_E5);
    render(<App />);
    await click("Flip");
    expect(board()).toHaveAttribute("data-orientation", "black");
    expect(board()).toHaveAttribute("data-draggable", "true");
    // Top is always the side shown at the top of the board.
    expect(document.querySelector("[data-slot=top-strip]")).toHaveTextContent("You");
    fireEvent.keyDown(window, { key: "f" });
    expect(board()).toHaveAttribute("data-orientation", "white");
  });

  it("reuses a command id for a resent move", async () => {
    await playFromModal();
    expect(board()).toHaveAttribute("data-draggable", "true");
    await click("drop e2e4");
    await click("drop e2e4");
    const ids = fake.submit.mock.calls.map(([input]) => input.messages[0].id);
    expect(ids[1]).toBe(ids[0]);
  });

  it("drops a submit refused as busy and shows any other submit failure", async () => {
    const busy = new Error(
      "submit() rejected: a run is already in flight and multitaskStrategy is 'reject'.",
    );
    fake.submit = vi.fn(() => Promise.reject(busy));
    await playFromModal();
    await click("drop e2e4");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    fake.submit = vi.fn(() => Promise.reject(new Error("Failed to fetch")));
    await click("drop e2e4");
    expect(screen.getByRole("status")).toHaveTextContent("Failed to fetch");
    expect(screen.queryByText("LangSmith API key needed")).not.toBeInTheDocument();
    fake.submit = vi.fn(() => Promise.resolve());
    await click("drop e2e4");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows the optimistic move until the run settles", async () => {
    let finish: () => void = () => {};
    fake.submit = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    await playFromModal();
    await click("drop e2e4");
    expect(board()).toHaveAttribute("data-position", AFTER_E4);
    expect(board()).toHaveAttribute("data-draggable", "false");
    expect(screen.queryByRole("button", { name: "Start" })).not.toBeInTheDocument();
    await act(async () => finish());
    expect(board()).not.toHaveAttribute("data-position", AFTER_E4);
  });

  it("offers Retry mid-game and locks the board while the turn is pending", () => {
    onThread("abc", {
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
    onThread("abc", E4_AS_WHITE);
    render(<App />);
    await click("Ask opponent to move");
    expect(submitted()).toEqual(["go"]);
  });

  it("streams the live analysis into the reply card while the opponent thinks", async () => {
    resetFake({}, [
      new HumanMessage({ id: "msg-1", content: "e2e4" }),
      new AIMessage({ id: "a1", content: [{ type: "text", text: "**e5** mirrors the centre." }] }),
    ]);
    onThread("abc", { moves: ["e2e4"], plies: [ply()], turns: [turn({ status: "pending" })] });
    fake.isLoading = true;
    render(<App />);
    expect(screen.getByText("Thinking…")).toBeInTheDocument();
    const card = screen.getByLabelText("last reply");
    expect(card).toHaveAttribute("aria-busy", "true");
    // Plain text until the lazy Markdown renderer has loaded.
    expect(card).toHaveTextContent("**e5** mirrors the centre.");
    expect(await screen.findByText("e5", { selector: "strong" })).toBeInTheDocument();
    expect(card).toHaveTextContent("e5 mirrors the centre.");
    expect(within(card).getByText("Latency")).toBeInTheDocument();
    expect(board()).toHaveAttribute("data-draggable", "false");
  });

  it("shows the thinking card before the first token, in place of the previous reply", () => {
    resetFake({}, [new HumanMessage({ id: "msg-3", content: "g1f3" })]);
    onThread("abc", E4_E5);
    fake.isLoading = true;
    render(<App />);
    expect(screen.getByLabelText("last reply")).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText("System 1 played")).not.toBeInTheDocument();
  });

  it("keeps the reasoning hidden while it streams when the player hid it", () => {
    savePlyView({ reasoning: false, topMoves: true });
    resetFake({}, [
      new HumanMessage({ id: "msg-1", content: "e2e4" }),
      new AIMessage({ id: "a1", content: "Weighing e5." }),
    ]);
    onThread("abc", { moves: ["e2e4"], plies: [ply()], turns: [turn({ status: "pending" })] });
    fake.isLoading = true;
    render(<App />);
    expect(screen.queryByText("Weighing e5.")).not.toBeInTheDocument();
    expect(button("Show reasoning").querySelector(".animate-spin")).not.toBeNull();
  });

  it("remembers the reply card's toggles across reloads", async () => {
    onThread("abc", E4_E5);
    const first = render(<App />);
    await click("Hide top moves");
    await click("Hide reasoning");
    expect(JSON.parse(window.localStorage.getItem(VIEW_KEY)!)).toEqual({
      reasoning: false,
      topMoves: false,
    });
    first.unmount();
    render(<App />);
    expect(button("Show top moves")).toBeInTheDocument();
    expect(button("Show reasoning")).toBeInTheDocument();
    expect(screen.queryByLabelText("system 1 moves")).not.toBeInTheDocument();
  });

  it("shows the rejection reason as a dismissible notice that re-arms on the next command", async () => {
    fake.values = { error: "`e2e5` is neither `go` nor a legal move" };
    await playFromModal();
    expect(screen.getByText(/neither `go` nor a legal move/)).toBeInTheDocument();
    fireEvent.click(button("Close"));
    expect(screen.queryByText(/neither `go` nor a legal move/)).not.toBeInTheDocument();
    await click("drop e2e4");
    expect(screen.getByText(/neither `go` nor a legal move/)).toBeInTheDocument();
  });

  it("ignores late events from the previous game after starting a new one", async () => {
    onThread("t-old", E4_AS_WHITE);
    saveSetup({ ...DEFAULT_SETUP, side: "black" });
    let finish: () => void = () => {};
    fake.submit = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    render(<App />);
    await click("Ask opponent to move");
    fake.threads["t-old"] = {
      values: {
        moves: ["e2e4"],
        plies: [ply()],
        turns: [turn({ status: "pending" })],
        setup: DEFAULT_CONTEXT,
      },
      isLoading: true,
      messages: [
        new HumanMessage({ id: "msg-1", content: "e2e4" }),
        new AIMessage({ id: "a1", content: "old thinking" }),
      ],
    };
    fireEvent.click(button("Settings"));
    fireEvent.click(button("Cancel"));
    expect(screen.getByText("Thinking…")).toBeInTheDocument();
    const old = optionsLog.at(-1) as { onThreadId: (id: string) => void };

    await click("New game");
    await click("Play");
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
    expect(board()).toHaveAttribute("data-position", START_FEN);
    expect(board()).toHaveAttribute("data-orientation", "black");
    expect(screen.queryByText("Thinking…")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("last reply")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("result")).not.toBeInTheDocument();
    expect(screen.getByText("No moves yet.")).toBeInTheDocument();
    expect(button("Start")).toBeInTheDocument();
  });
});

describe("layouts", () => {
  /** The page as this size of screen: the app measures its main region. */
  const spies: { mockRestore: () => void }[] = [];
  function sized(width: number, height: number) {
    spies.push(
      vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(width),
      vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(height),
    );
  }
  const slot = (name: string) => document.querySelector<HTMLElement>(`[data-slot=${name}]`)!;
  const E4_E5_NF3: ChessValues = {
    ...E4_E5,
    moves: [...E4_E5.moves, "g1f3"],
    plies: [...E4_E5.plies, ply({ ply: 2, uci: "g1f3", san: "Nf3" })],
  };

  afterEach(() => {
    for (const spy of spies.splice(0)) spy.mockRestore();
  });

  it("puts the cards under the board on wide screens, and the reply follows the browsed move", () => {
    sized(1024, 768);
    onThread("abc", E4_E5_NF3);
    render(<App />);
    expect(document.querySelector("[data-layout]")).toHaveAttribute("data-layout", "wide");
    expect(within(slot("under")).getByLabelText("last reply")).toBeInTheDocument();
    expect(within(slot("under")).getByLabelText("opponent")).toBeInTheDocument();
    expect(screen.getByText("Last Reply")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.getByText("Reply before move 3")).toBeInTheDocument();
    expect(screen.getByText("System 1 played")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Viewing move 2");
    fireEvent.keyDown(window, { key: "Home" });
    expect(screen.getByText("Reply before move 1")).toBeInTheDocument();
    expect(screen.getAllByText("No reply yet.").length).toBeGreaterThan(0);
    fireEvent.click(button("Back to live"));
    expect(screen.getByText("Last Reply")).toBeInTheDocument();
  });

  it("lists the keys on ?", async () => {
    onThread("abc", E4_E5);
    render(<App />);
    fireEvent.keyDown(window, { key: "?" });
    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeInTheDocument();
    fireEvent.click(button("Done"));
    expect(dialog()).not.toBeInTheDocument();
  });

  const PHONE_GAME: ChessValues = {
    ...E4_E5_NF3,
    plies: E4_E5_NF3.plies!.map((p) => (p.ply === 1 ? { ...p, analysis: "Solid." } : p)),
  };
  it("keeps first and last move in a phone's board menu, and settings in its app menu", async () => {
    sized(390, 780);
    onThread("abc", PHONE_GAME);
    render(<App />);
    await openMenu("Board menu");
    fireEvent.click(screen.getByRole("menuitem", { name: "First move" }));
    expect(screen.getByRole("status")).toHaveTextContent("Viewing move 0");
    await openMenu("Board menu");
    fireEvent.click(screen.getByRole("menuitem", { name: "Last move" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    await openMenu("App menu");
    fireEvent.click(screen.getByRole("menuitem", { name: "Settings" }));
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();
  });

  it("stacks a phone: bar, move strip, reply line and tabs", async () => {
    sized(390, 780);
    onThread("abc", PHONE_GAME);
    render(<App />);
    expect(document.querySelector("[data-layout]")).toHaveAttribute("data-layout", "phone");
    expect(screen.queryByText("LangChain Chess")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "First move" })).not.toBeInTheDocument();
    // The move strip.
    fireEvent.click(screen.getByRole("button", { name: "e4" }));
    expect(board()).toHaveAttribute("data-position", AFTER_E4);
    fireEvent.click(button("Flip board"));
    expect(board()).toHaveAttribute("data-orientation", "black");
    fireEvent.click(button("Back to live"));

    const line = screen.getByLabelText("reply line");
    expect(line).toHaveTextContent("System 1 playede5");
    fireEvent.click(screen.getByRole("tab", { name: "Opponent" }));
    expect(screen.getByRole("tab", { name: "Opponent" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(within(line).getByRole("button", { name: "Show reasoning" }));
    expect(screen.getByRole("tab", { name: "Reply" })).toHaveAttribute("aria-selected", "true");
    // Hidden reasoning is opened, not just its tab.
    fireEvent.click(button("Hide reasoning"));
    fireEvent.click(within(line).getByRole("button", { name: "Show reasoning" }));
    expect(screen.getByText("Solid.")).toBeInTheDocument();
  });

  it("gives a phone the score and how the game ended, even for a game it can only show", () => {
    sized(390, 780);
    onOldThread("old", { ...E4_E5, outcome: { kind: "draw", reason: "stalemate" } });
    render(<App />);
    expect(screen.getByLabelText("result")).toHaveTextContent("½-½Draw by stalemate");
  });

  it("says a phone's opponent is thinking, or hasn't replied, in the reply line", () => {
    sized(390, 780);
    onThread("abc", { moves: ["e2e4"], plies: [ply()], turns: [] });
    const view = render(<App />);
    expect(
      within(slot("board").parentElement!.parentElement!.parentElement!).getAllByText(
        "No reply yet.",
      ).length,
    ).toBeGreaterThan(0);
    view.unmount();
    fake.isLoading = true;
    render(<App />);
    expect(screen.getAllByText("Thinking…").length).toBeGreaterThanOrEqual(2);
  });

  it("shows the empty board behind New game on a phone and a wide screen", () => {
    sized(390, 780);
    const phone = render(<App />);
    expect(screen.getAllByText("Choose a side and an opponent to start.")).toHaveLength(1);
    phone.unmount();
    sized(1024, 768);
    render(<App />);
    expect(within(slot("under")).getByText("No reply yet.")).toBeInTheDocument();
  });
});

describe("display preferences and the tab title", () => {
  const toggle = (name: string) => fireEvent.click(screen.getByRole("menuitemcheckbox", { name }));

  it("keeps display preferences across reloads", async () => {
    onThread("abc", { ...E4_E5, moves: ["e2e4", "d7d5", "e4d5"], plies: [] });
    const view = render(<App />);
    expect(within(strip("white")).getByLabelText("material")).toHaveTextContent("+1");
    await openMenu("Board menu");
    toggle("Show material");
    expect(within(strip("white")).queryByLabelText("material")).not.toBeInTheDocument();
    view.unmount();
    render(<App />);
    expect(within(strip("white")).queryByLabelText("material")).not.toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(DISPLAY_KEY)!)).toMatchObject({
      showMaterial: false,
    });
  });

  it("steps through the moves with the wheel once it is turned on", async () => {
    onThread("abc", E4_E5);
    render(<App />);
    fireEvent.wheel(board(), { deltaY: -100 });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    await openMenu("Board menu");
    toggle("Wheel steps through moves");
    await userEvent.keyboard("{Escape}");
    fireEvent.wheel(board(), { deltaY: -100 });
    expect(screen.getByRole("status")).toHaveTextContent("Viewing move 1");
    fireEvent.wheel(board(), { deltaY: 100 });
    fireEvent.wheel(board(), { deltaY: 100 });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("says it's your turn in a hidden tab's title, until the tab is shown", () => {
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    onThread("abc", E4_AS_WHITE);
    render(<App />);
    expect(document.title).toBe("LangChain Chess");
    fake.threads.abc = { values: { ...E4_E5, setup: DEFAULT_CONTEXT } };
    // Any render picks the new values up.
    fireEvent.keyDown(window, { key: "?" });
    expect(document.title).toBe("Your turn · LangChain Chess");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(document.title).toBe("Your turn · LangChain Chess");
    hidden.mockReturnValue(false);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(document.title).toBe("LangChain Chess");
    hidden.mockRestore();
  });

  it("leaves the title alone when it's turned off, and on a game that loads as your move", () => {
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    saveDisplayPrefs({ ...loadDisplayPrefs(), tabTitle: false });
    onThread("abc", E4_AS_WHITE);
    fake.isThreadLoading = true;
    const view = render(<App />);
    view.unmount();
    fake.isThreadLoading = false;
    render(<App />);
    fake.threads.abc = { values: { ...E4_E5, setup: DEFAULT_CONTEXT } };
    fireEvent.keyDown(window, { key: "?" });
    expect(document.title).toBe("LangChain Chess");
    hidden.mockRestore();
  });
});

describe("resign and draw offers", () => {
  const resign = () => screen.getByRole("button", { name: "Resign" });
  const draw = () => screen.getByRole("button", { name: "Offer draw" });

  it("resigns once confirmed, for the human's side", async () => {
    onThread("abc", E4_E5);
    render(<App />);
    fireEvent.click(resign());
    await click("Confirm resignation");
    expect(submitted()).toEqual(["resign white"]);
  });

  it("offers a draw on the human's move, then shows the answer until the next move", async () => {
    onThread("abc", E4_E5);
    render(<App />);
    await act(async () => {
      fireEvent.click(draw());
    });
    expect(submitted()).toEqual(["draw white"]);
    fake.threads.abc = {
      values: {
        ...E4_E5,
        draw_offers: [{ ply: 2, by: "white", answer: "declined" }],
        setup: DEFAULT_CONTEXT,
      },
    };
    fireEvent.keyDown(window, { key: "f" });
    expect(screen.getByText("Draw declined.")).toBeInTheDocument();
    expect(draw()).toBeDisabled();
    expect(
      within(screen.getByLabelText("move list")).getByLabelText("draw offered"),
    ).toBeInTheDocument();
  });

  it.each(["resign", "draw"])(
    "never resends a control command: both stay off while a %s is in flight",
    async (kind) => {
      onThread("abc", E4_E5);
      let settle = () => {};
      fake.submit = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            settle = resolve;
          }),
      );
      render(<App />);
      if (kind === "resign") {
        fireEvent.click(resign());
        fireEvent.click(button("Confirm resignation"));
      } else {
        fireEvent.click(draw());
      }
      fake.isLoading = true;
      fireEvent.keyDown(window, { key: "f" });
      expect(resign()).toBeDisabled();
      expect(draw()).toBeDisabled();
      fireEvent.click(resign());
      fireEvent.click(draw());
      expect(submitted()).toEqual([`${kind} white`]);
      fake.isLoading = false;
      await act(async () => settle());
    },
  );

  it("titles a hidden tab Game over once the game ends, even after a turn alert", () => {
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    onThread("abc", E4_AS_WHITE);
    render(<App />);
    fake.threads.abc = { values: { ...E4_E5, setup: DEFAULT_CONTEXT } };
    fireEvent.keyDown(window, { key: "f" });
    expect(document.title).toBe("Your turn · LangChain Chess");
    fake.threads.abc = {
      values: { ...E4_E5, outcome: { kind: "checkmate", winner: "black" }, setup: DEFAULT_CONTEXT },
    };
    fireEvent.keyDown(window, { key: "f" });
    expect(document.title).toBe("Game over · LangChain Chess");
    hidden.mockRestore();
  });

  it("disables both while a command is in flight, and says a draw is on its way", async () => {
    onThread("abc", E4_E5);
    let settle = () => {};
    fake.submit = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          settle = resolve;
        }),
    );
    render(<App />);
    fireEvent.click(draw());
    expect(screen.getByText("Offering a draw…")).toBeInTheDocument();
    fake.isLoading = true;
    fireEvent.keyDown(window, { key: "f" });
    expect(resign()).toBeDisabled();
    fake.isLoading = false;
    await act(async () => settle());
    expect(screen.queryByText("Offering a draw…")).not.toBeInTheDocument();
  });

  it("keeps both off until the game has a move or an accepted root, and draws off the opponent's move", () => {
    onThread("abc", { moves: [], plies: [], turns: [] });
    const view = render(<App />);
    expect(resign()).toBeDisabled();
    expect(draw()).toBeDisabled();
    view.unmount();
    onThread("abc", E4_AS_WHITE);
    render(<App />);
    expect(resign()).toBeEnabled();
    expect(draw()).toBeDisabled();
  });

  it("marks an offer made before the first move", () => {
    onThread("abc", {
      moves: [],
      plies: [],
      turns: [],
      draw_offers: [{ ply: 0, by: "white", answer: "declined" }],
    });
    render(<App />);
    expect(
      within(screen.getByLabelText("move list")).getByLabelText("draw offered"),
    ).toBeInTheDocument();
  });

  it("puts resign and draw in a phone's bar", () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(390);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(780);
    onThread("abc", E4_E5);
    render(<App />);
    const bar = screen.getByLabelText("actions");
    expect(within(bar).getByRole("button", { name: "Resign" })).toBeEnabled();
    expect(within(bar).getByRole("button", { name: "Offer draw" })).toBeEnabled();
    vi.restoreAllMocks();
  });

  it("shows a phone the result and the next steps once the game is over", () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(390);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(780);
    onThread("abc", {
      ...E4_E5,
      outcome: { kind: "resignation", winner: "white", reason: "resigned" },
    });
    render(<App />);
    expect(screen.getByLabelText("headline")).toHaveTextContent("You won · Black resigned");
    expect(
      within(screen.getByLabelText("actions")).queryByRole("button", { name: "Resign" }),
    ).toBeNull();
    expect(strip("black")).toHaveTextContent("Resigned");
    vi.restoreAllMocks();
  });
});

describe("starting from a FEN", () => {
  const WHITE_TO_MOVE = "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1";
  const BLACK_TO_MOVE = "4k3/4p3/8/8/8/8/8/4K3 b - - 0 1";
  const AFTER_E4_CUSTOM = "4k3/8/8/8/4P3/8/8/4K3 b - - 0 1";
  const CONFIG = {
    config: { configurable: DEFAULT_CONTEXT, ...WEB_TRACE },
    metadata: { surface: "web" },
    multitaskStrategy: "reject",
  };
  const inputs = () => fake.submit.mock.calls.map(([input]) => input);

  async function playFrom(fen: string, side: "White" | "Black" | "Random", random?: () => number) {
    render(<App random={random} />);
    fireEvent.click(screen.getByRole("radio", { name: side }));
    change("Starting position", fen);
    await click("Play");
  }

  it.each<[string, string, "White" | "Black", boolean]>([
    ["White to move, playing White", WHITE_TO_MOVE, "White", false],
    ["White to move, playing Black", WHITE_TO_MOVE, "Black", true],
    ["Black to move, playing White", BLACK_TO_MOVE, "White", true],
    ["Black to move, playing Black", BLACK_TO_MOVE, "Black", false],
  ])("%s: the opponent opens only when it is to move", async (_, fen, side, opens) => {
    await playFrom(fen, side);
    expect(board()).toHaveAttribute("data-position", fen);
    expect(inputs()).toEqual(opens ? [{ position: { start_fen: fen } }] : []);
    if (opens) expect(fake.submit).toHaveBeenCalledWith({ position: { start_fen: fen } }, CONFIG);
  });

  it.each<["White" | "Black", boolean]>([
    ["White", true],
    ["Black", false],
  ])("reads a position typed with extra whitespace, playing %s", async (side, opens) => {
    const clean = "4k3/4p3/8/8/8/8/8/4K3 b - - 0 12";
    await playFrom(`  ${clean.replaceAll(" ", " \t ")} `, side);
    expect(board()).toHaveAttribute("data-position", clean);
    expect(inputs()).toEqual(opens ? [{ position: { start_fen: clean } }] : []);
  });

  it.each<[number, boolean]>([
    [0.3, true],
    [0.7, false],
  ])("resolves Random (%s) before deciding who opens", async (roll, opens) => {
    await playFrom(BLACK_TO_MOVE, "Random", () => roll);
    expect(inputs()).toEqual(opens ? [{ position: { start_fen: BLACK_TO_MOVE } }] : []);
  });

  it("sends the human's first move as a position, never as a message", async () => {
    await playFrom(WHITE_TO_MOVE, "White");
    await click("drop e2e4");
    expect(inputs()).toEqual([{ position: { start_fen: WHITE_TO_MOVE, moves: ["e2e4"] } }]);
  });

  it("keeps a first move whose answer was lost on the board, and Retry resends it as it was", async () => {
    fake.submit = vi.fn(() => Promise.reject(new Error("Failed to fetch")));
    await playFrom(WHITE_TO_MOVE, "White");
    await click("drop e2e4");
    expect(board()).toHaveAttribute("data-position", AFTER_E4_CUSTOM);
    expect(screen.getByRole("status")).toHaveTextContent("Failed to fetch");
    fake.submit = vi.fn(() => Promise.resolve());
    await click("Retry");
    expect(inputs()).toEqual([{ position: { start_fen: WHITE_TO_MOVE, moves: ["e2e4"] } }]);
  });

  it("goes back to chat commands once the server has taken the root", async () => {
    await playFrom(WHITE_TO_MOVE, "White");
    await click("drop e2e4");
    fake.values = {
      start_fen: WHITE_TO_MOVE,
      moves: ["e2e4", "e8d7"],
      plies: [ply(), ply({ ply: 1, side: "black", uci: "e8d7", san: "Kd7", source: "llm" })],
      turns: [turn({ ply: 1 })],
      setup: DEFAULT_CONTEXT,
    };
    fireEvent.keyDown(window, { key: "f" });
    fireEvent.keyDown(window, { key: "f" });
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    expect(board()).toHaveAttribute("data-position", "8/3k4/8/8/4P3/8/8/4K3 w - - 1 2");
  });

  it("takes a rejected root back off the board and offers another position", async () => {
    await playFrom(WHITE_TO_MOVE, "White");
    await click("drop e2e4");
    // A rejection writes the standard start: it must not replace the chosen board.
    fake.values = {
      start_fen: START_FEN,
      moves: [],
      plies: [],
      turns: [],
      error: "invalid position",
    };
    fireEvent.keyDown(window, { key: "f" });
    expect(board()).toHaveAttribute("data-position", WHITE_TO_MOVE);
    expect(screen.getByText("invalid position")).toBeInTheDocument();
    await click("Change position");
    expect(screen.getByRole("dialog", { name: "New game" })).toBeInTheDocument();
    expect(screen.getByLabelText("Starting position")).toHaveValue(WHITE_TO_MOVE);
  });

  it("ignores a resend refused because the game is already over", async () => {
    await playFrom(WHITE_TO_MOVE, "White");
    await click("drop e2e4");
    fake.values = {
      start_fen: WHITE_TO_MOVE,
      moves: ["e2e4"],
      plies: [ply()],
      turns: [turn({ status: "terminal", ply: null })],
      outcome: { kind: "resignation", winner: "white", reason: "illegal_moves" },
      error: "the game is over",
      setup: DEFAULT_CONTEXT,
    };
    fireEvent.keyDown(window, { key: "f" });
    expect(screen.queryByText("Move rejected")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("plays a thread from its recorded root, and rematches from the same one", async () => {
    onThread("custom", {
      start_fen: WHITE_TO_MOVE,
      moves: ["e2e4"],
      plies: [ply()],
      turns: [turn({ status: "terminal", ply: null })],
      outcome: { kind: "resignation", winner: "white", reason: "resigned" },
    });
    render(<App />);
    expect(board()).toHaveAttribute("data-position", AFTER_E4_CUSTOM);
    await act(async () => {
      fireEvent.click(
        within(screen.getByLabelText("game over")).getByRole("button", { name: "Rematch" }),
      );
    });
    expect(board()).toHaveAttribute("data-position", WHITE_TO_MOVE);
    // The human was White, so the rematch plays Black, and the opponent opens.
    expect(inputs()).toEqual([{ position: { start_fen: WHITE_TO_MOVE } }]);
  });
});

describe("exports and openings", () => {
  const menuItem = async (name: string) => {
    await openMenu("Board menu");
    fireEvent.click(screen.getByRole("menuitem", { name }));
  };

  it("copies the position on the board and the whole game", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    onThread("abc", E4_E5);
    render(<App />);
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    await menuItem("Copy FEN");
    expect(writeText).toHaveBeenLastCalledWith(AFTER_E4);
    expect(await screen.findByText("Copied the FEN.")).toBeInTheDocument();
    await menuItem("Copy PGN");
    const pgn = writeText.mock.lastCall![0];
    expect(pgn).toContain('[White "You"]');
    expect(pgn).toContain("1. e4 e5 {C20 King's Pawn Game} *");
    expect(pgn).toContain("Thread abc");
  });

  it("shows the text to copy by hand when the browser refuses", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: () => Promise.reject(new Error("denied")) },
      configurable: true,
    });
    onThread("abc", E4_E5);
    render(<App />);
    await menuItem("Copy FEN");
    const dialog = await screen.findByRole("dialog", { name: "FEN" });
    expect(within(dialog).getByRole("textbox")).toHaveValue(
      "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    expect(dialog).not.toBeInTheDocument();
  });

  it("downloads the PGN and opens the game on Lichess", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    onThread("abc", { ...E4_E5, outcome: { kind: "checkmate", winner: "white" } });
    render(<App />);
    await menuItem("Download PGN");
    expect(downloads.at(-1)).toEqual(["langchain-chess-abc.pgn", expect.stringContaining("1-0")]);
    fireEvent.click(
      within(screen.getByLabelText("game over")).getByRole("button", {
        name: /Analyze on Lichess/,
      }),
    );
    expect(open).toHaveBeenCalledWith(
      expect.stringContaining("lichess.org/analysis/pgn/"),
      "_blank",
      "noopener",
    );
    open.mockRestore();
  });

  // 1,600 plies, the heaviest render in the suite: a CI runner needs more than 5s.
  it("opens only the position when the game is too long for a link", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const moves = Array.from({ length: 1600 }, (_, i) => ["g1f3", "g8f6", "f3g1", "f6g8"][i % 4]);
    onThread("abc", { moves, plies: [], turns: [] });
    render(<App />);
    await menuItem("Analyze on Lichess");
    expect(open).toHaveBeenCalledWith(
      expect.stringMatching(/lichess\.org\/analysis\/rnbqkbnr/),
      "_blank",
      "noopener",
    );
    expect(
      screen.getByText("Opened the position; the game was too long to send."),
    ).toBeInTheDocument();
    open.mockRestore();
  }, 20_000);

  it("names the opening over the moves and in the tab's title", async () => {
    onThread("abc", E4_E5);
    render(<App />);
    expect(await screen.findByText("C20 · King's Pawn Game")).toBeInTheDocument();
    expect(document.title).toBe("King's Pawn Game · LangChain Chess");
  });

  it("marks the opening's move in a phone's move strip, and names it on a tap", async () => {
    const spies = [
      vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(390),
      vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(780),
    ];
    onThread("abc", E4_E5);
    render(<App />);
    const strip = screen.getAllByLabelText("move list").at(-1)!;
    const mark = await within(strip).findByRole("button", {
      name: "Opening: C20 · King's Pawn Game",
    });
    await userEvent.click(mark);
    expect(screen.getByRole("dialog")).toHaveTextContent("C20 · King's Pawn Game");
    for (const spy of spies) spy.mockRestore();
  });
});
