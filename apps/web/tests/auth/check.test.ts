import { describe, expect, it, vi } from "vite-plus/test";
import { checkAccess, keyCheckMessage } from "../../src/auth/check";
import { NO_SESSION, type Session } from "../../src/auth/session";

const KEY: Session = { kind: "apiKey", apiKey: "lsv2_k" };
const answering = (status: number, body: BodyInit | null = null) =>
  vi.fn(() => Promise.resolve(new Response(body, { status })));

describe("checkAccess", () => {
  it("sends the session to an authenticated endpoint and accepts what the server accepts", async () => {
    const fetcher = answering(200);
    expect(await checkAccess("http://x", KEY, fetcher)).toEqual({ kind: "ok" });
    expect(fetcher).toHaveBeenCalledWith("http://x/assistants/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": "lsv2_k" },
      body: JSON.stringify({ limit: 1 }),
    });
  });

  it("sends no credentials without a sign-in, which langgraph dev accepts", async () => {
    const fetcher = answering(200);
    expect(await checkAccess("http://x", NO_SESSION, fetcher)).toEqual({ kind: "ok" });
    expect(fetcher).toHaveBeenCalledWith(
      "http://x/assistants/search",
      expect.objectContaining({ headers: { "Content-Type": "application/json" } }),
    );
  });

  it.each([401, 403])("tells missing credentials from rejected ones on %i", async (status) => {
    expect(await checkAccess("http://x", NO_SESSION, answering(status))).toEqual({
      kind: "missing",
    });
    expect(await checkAccess("http://x", KEY, answering(status))).toEqual({
      kind: "rejected",
      detail: null,
    });
  });

  it("passes the server's reason for a refusal on", async () => {
    const refused = (body: string) => answering(403, body);
    expect(await checkAccess("http://x", KEY, refused('{"detail":"Not this org."}'))).toEqual({
      kind: "rejected",
      detail: "Not this org.",
    });
    expect(await checkAccess("http://x", KEY, refused('{"detail":""}'))).toEqual({
      kind: "rejected",
      detail: null,
    });
    expect(await checkAccess("http://x", KEY, refused("not json"))).toEqual({
      kind: "rejected",
      detail: null,
    });
  });

  it("leaves other server errors to the game screen", async () => {
    expect(await checkAccess("http://x", KEY, answering(500))).toEqual({ kind: "ok" });
  });

  it("reports a network failure, or a sign-in that can't renew, as unreachable", async () => {
    const down = (error: unknown) => vi.fn(() => Promise.reject(error));
    expect(await checkAccess("http://x", KEY, down(new TypeError("Failed to fetch")))).toEqual({
      kind: "unreachable",
      message: "Failed to fetch",
    });
    expect(await checkAccess("http://x", KEY, down("offline"))).toEqual({
      kind: "unreachable",
      message: "offline",
    });
    const expired: Session = {
      kind: "oauth",
      email: null,
      accessToken: () => Promise.reject(new Error("expired")),
    };
    expect(await checkAccess("http://x", expired, answering(200))).toEqual({
      kind: "unreachable",
      message: "expired",
    });
  });
});

describe("keyCheckMessage", () => {
  it("names the problem, with the server's reason, and passes a network error through", () => {
    expect(keyCheckMessage({ kind: "missing" }).title).toBe("Sign-in needed");
    expect(keyCheckMessage({ kind: "rejected", detail: null })).toEqual({
      title: "Sign-in refused",
      body: "The server refused your sign-in. Sign out in Settings and sign in again.",
    });
    expect(keyCheckMessage({ kind: "rejected", detail: "Not this org." }).body).toBe(
      "Not this org. Sign out in Settings and sign in again.",
    );
    expect(keyCheckMessage({ kind: "unreachable", message: "boom" })).toEqual({
      title: "Server unreachable",
      body: "boom",
    });
  });
});
