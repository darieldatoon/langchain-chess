import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { configurableOf } from "../src/settings";
import type { GameRecord } from "../src/setup";
import { fake, lastOptions, resetFake } from "./support/fakeStream";
import { AFTER_E4, E4_E5, turn } from "@langchain-chess/chess-ui/testing";
import { DEFAULT_CONTEXT, START_FEN, type ChessValues } from "@langchain-chess/chess-ui";
import { threadFromUrl, useGame, writeThreadToUrl } from "../src/useGame";

vi.mock("@langchain/react", async () => (await import("./support/fakeStream")).useStreamMock());

const REJECT = { multitaskStrategy: "reject" };
const WHITE: GameRecord = { side: "white", context: DEFAULT_CONTEXT, timeControl: null };
const BLACK: GameRecord = { side: "black", context: DEFAULT_CONTEXT, timeControl: null };

beforeEach(() => {
  resetFake();
  writeThreadToUrl(null);
});

describe("thread url helpers", () => {
  it("reads and writes the thread query parameter", () => {
    expect(threadFromUrl("?thread=abc")).toBe("abc");
    expect(threadFromUrl("")).toBeNull();
    writeThreadToUrl("t-1");
    expect(threadFromUrl()).toBe("t-1");
    writeThreadToUrl(null);
    expect(threadFromUrl()).toBeNull();
  });
});

