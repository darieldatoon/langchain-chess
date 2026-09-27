import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { DEFAULT_CONTEXT } from "@langchain-chess/chess-ui";
import { AFTER_E4, ply, turn } from "@langchain-chess/chess-ui/testing";
import type { GameRecord } from "../src/setup";
import { useGame, writeThreadToUrl } from "../src/useGame";

const WHITE: GameRecord = { side: "white", context: DEFAULT_CONTEXT, timeControl: null };

// The real SDK, over a stubbed fetch: how it settles a thread load is what `restore` reads.
function serve(
  state: (url: string) => Response | Promise<Response>,
  other: Response = Response.json([]),
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      return url.includes("/state") ? state(url) : other.clone();
    }),
  );
}

const json = (status: number, body: unknown) => Response.json(body, { status });

afterEach(() => {
  vi.unstubAllGlobals();
  writeThreadToUrl(null);
});

describe("useGame on the real SDK", () => {
  const state = (values: unknown) =>
    json(200, {
      values,
      next: [],
      tasks: [],
      checkpoint: { thread_id: "abc", checkpoint_ns: "", checkpoint_id: "1" },
      metadata: {},
      created_at: null,
      parent_checkpoint: null,
    });

  it("is ready once an existing thread loads", async () => {
    serve(() => state({ moves: ["e2e4"] }));
    writeThreadToUrl("abc");
    const { result } = renderHook(() => useGame("", WHITE));
    await waitFor(() => expect(result.current.restore).toBe("ready"));
    expect(result.current.moves).toEqual(["e2e4"]);
  });

  it("continues a game from its thread alone, in a browser that has never seen it", async () => {
    const setup = { ...DEFAULT_CONTEXT, policy: "llm", k: 3 };
    serve(() =>
      state({
        moves: ["e2e4"],
        plies: [ply({ source: "llm", turn_id: "turn-1" })],
        turns: [turn({ ply: 0 })],
        setup,
      }),
    );
    writeThreadToUrl("abc");
    const { result } = renderHook(() => useGame("", null));
    await waitFor(() => expect(result.current.restore).toBe("ready"));
    expect(result.current.record).toEqual({ side: "black", context: setup, timeControl: null });
    expect(window.localStorage.length).toBe(0);
  });

  it("reports a thread the server doesn't have as missing, not as a new game", async () => {
    serve(() => json(404, { detail: "Thread not found" }));
    writeThreadToUrl("gone");
    const { result } = renderHook(() => useGame("", WHITE));
    await waitFor(() => expect(result.current.restore).toBe("missing"));
    expect(result.current.streamError).toBeUndefined();
  });

  it("reports a failed load", async () => {
    serve(() => json(403, { detail: "Forbidden" }));
    writeThreadToUrl("abc");
    const { result } = renderHook(() => useGame("", WHITE));
    await waitFor(() => expect(result.current.restore).toBe("failed"));
  });

  it("reports a thread created in this tab as missing once a reload with a new key 404s", async () => {
    // The server refuses the run, so the thread never exists: the new client's load 404s.
    serve(() => json(404, { detail: "Thread not found" }), json(400, { detail: "rejected" }));
    const { result, rerender } = renderHook(({ apiKey }) => useGame(apiKey, WHITE), {
      initialProps: { apiKey: "" },
    });
    await act(async () => {
      await result.current.play("e2e4", AFTER_E4).catch(() => {});
    });
    expect(result.current.threadId).not.toBeNull();
    expect(result.current.restore).toBe("ready");

    rerender({ apiKey: "lsv2_new" });
    await waitFor(() => expect(result.current.restore).toBe("missing"));
    expect(result.current.moves).toEqual([]);
  });

  it.each([
    ["missing", 404, { detail: "Thread not found" }],
    ["failed", 403, { detail: "Forbidden" }],
  ])(
    "keeps the current load's %s over a superseded load that settles later",
    async (restore, status, body) => {
      let releaseFirst: (response: Response) => void = () => {};
      const loads = [
        new Promise<Response>((resolve) => (releaseFirst = resolve)),
        Promise.resolve(json(status, body)),
      ];
      let load = 0;
      serve(() => loads[load++]);
      writeThreadToUrl("abc");
      const { result, rerender } = renderHook(({ apiKey }) => useGame(apiKey, WHITE), {
        initialProps: { apiKey: "" },
      });
      rerender({ apiKey: "lsv2_new" });
      await waitFor(() => expect(result.current.restore).toBe(restore));

      await act(async () => releaseFirst(json(404, { detail: "Thread not found" })));
      expect(result.current.restore).toBe(restore);
    },
  );

  it("is ready for a new game, which has no thread to load", async () => {
    serve(() => json(500, {}));
    const { result } = renderHook(() => useGame("", WHITE));
    await waitFor(() => expect(result.current.restore).toBe("ready"));
  });
});
