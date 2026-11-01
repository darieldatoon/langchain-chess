import { describe, expect, it } from "vite-plus/test";
import {
  NO_SESSION,
  sessionClient,
  sessionHeaders,
  withHeaders,
  type Session,
} from "../../src/auth/session";

const OAUTH: Session = { kind: "oauth", email: null, accessToken: () => Promise.resolve("tok") };

describe("session credentials", () => {
  it("are the header each server check expects", async () => {
    expect(await sessionHeaders(NO_SESSION)).toEqual({});
    expect(await sessionHeaders({ kind: "apiKey", apiKey: "k" })).toEqual({ "x-api-key": "k" });
    expect(await sessionHeaders(OAUTH)).toEqual({ Authorization: "Bearer tok" });
  });

  it("join a request's own headers, replacing any of the same name", () => {
    const init = withHeaders(
      { method: "POST", headers: { "x-api-key": "old", Accept: "x" } },
      { "x-api-key": "new" },
    );
    expect(init.method).toBe("POST");
    expect(Object.fromEntries(new Headers(init.headers).entries())).toEqual({
      accept: "x",
      "x-api-key": "new",
    });
    expect(new Headers(withHeaders(undefined, { a: "1" }).headers).get("a")).toBe("1");
  });

  it("ride on every SDK request, with no key from the environment", async () => {
    const client = sessionClient("http://x", OAUTH).threads as unknown as {
      onRequest: (url: URL, init: RequestInit) => Promise<RequestInit>;
      defaultHeaders: Record<string, unknown>;
    };
    expect(client.defaultHeaders["x-api-key"]).toBeUndefined();
    const init = await client.onRequest(new URL("http://x/threads"), {});
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer tok");
  });
});
