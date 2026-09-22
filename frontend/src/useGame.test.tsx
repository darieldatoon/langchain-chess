import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { fake, lastOptions, resetFake } from "./test/fakeStream";
import { DEFAULT_CONTEXT, START_FEN, type PlyView } from "./types";
import { threadFromUrl, useGame, writeThreadToUrl } from "./useGame";

vi.mock("@langchain/react", async () => (await import("./test/fakeStream")).useStreamMock());

const jevPly: PlyView = {
  ply: 2,
  side: "black",
  san: "e5",
  uci: "e7e5",
  source: "jev",
  model: "jev-latest",
  latency_ms: 200,
};

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
    const { result } = renderHook(() => useGame("", DEFAULT_CONTEXT));
    expect(result.current.fen).toBe(START_FEN);
    expect(result.current.history).toEqual([]);
    expect(result.current.status).toBe("playing");
    expect(result.current.humanSide).toBe("white");
    expect(result.current.lastPolicyPly).toBeNull();
    expect(result.current.threadId).toBeNull();
    expect(lastOptions.current).toMatchObject({ assistantId: "game", apiKey: undefined });
  });

  it("submits moves with the context as configurable and tracks the pending fen", async () => {
    const { result } = renderHook(() => useGame("key", { ...DEFAULT_CONTEXT, threshold: 0.4 }));
    expect(lastOptions.current).toMatchObject({ apiKey: "key" });
    await act(() => result.current.play("e2e4", "FEN-AFTER"));
    expect(fake.submit).toHaveBeenCalledWith(
      { move: "e2e4" },
      { config: { configurable: expect.objectContaining({ threshold: 0.4 }) } },
    );
    expect(result.current.pendingFen).toBeNull();
    await act(() => result.current.start());
    expect(fake.submit).toHaveBeenLastCalledWith({}, expect.anything());
  });

  it("exposes state, the last policy ply, and clears the pending fen on finish", () => {
    resetFake({
      fen: "FEN",
      history: ["e4", "e5"],
      plies: [
        { ...jevPly, ply: 1, side: "white", san: "e4", uci: "e2e4", source: "human" },
        jevPly,
      ],
      status: "playing",
      human_side: "white",
      player: "jev",
      error: "nope",
    });
    const { result } = renderHook(() => useGame("", DEFAULT_CONTEXT));
    expect(result.current.fen).toBe("FEN");
    expect(result.current.lastPolicyPly?.san).toBe("e5");
    expect(result.current.error).toBe("nope");
    expect(result.current.player).toBe("jev");
    const options = lastOptions.current as { onThreadId: (id: string) => void };
    act(() => options.onThreadId("thread-9"));
    expect(result.current.threadId).toBe("thread-9");
    expect(threadFromUrl()).toBe("thread-9");
    act(() => result.current.newGame());
    expect(result.current.threadId).toBeNull();
    expect(threadFromUrl()).toBeNull();
  });

  it("clears the optimistic fen once the run settles, even on failure", async () => {
    let finish: () => void = () => {};
    fake.submit = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const { result } = renderHook(() => useGame("", DEFAULT_CONTEXT));
    let done: Promise<void> = Promise.resolve();
    act(() => {
      done = result.current.play("e2e4", "FEN-AFTER");
    });
    expect(result.current.pendingFen).toBe("FEN-AFTER");
    await act(async () => {
      finish();
      await done;
    });
    expect(result.current.pendingFen).toBeNull();

    fake.submit = vi.fn(() => Promise.reject(new Error("401")));
    await act(async () => {
      await expect(result.current.play("e2e4", "X")).rejects.toThrow("401");
    });
    expect(result.current.pendingFen).toBeNull();
  });

  it("reports loading from either stream flag", () => {
    resetFake();
    fake.isThreadLoading = true;
    const { result } = renderHook(() => useGame("", DEFAULT_CONTEXT));
    expect(result.current.isLoading).toBe(true);
    expect(result.current.isThinking).toBe(false);
  });
});
