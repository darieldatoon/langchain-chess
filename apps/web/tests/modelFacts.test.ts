import { describe, expect, it, vi } from "vite-plus/test";
import { fetchModelFacts } from "../src/modelFacts";

const answer = (status: number, body: unknown) =>
  vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })));

describe("fetchModelFacts", () => {
  it("asks the server with the key and reads the limit and whether it takes an effort", async () => {
    const fetcher = answer(200, { max_input_tokens: 968000, takes_effort: false });
    const model = "langsmith:baseten/zai-org/GLM-5.3";
    expect(await fetchModelFacts("https://chess.test", "k", model, fetcher)).toEqual({
      kind: "known",
      maxInputTokens: 968000,
      takesEffort: false,
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://chess.test/ui/model?model=langsmith%3Abaseten%2Fzai-org%2FGLM-5.3",
      { headers: { "x-api-key": "k" } },
    );
  });

  it("reports a model the server knows no limit for", async () => {
    const none = answer(200, { max_input_tokens: null, takes_effort: true });
    expect(await fetchModelFacts("https://chess.test", "", "m", none)).toEqual({
      kind: "known",
      maxInputTokens: null,
      takesEffort: true,
    });
  });

  it("reports a failed request, a bad answer or no server as a failure, not as no limit", async () => {
    const url = "https://chess.test";
    const failed = { kind: "failed" };
    const facts = (body: unknown) => fetchModelFacts(url, "", "m", answer(200, body));
    expect(await fetchModelFacts(url, "", "m", answer(503, {}))).toEqual(failed);
    expect(await fetchModelFacts(url, "", "m", answer(401, {}))).toEqual(failed);
    expect(await facts(["nope"])).toEqual(failed);
    expect(await facts({ max_input_tokens: "1", takes_effort: true })).toEqual(failed);
    expect(await facts({ max_input_tokens: 1, takes_effort: "no" })).toEqual(failed);
    // A server from before the effort was reported.
    expect(await facts({ max_input_tokens: 1 })).toEqual(failed);
    const down = vi.fn(() => Promise.reject(new TypeError("Failed to fetch")));
    expect(await fetchModelFacts(url, "", "m", down)).toEqual(failed);
  });
});
