import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import App from "../src/App";
import { checkApiKey, type KeyCheck } from "../src/auth";
import { DEFAULT_SETUP } from "../src/setup";
import { APP_KEY, loadSetup, saveAppSettings, saveSetup } from "../src/storage";
import { fake, lastOptions, optionsLog, resetFake } from "./support/fakeStream";
import { AFTER_E4, E4_E5, ply, turn } from "@langchain-chess/chess-ui/testing";
import { WEB_TRACE } from "../src/useGame";
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
vi.mock("../src/modelLimit", () => ({
  fetchModelLimit: vi.fn(() => Promise.resolve({ kind: "known", tokens: 968000 })),
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
    expect(screen.getByText("SemIf + GLM-5.3 Flash")).toBeInTheDocument();
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

  it("asks the server for the model's input limit with the saved key", async () => {
    saveAppSettings({ apiKey: "lsv2_k" });
    const modelLimit = vi.fn(() => Promise.resolve({ kind: "known" as const, tokens: 968000 }));
    render(<App modelLimit={modelLimit} />);
    await waitFor(() => expect(modelLimit).toHaveBeenCalledWith("lsv2_k", DEFAULT_CONTEXT.model));
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
    await click("Settings");
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

  it("migrates the old settings into the setup and the API key into app settings", async () => {
    window.localStorage.setItem(
      "langchain-chess:settings",
      JSON.stringify({
        apiKey: "lsv2_old",
        context: {
          policy: "random",
          human_side: "black",
          k: 4,
          model: "langsmith:baseten/zai-org/GLM-5.3",
        },
      }),
    );
    render(<App />);
    expect(screen.getByLabelText("LLM")).toHaveValue("langsmith:baseten/zai-org/GLM-5.3");
    expect(window.localStorage.getItem(APP_KEY)).toContain("lsv2_old");
    await click("Play");
    expect(board()).toHaveAttribute("data-orientation", "white");
    expect(lastOptions.current).toMatchObject({ apiKey: "lsv2_old" });
    await click("drop e2e4");
    expect(lastConfigurable()).toEqual({
      ...DEFAULT_CONTEXT,
      k: 4,
      model: "langsmith:baseten/zai-org/GLM-5.3",
    });
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
    saveSetup({ ...DEFAULT_SETUP, systemOne: "none", llm: "langsmith:openai/gpt-6-luna" });
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

  it("continues a Black game from its thread in a browser that has never seen it", async () => {
    onThread("abc", E4_AS_BLACK, LLM_HIGH);
    render(<App />);
    expect(window.localStorage.length).toBe(0);
    expect(board()).toHaveAttribute("data-orientation", "black");
    expect(board()).toHaveAttribute("data-draggable", "true");
    expect(screen.getByText("abc")).toBeInTheDocument();
    expect(screen.getByText("GPT-6 Luna · high")).toBeInTheDocument();
    expect(screen.getByText("Your move.")).toBeInTheDocument();
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
    expect(screen.getByText("Your move.")).toBeInTheDocument();
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
    expect(board()).toHaveAttribute("data-draggable", "false");
    expect(screen.getByText("View only.")).toBeInTheDocument();
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
    expect(screen.getByText("Checkmate, White wins. 1-0")).toBeInTheDocument();
    expect(screen.queryByLabelText("result")).not.toBeInTheDocument();
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
    expect(screen.getByText("Your move.")).toBeInTheDocument();
    expect(board()).toHaveAttribute("data-draggable", "true");
    await click("drop e7e5");
    expect(submitted()).toEqual(["go", "e7e5"]);
  });

  it("keeps Start as a fallback when the automatic start failed", async () => {
    saveSetup({ ...DEFAULT_SETUP, side: "black" });
    fake.submit = vi.fn(() => Promise.reject(new Error("Failed to fetch")));
    await playFromModal();
    expect(screen.getByRole("status")).toHaveTextContent("Failed to fetch");
    expect(screen.getByText(/Press Start/)).toBeInTheDocument();
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
    expect(screen.getByText("Opponent to move.")).toBeInTheDocument();
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
    const result = screen.getByLabelText("result");
    expect(within(result).getByText("You won")).toBeInTheDocument();
    expect(within(result).getByText("Checkmate, White wins. 1-0")).toBeInTheDocument();
    expect(board()).toHaveAttribute("data-draggable", "false");
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();

    await click("Rematch");
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
    expect(screen.getByText("You lost")).toBeInTheDocument();
    await click("Rematch");
    expect(board()).toHaveAttribute("data-orientation", "white");
    expect(fake.submit).not.toHaveBeenCalled();
  });

  it("opens the modal pre-filled with the last setup from the result card", async () => {
    saveSetup({ ...DEFAULT_SETUP, llm: "langsmith:baseten/zai-org/GLM-5.3" });
    onThread("t-1", { ...E4_E5, outcome: { kind: "draw", reason: "threefold" } });
    render(<App />);
    expect(screen.getByText("Draw")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(
        within(screen.getByLabelText("result")).getByRole("button", { name: "New game" }),
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
    await click("Settings");
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
    expect(screen.getByLabelText("move list")).toHaveTextContent("1.e4e5");
    expect(screen.getByText("Your move.")).toBeInTheDocument();
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
    await click("Flip board");
    expect(board()).toHaveAttribute("data-orientation", "black");
    expect(board()).toHaveAttribute("data-draggable", "true");
    await click("Flip board");
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

  it("streams the live analysis while the opponent thinks", async () => {
    resetFake({}, [
      new HumanMessage({ id: "msg-1", content: "e2e4" }),
      new AIMessage({ id: "a1", content: [{ type: "text", text: "**e5** mirrors the centre." }] }),
    ]);
    onThread("abc", { moves: ["e2e4"], plies: [ply()], turns: [turn({ status: "pending" })] });
    fake.isLoading = true;
    render(<App />);
    expect(screen.getByText("Opponent is thinking")).toBeInTheDocument();
    // Plain text until the lazy Markdown renderer has loaded.
    expect(screen.getByLabelText("thinking")).toHaveTextContent("**e5** mirrors the centre.");
    expect(await screen.findByText("e5", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByLabelText("thinking")).toHaveTextContent("e5 mirrors the centre.");
    expect(screen.queryByLabelText("last reply")).not.toBeInTheDocument();
    expect(board()).toHaveAttribute("data-draggable", "false");
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
    expect(screen.getByText("Opponent is thinking")).toBeInTheDocument();
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
    expect(screen.queryByText("Opponent is thinking")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("thinking")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("result")).not.toBeInTheDocument();
    expect(screen.getByText("No moves yet.")).toBeInTheDocument();
    expect(button("Start")).toBeInTheDocument();
  });
});