describe("useGame", () => {
  it("derives defaults from an empty thread", () => {
    const { result } = renderHook(() => useGame("", WHITE));
    expect(result.current.fen).toBe(START_FEN);
    expect(result.current.startFen).toBe(START_FEN);
    expect(result.current.moves).toEqual([]);
    expect(result.current.entries).toEqual([]);
    expect(result.current.outcome).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.record).toEqual(WHITE);
    expect(result.current.reply).toEqual({ status: "none" });
    expect(result.current.pendingTurn).toBe(false);
    expect(result.current.threadId).toBeNull();
    expect(lastOptions.current).toMatchObject({ assistantId: "chess", apiKey: undefined });
  });

  it("submits a move as a human message with the context and a reject strategy", async () => {
    const context = { ...DEFAULT_CONTEXT, threshold: 0.4 };
    const chosen: GameRecord = { ...WHITE, context };
    const { result } = renderHook(() => useGame("key", chosen));
    expect(lastOptions.current).toMatchObject({ apiKey: "key" });
    await act(() => result.current.play("e2e4", AFTER_E4));
    expect(fake.submit).toHaveBeenCalledWith(
      { messages: [{ type: "human", id: expect.any(String), content: "e2e4" }] },
      {
        config: { configurable: configurableOf(context), run_name: "chess-web", tags: ["web"] },
        metadata: { surface: "web" },
        ...REJECT,
      },
    );
    expect(result.current.pendingMove).toBeNull();
  });

  it("reuses a command id for the same move at the same position, and mints new ones otherwise", async () => {
    const { result, rerender } = renderHook(() => useGame("", WHITE));
    await act(() => result.current.play("e2e4", AFTER_E4));
    await act(() => result.current.play("e2e4", AFTER_E4));
    await act(() => result.current.play("d2d4", "X"));
    fake.values = { moves: ["e2e4", "e7e5"] };
    rerender();
    await act(() => result.current.play("e2e4", "X"));
    const ids = fake.submit.mock.calls.map(([input]) => input.messages[0].id as string);
    expect(ids[0]).toBe(ids[1]);
    expect(new Set(ids).size).toBe(3);
  });

  it("resends the first command with its id after the server assigns the thread", async () => {
    const { result } = renderHook(() => useGame("", BLACK));
    await act(() => result.current.start());
    const options = lastOptions.current as { onThreadId: (id: string) => void };
    act(() => options.onThreadId("thread-1"));
    await act(() => result.current.start());
    const [first, resent] = fake.submit.mock.calls.map(([input]) => input.messages[0].id);
    expect(resent).toBe(first);
  });

  it("starts with a `go` message and retries with empty input", async () => {
    const { result } = renderHook(() => useGame("", BLACK));
    await act(() => result.current.start());
    expect(fake.submit).toHaveBeenLastCalledWith(
      { messages: [{ type: "human", id: expect.any(String), content: "go" }] },
      expect.objectContaining(REJECT),
    );
    await act(() => result.current.retry());
    expect(fake.submit).toHaveBeenLastCalledWith({}, expect.objectContaining(REJECT));
  });

  it("exposes the record, the last reply with its turn, and a pending turn", () => {
    resetFake({
      ...E4_E5,
      turns: [...E4_E5.turns, turn({ id: "turn-2", status: "pending" })],
      error: "nope",
      outcome: null,
    });
    const { result } = renderHook(() => useGame("", WHITE));
    expect(result.current.fen).toBe("rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2");
    expect(result.current.entries).toEqual([
      { ply: 0, san: "e4", source: "external" },
      { ply: 1, san: "e5", source: "systemone" },
    ]);
    expect(result.current.reply).toMatchObject({
      status: "played",
      reply: { ply: { san: "e5" }, turn: { id: "turn-1" }, fenBefore: AFTER_E4 },
    });
    expect(result.current.pendingTurn).toBe(true);
    expect(result.current.error).toBe("nope");
  });

  it("names moves without plies from the replay, and falls back to UCI", () => {
    resetFake({ start_fen: START_FEN, moves: ["e2e4", "e2e4"] });
    const { result } = renderHook(() => useGame("", WHITE));
    expect(result.current.entries).toEqual([
      { ply: 0, san: "e4", source: "external" },
      { ply: 1, san: "e2e4", source: "external" },
    ]);
  });

  it("binds the thread and the URL once the server assigns it, and stores nothing", () => {
    const { result } = renderHook(() => useGame("", BLACK));
    const options = lastOptions.current as { onThreadId: (id: string) => void };
    act(() => options.onThreadId("thread-9"));
    expect(result.current.threadId).toBe("thread-9");
    expect(threadFromUrl()).toBe("thread-9");
    expect(window.localStorage.length).toBe(0);
  });

  it("plays with the setup the thread records, over the picks", async () => {
    const recorded = { ...DEFAULT_CONTEXT, policy: "llm" as const, k: 3 };
    resetFake({ ...E4_E5, setup: recorded });
    const { result } = renderHook(() => useGame("", BLACK));
    expect(result.current.record).toEqual({ ...WHITE, context: recorded });
    await act(() => result.current.play("g1f3", "X"));
    expect(fake.submit.mock.lastCall?.[1].config.configurable).toEqual(configurableOf(recorded));
  });

  it("has no record for a thread from its link without a setup", () => {
    resetFake(E4_E5);
    const { result } = renderHook(() => useGame("", null));
    expect(result.current.record).toBeNull();
  });

  it("is ready once the thread has loaded, and says so when the load failed", async () => {
    fake.isThreadLoading = true;
    const loading = renderHook(() => useGame("", WHITE));
    expect(loading.result.current.restore).toBe("loading");
    loading.unmount();

    fake.isThreadLoading = false;
    const ready = renderHook(() => useGame("", WHITE));
    expect(ready.result.current.restore).toBe("ready");

    fake.hydrationPromise = Promise.reject(new Error("Thread state request failed: 503"));
    const failed = renderHook(() => useGame("", WHITE));
    await act(async () => {});
    expect(failed.result.current.restore).toBe("failed");

    // A new client loads the thread again: a new promise, and nothing failed yet.
    fake.hydrationPromise = Promise.resolve();
    failed.rerender();
    expect(failed.result.current.restore).toBe("ready");
  });

  it("ignores a thread reported after the game was replaced", () => {
    const { unmount } = renderHook(() => useGame("", BLACK));
    const options = lastOptions.current as { onThreadId: (id: string) => void };
    unmount();
    options.onThreadId("late");
    expect(threadFromUrl()).toBeNull();
  });

  it("clears the optimistic move once the run settles, even on failure", async () => {
    let finish: () => void = () => {};
    fake.submit = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const { result } = renderHook(() => useGame("", WHITE));
    let done: Promise<void> = Promise.resolve();
    act(() => {
      done = result.current.play("e2e4", AFTER_E4);
    });
    expect(result.current.pendingMove).toEqual({ uci: "e2e4", fen: AFTER_E4 });
    await act(async () => {
      finish();
      await done;
    });
    expect(result.current.pendingMove).toBeNull();

    fake.submit = vi.fn(() => Promise.reject(new Error("401")));
    await act(async () => {
      await expect(result.current.play("e2e4", "X")).rejects.toThrow("401");
    });
    expect(result.current.pendingMove).toBeNull();
  });

  it("thinks for the whole run, streaming the analysis once it has text", () => {
    resetFake(E4_E5, [new HumanMessage({ id: "h", content: "e2e4" })]);
    const idle = renderHook(() => useGame("", WHITE));
    expect(idle.result.current.reply.status).toBe("played");
    fake.isLoading = true;
    const started = renderHook(() => useGame("", WHITE));
    expect(started.result.current.reply).toEqual({ status: "thinking", reasoning: null });
    fake.messages = [...fake.messages, new AIMessage({ id: "a", content: "Considering e5." })];
    const busy = renderHook(() => useGame("", WHITE));
    expect(busy.result.current.reply).toEqual({
      status: "thinking",
      reasoning: "Considering e5.",
    });
    expect(busy.result.current.isThinking).toBe(true);
  });

  it("reports loading from either stream flag", () => {
    fake.isThreadLoading = true;
    const { result } = renderHook(() => useGame("", WHITE));
    expect(result.current.isLoading).toBe(true);
    expect(result.current.isThinking).toBe(false);
  });
});

