import { describe, expect, it, vi } from "vite-plus/test";
import { checkApiKey, keyCheckMessage } from "./auth";

const answering = (status: number) => vi.fn(() => Promise.resolve(new Response(null, { status })));

describe("checkApiKey", () => {
  it("sends the key to an authenticated endpoint and accepts what the server accepts", async () => {
    const fetcher = answering(200);
    expect(await checkApiKey("http://x", "lsv2_k", fetcher)).toEqual({ kind: "ok" });
    expect(fetcher).toHaveBeenCalledWith("http://x/assistants/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": "lsv2_k" },
      body: JSON.stringify({ limit: 1 }),
    });
  });

  it("sends no key header without a key, which langgraph dev accepts", async () => {
    const fetcher = answering(200);
    expect(await checkApiKey("http://x", "", fetcher)).toEqual({ kind: "ok" });
    expect(fetcher).toHaveBeenCalledWith(
      "http://x/assistants/search",
      expect.objectContaining({ headers: { "Content-Type": "application/json" } }),
    );
  });

  it.each([401, 403])("tells a missing key from a rejected one on %i", async (status) => {
    expect(await checkApiKey("http://x", "", answering(status))).toEqual({ kind: "missing" });
    expect(await checkApiKey("http://x", "bad", answering(status))).toEqual({ kind: "rejected" });
  });

  it("leaves other server errors to the game screen", async () => {
    expect(await checkApiKey("http://x", "k", answering(500))).toEqual({ kind: "ok" });
  });

  it("reports a network failure as unreachable", async () => {
    const down = (error: unknown) => vi.fn(() => Promise.reject(error));
    expect(await checkApiKey("http://x", "k", down(new TypeError("Failed to fetch")))).toEqual({
      kind: "unreachable",
      message: "Failed to fetch",
    });
    expect(await checkApiKey("http://x", "k", down("offline"))).toEqual({
      kind: "unreachable",
      message: "offline",
    });
  });
});

describe("keyCheckMessage", () => {
  it("names the problem and passes a network error through", () => {
    expect(keyCheckMessage({ kind: "missing" }).title).toBe("LangSmith API key needed");
    expect(keyCheckMessage({ kind: "rejected" }).title).toBe("API key rejected");
    expect(keyCheckMessage({ kind: "unreachable", message: "boom" })).toEqual({
      title: "Server unreachable",
      body: "boom",
    });
  });
});
