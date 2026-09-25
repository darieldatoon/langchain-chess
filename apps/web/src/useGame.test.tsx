import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { configurableOf, loadSide } from "./settings";
import { fake, lastOptions, resetFake } from "./test/fakeStream";
import { AFTER_E4, E4_E5, turn } from "./test/fixtures";
import { DEFAULT_CONTEXT, START_FEN } from "./types";
import { threadFromUrl, useGame, writeThreadToUrl } from "./useGame";

vi.mock("@langchain/react", async () => (await import("./test/fakeStream")).useStreamMock());

const REJECT = { multitaskStrategy: "reject" };

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
    const { result } = renderHook(() => useGame("", DEFAULT_CONTEXT, "white"));
    expect(result.current.fen).toBe(START_FEN);
    expect(result.current.startFen).toBe(START_FEN);
    expect(result.current.moves).toEqual([]);
    expect(result.current.entries).toEqual([]);
    expect(result.current.outcome).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.humanSide).toBe("white");
    expect(result.current.lastReply).toBeNull();
    expect(result.current.pendingTurn).toBe(false);
    expect(result.current.threadId).toBeNull();
    expect(lastOptions.current).toMatchObject({ assistantId: "chess", apiKey: undefined });
  });

  it("submits a move as a human message with the context and a reject strategy", async () => {
    const context = { ...DEFAULT_CONTEXT, threshold: 0.4 };
    const { result } = renderHook(() => useGame("key", context, "white"));
    expect(lastOptions.current).toMatchObject({ apiKey: "key" });
    await act(() => result.current.play("e2e4", AFTER_E4));
    expect(fake.submit).toHaveBeenCalledWith(
      { messages: [{ type: "human", id: expect.any(String), content: "e2e4" }] },
      { config: { configurable: configurableOf(context) }, ...REJECT },
    );
    expect(result.current.pendingMove).toBeNull();
  });

  it("reuses a command id for the same move at the same position, and mints new ones otherwise", async () => {
    const { result, rerender } = renderHook(() => useGame("", DEFAULT_CONTEXT, "white"));
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

  it("starts with a `go` message and retries with empty input", async () => {
    const { result } = renderHook(() => useGame("", DEFAULT_CONTEXT, "black"));
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
    const { result } = renderHook(() => useGame("", DEFAULT_CONTEXT, "white"));
    expect(result.current.fen).toBe("rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2");
    expect(result.current.entries).toEqual([
      { ply: 0, san: "e4", source: "external" },
      { ply: 1, san: "e5", source: "systemone" },
    ]);
    expect(result.current.lastReply?.ply.san).toBe("e5");
    expect(result.current.lastReply?.turn?.id).toBe("turn-1");
    expect(result.current.lastReply?.fenBefore).toBe(AFTER_E4);
    expect(result.current.pendingTurn).toBe(true);
    expect(result.current.error).toBe("nope");
  });

  it("names moves without plies from the replay, and falls back to UCI", () => {
    resetFake({ start_fen: START_FEN, moves: ["e2e4", "e2e4"] });
    const { result } = renderHook(() => useGame("", DEFAULT_CONTEXT, "white"));
    expect(result.current.entries).toEqual([
      { ply: 0, san: "e4", source: "external" },
      { ply: 1, san: "e2e4", source: "external" },
    ]);
  });

  it("persists the side once the thread is known", () => {
    const { result } = renderHook(() => useGame("", DEFAULT_CONTEXT, "black"));
    const options = lastOptions.current as { onThreadId: (id: string) => void };
    act(() => options.onThreadId("thread-9"));
    expect(result.current.threadId).toBe("thread-9");
    expect(threadFromUrl()).toBe("thread-9");
    expect(loadSide("thread-9")).toBe("black");
  });

  it("ignores a thread reported after the game was replaced", () => {
    const { unmount } = renderHook(() => useGame("", DEFAULT_CONTEXT, "black"));
    const options = lastOptions.current as { onThreadId: (id: string) => void };
    unmount();
    options.onThreadId("late");
    expect(threadFromUrl()).toBeNull();
    expect(window.localStorage.getItem("langchain-chess:side:late")).toBeNull();
  });

  it("clears the optimistic move once the run settles, even on failure", async () => {
    let finish: () => void = () => {};
    fake.submit = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const { result } = renderHook(() => useGame("", DEFAULT_CONTEXT, "white"));
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

  it("streams live analysis only while a run is loading", () => {
    resetFake({}, [
      new HumanMessage({ id: "h", content: "e2e4" }),
      new AIMessage({ id: "a", content: "Considering e5." }),
    ]);
    const idle = renderHook(() => useGame("", DEFAULT_CONTEXT, "white"));
    expect(idle.result.current.liveAnalysis).toBeNull();
    fake.isLoading = true;
    const busy = renderHook(() => useGame("", DEFAULT_CONTEXT, "white"));
    expect(busy.result.current.liveAnalysis).toBe("Considering e5.");
    expect(busy.result.current.isThinking).toBe(true);
  });

  it("reports loading from either stream flag", () => {
    fake.isThreadLoading = true;
    const { result } = renderHook(() => useGame("", DEFAULT_CONTEXT, "white"));
    expect(result.current.isLoading).toBe(true);
    expect(result.current.isThinking).toBe(false);
  });
});
