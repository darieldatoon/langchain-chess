import { describe, expect, it, vi } from "vite-plus/test";
import { fetchModelLimit } from "../src/modelLimit";

const answer = (status: number, body: unknown) =>
  vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })));

describe("fetchModelLimit", () => {
  it("asks the server with the key and reads the limit", async () => {
    const fetcher = answer(200, { max_input_tokens: 968000 });
    const model = "langsmith:baseten/zai-org/GLM-5.3";
    expect(await fetchModelLimit("https://chess.test", "k", model, fetcher)).toEqual({
      kind: "known",
      tokens: 968000,
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://chess.test/ui/model-limit?model=langsmith%3Abaseten%2Fzai-org%2FGLM-5.3",
      { headers: { "x-api-key": "k" } },
    );
  });

  it("reports a model the server knows no limit for", async () => {
    const none = answer(200, { max_input_tokens: null });
    expect(await fetchModelLimit("https://chess.test", "", "m", none)).toEqual({ kind: "none" });
  });

  it("reports a failed request, a bad answer or no server as a failure, not as no limit", async () => {
    const url = "https://chess.test";
    const failed = { kind: "failed" };
    expect(await fetchModelLimit(url, "", "m", answer(503, {}))).toEqual(failed);
    expect(await fetchModelLimit(url, "", "m", answer(401, {}))).toEqual(failed);
    expect(await fetchModelLimit(url, "", "m", answer(200, ["nope"]))).toEqual(failed);
    expect(await fetchModelLimit(url, "", "m", answer(200, { max_input_tokens: "1" }))).toEqual(
      failed,
    );
    const down = vi.fn(() => Promise.reject(new TypeError("Failed to fetch")));
    expect(await fetchModelLimit(url, "", "m", down)).toEqual(failed);
  });
});
