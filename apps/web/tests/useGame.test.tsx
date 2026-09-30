import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { configurableOf } from "../src/settings";
import type { GameRecord } from "../src/setup";
import { fake, lastOptions, resetFake } from "./support/fakeStream";
import { AFTER_E4, E4_E5, turn } from "@langchain-chess/chess-ui/testing";
import { DEFAULT_CONTEXT, START_FEN } from "@langchain-chess/chess-ui";
import { threadFromUrl, useGame, writeThreadToUrl } from "../src/useGame";

vi.mock("@langchain/react", async () => (await import("./support/fakeStream")).useStreamMock());

const REJECT = { multitaskStrategy: "reject" };
const WHITE: GameRecord = { side: "white", context: DEFAULT_CONTEXT, startFen: START_FEN };
const BLACK: GameRecord = { side: "black", context: DEFAULT_CONTEXT, startFen: START_FEN };

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
    const chosen: GameRecord = { side: "white", context, startFen: START_FEN };
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
    expect(result.current.record).toEqual({
      side: "white",
      context: recorded,
      startFen: START_FEN,
    });
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