describe("useGame on a clock", () => {
  const CONTROL = { base_ms: 60_000, increment_ms: 2_000 };
  const TIMED_WHITE: GameRecord = { ...WHITE, timeControl: CONTROL };
  const TIMED_BLACK: GameRecord = { ...BLACK, timeControl: CONTROL };
  let time = 0;
  const now = () => time;
  const clockSent = (white_ms: number, black_ms: number) => ({
    clock: { control: CONTROL, white_ms, black_ms },
  });
  /** Submits start a run that stays in flight, as the real stream's do. */
  const inFlight = () => {
    fake.submit = vi.fn(() => {
      fake.isLoading = true;
      return Promise.resolve();
    });
  };
  const timed = (values: ChessValues) => {
    fake.values = { time_control: CONTROL, ...values };
  };

  beforeEach(() => {
    time = 1_000;
    inFlight();
  });

  it("has no clock untimed", () => {
    const { result } = renderHook(() => useGame("", WHITE, now));
    expect(result.current.clock).toBeNull();
  });

  it("sends the first move for free with its increment, then runs the agent's clock", async () => {
    const { result } = renderHook(() => useGame("", TIMED_WHITE, now));
    expect(result.current.clock?.running).toBeNull();
    time = 9_000;
    await act(() => result.current.play("e2e4", AFTER_E4));
    expect(fake.submit).toHaveBeenLastCalledWith(
      { messages: [expect.objectContaining({ content: "e2e4" })], ...clockSent(62_000, 60_000) },
      expect.objectContaining(REJECT),
    );
    expect(result.current.clock?.running).toEqual({ side: "black", since: 9_000 });
  });

  it("adopts the agent's recorded time once its move lands, then runs the human's", async () => {
    const { result, rerender } = renderHook(() => useGame("", TIMED_WHITE, now));
    await act(() => result.current.play("e2e4", AFTER_E4));
    timed({
      ...E4_E5,
      plies: [
        { ...E4_E5.plies[0], clock_ms: 62_000 },
        { ...E4_E5.plies[1], clock_ms: 55_000 },
      ],
    });
    fake.isLoading = true;
    rerender();
    expect(result.current.clock?.left).toEqual({ white: 62_000, black: 55_000 });
    expect(result.current.clock?.running).toBeNull();
    time = 20_000;
    fake.isLoading = false;
    rerender();
    expect(result.current.clock?.running).toEqual({ side: "white", since: 20_000 });
  });

  it("opens as Black with both clocks full, the agent's running", async () => {
    const { result } = renderHook(() => useGame("", TIMED_BLACK, now));
    await act(() => result.current.start());
    expect(fake.submit).toHaveBeenLastCalledWith(
      { messages: [expect.objectContaining({ content: "go" })], ...clockSent(60_000, 60_000) },
      expect.objectContaining(REJECT),
    );
    expect(result.current.clock?.running?.side).toBe("white");
  });

  it("restores a game's clocks from its last plies, running the human's on their turn", () => {
    timed({
      ...E4_E5,
      setup: DEFAULT_CONTEXT,
      plies: [
        { ...E4_E5.plies[0], clock_ms: 58_000 },
        { ...E4_E5.plies[1], clock_ms: 41_000 },
      ],
    });
    const { result } = renderHook(() => useGame("", null, now));
    expect(result.current.record?.timeControl).toEqual(CONTROL);
    expect(result.current.clock?.left).toEqual({ white: 58_000, black: 41_000 });
    expect(result.current.clock?.running).toEqual({ side: "white", since: 1_000 });
  });

  it("pauses a failed turn with the agent charged, and runs it again on Retry", async () => {
    const pending = { ...E4_E5.turns[0], id: "turn-2", status: "pending" as const, ply: null };
    const { result, rerender } = renderHook(() => useGame("", TIMED_BLACK, now));
    await act(() => result.current.start());
    time = 6_000;
    timed({ moves: [], plies: [], turns: [pending] });
    fake.isLoading = false;
    rerender();
    expect(result.current.clock?.running).toBeNull();
    expect(result.current.clock?.left.white).toBe(55_000);

    time = 60_000;
    await act(() => result.current.retry());
    expect(fake.submit).toHaveBeenLastCalledWith(
      clockSent(55_000, 60_000),
      expect.objectContaining(REJECT),
    );
    expect(result.current.clock?.running).toEqual({ side: "white", since: 60_000 });
  });

  it("flags the agent over its run with an interrupt, once per position", async () => {
    const { result, rerender } = renderHook(() => useGame("", TIMED_WHITE, now));
    await act(() => result.current.play("e2e4", AFTER_E4));
    timed({ moves: ["e2e4"], plies: [{ ...E4_E5.plies[0], clock_ms: 62_000 }] });
    rerender();
    time = 70_000;
    await act(() => result.current.flag("black"));
    expect(fake.submit).toHaveBeenLastCalledWith(
      { ...clockSent(62_000, 0), flag: "black" },
      expect.objectContaining({ multitaskStrategy: "interrupt" }),
    );
    expect(result.current.clock?.running).toBeNull();
    await act(() => result.current.flag("black"));
    expect(fake.submit).toHaveBeenCalledTimes(2);
  });

  describe("a move that never lands", () => {
    const restored = () => {
      timed({
        ...E4_E5,
        setup: DEFAULT_CONTEXT,
        plies: [
          { ...E4_E5.plies[0], clock_ms: 58_000 },
          { ...E4_E5.plies[1], clock_ms: 41_000 },
        ],
      });
      return renderHook(() => useGame("", null, now));
    };

    it("earns no increment and charges the agent nothing when the move is refused", async () => {
      const { result, rerender } = restored();
      time = 5_000;
      await act(() => result.current.play("g1f3", "X"));
      expect(fake.submit.mock.lastCall?.[0]).toMatchObject(clockSent(56_000, 41_000));
      expect(result.current.clock?.left.white).toBe(54_000);
      expect(result.current.clock?.running?.side).toBe("black");

      time = 9_000;
      fake.isLoading = false;
      rerender();
      expect(result.current.clock?.running).toEqual({ side: "white", since: 1_000 });
      expect(result.current.clock?.left).toEqual({ white: 58_000, black: 41_000 });
    });

    it("goes back to the clock before it when the submit fails", async () => {
      fake.submit = vi.fn(() => Promise.reject(new Error("Failed to fetch")));
      const { result } = restored();
      time = 5_000;
      await act(async () => {
        await expect(result.current.play("g1f3", "X")).rejects.toThrow("Failed to fetch");
      });
      expect(result.current.clock?.running).toEqual({ side: "white", since: 1_000 });
      expect(result.current.clock?.left.black).toBe(41_000);
    });
  });

  it("watches for a flag only once the record has the control and the move the run carries", async () => {
    const { result, rerender } = renderHook(() => useGame("", TIMED_WHITE, now));
    expect(result.current.flaggable).toBeNull();
    await act(() => result.current.play("e2e4", AFTER_E4));
    expect(result.current.clock?.running?.side).toBe("black");
    expect(result.current.flaggable).toBeNull();
    timed({ moves: ["e2e4"], plies: [{ ...E4_E5.plies[0], clock_ms: 62_000 }] });
    rerender();
    expect(result.current.flaggable).toBe(result.current.clock);
    fake.values = { ...fake.values, outcome: { kind: "timeout", winner: "white" } };
    rerender();
    expect(result.current.flaggable).toBeNull();
  });

  it("resends a flag whose request failed on Retry, past the once-per-position guard", async () => {
    const { result, rerender } = renderHook(() => useGame("", TIMED_WHITE, now));
    await act(() => result.current.play("e2e4", AFTER_E4));
    timed({ moves: ["e2e4"], plies: [{ ...E4_E5.plies[0], clock_ms: 62_000 }] });
    rerender();
    expect(result.current.fallen).toBeNull();
    fake.submit = vi.fn(() => {
      fake.isLoading = false;
      return Promise.reject(new Error("Failed to fetch"));
    });
    time = 70_000;
    await act(async () => {
      await expect(result.current.flag("black")).rejects.toThrow("Failed to fetch");
    });
    expect(result.current.fallen).toBe("black");

    fake.submit = vi.fn(() => Promise.resolve());
    await act(() => result.current.retry());
    expect(fake.submit).toHaveBeenCalledWith(
      { ...clockSent(62_000, 0), flag: "black" },
      expect.objectContaining({ multitaskStrategy: "interrupt" }),
    );
  });

  it("keeps the human's clock stopped at zero after a failed flag, so Retry can resend it", async () => {
    timed({ ...E4_E5, setup: DEFAULT_CONTEXT });
    const { result } = renderHook(() => useGame("", null, now));
    fake.submit = vi.fn(() => Promise.reject(new Error("Failed to fetch")));
    time = 61_000;
    await act(async () => {
      await expect(result.current.flag("white")).rejects.toThrow("Failed to fetch");
    });
    expect(result.current.clock?.running).toBeNull();
    expect(result.current.fallen).toBe("white");

    fake.submit = vi.fn(() => Promise.resolve());
    await act(() => result.current.retry());
    expect(fake.submit).toHaveBeenCalledWith(
      { ...clockSent(0, 60_000), flag: "white" },
      expect.objectContaining(REJECT),
    );
  });

  it("offers no Retry while an interrupting flag still runs, though loading dropped", async () => {
    const { result, rerender } = renderHook(() => useGame("", TIMED_WHITE, now));
    await act(() => result.current.play("e2e4", AFTER_E4));
    timed({ moves: ["e2e4"], plies: [{ ...E4_E5.plies[0], clock_ms: 62_000 }] });
    rerender();
    let finish = () => {};
    fake.submit = vi.fn(() => {
      fake.isLoading = false;
      return new Promise<void>((resolve) => (finish = resolve));
    });
    time = 70_000;
    let flagged: Promise<void> = Promise.resolve();
    act(() => {
      flagged = result.current.flag("black");
    });
    rerender();
    expect(result.current.fallen).toBeNull();
    await act(async () => {
      finish();
      await flagged;
    });
    expect(result.current.fallen).toBe("black");
  });

  it("flags the human with no run to interrupt", async () => {
    timed({ ...E4_E5, setup: DEFAULT_CONTEXT });
    const { result } = renderHook(() => useGame("", null, now));
    time = 61_000;
    await act(() => result.current.flag("white"));
    expect(fake.submit).toHaveBeenLastCalledWith(
      { ...clockSent(0, 60_000), flag: "white" },
      expect.objectContaining(REJECT),
    );
  });

  it("flags instead of moving once the human's time is gone", async () => {
    timed({ ...E4_E5, setup: DEFAULT_CONTEXT });
    const { result } = renderHook(() => useGame("", null, now));
    time = 61_001;
    await act(() => result.current.play("g1f3", AFTER_E4));
    expect(fake.submit).toHaveBeenCalledTimes(1);
    expect(fake.submit).toHaveBeenLastCalledWith(
      { ...clockSent(0, 60_000), flag: "white" },
      expect.objectContaining(REJECT),
    );
    expect(result.current.pendingMove).toBeNull();
  });

  it("sends no flag untimed", async () => {
    const { result } = renderHook(() => useGame("", WHITE, now));
    await act(() => result.current.flag("black"));
    expect(fake.submit).not.toHaveBeenCalled();
  });
});
