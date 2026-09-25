import { describe, expect, it } from "vite-plus/test";
import { apiUrl, configurableOf, DEV_API_URL, sanitizeContext, withKnob } from "../src/settings";
import { DEFAULT_CONTEXT } from "../src/types";

describe("sanitizeContext", () => {
  it("validates every knob's type and range", () => {
    const bad = {
      policy: "random",
      model: "  ",
      reasoning_effort: "max",
      show_legal_moves: "yes",
      memory: "forever",
      systemone_model: "jev-latest",
      style: 1,
      with_eval: 1,
      with_nouls: null,
      gate: "vibes",
      threshold: 1.5,
      tournament_threshold: -0.1,
      k: 0,
      top_p: 0,
      draw_claims: "always",
      seed: 1.5,
      summary_trigger_tokens: 0,
    };
    expect(sanitizeContext(bad)).toEqual(DEFAULT_CONTEXT);
    expect(sanitizeContext({ k: 256, threshold: Number.NaN, top_p: 1.2 })).toEqual(DEFAULT_CONTEXT);
    expect(sanitizeContext("nope")).toEqual(DEFAULT_CONTEXT);
  });

  it("keeps valid values, including nulls for nullable knobs", () => {
    const good = {
      ...DEFAULT_CONTEXT,
      policy: "systemone",
      systemone_model: "typesafe/jev-latest",
      show_legal_moves: false,
      tournament_threshold: 0.7,
      k: 255,
      top_p: 1,
      draw_claims: "never",
      seed: -3,
      summary_trigger_tokens: 50000,
    };
    expect(sanitizeContext(good)).toEqual(good);
    expect(sanitizeContext({ ...good, tournament_threshold: null, top_p: null })).toEqual({
      ...good,
      tournament_threshold: null,
      top_p: null,
    });
  });
});

describe("apiUrl", () => {
  it("prefers VITE_API_URL, then the dev server in dev, then the page origin", () => {
    expect(apiUrl({ VITE_API_URL: "http://localhost:2027" })).toBe("http://localhost:2027");
    expect(apiUrl({ DEV: true })).toBe(DEV_API_URL);
    expect(apiUrl({ DEV: false })).toBe(window.location.origin);
    expect(typeof apiUrl()).toBe("string");
  });
});

describe("configurableOf and withKnob", () => {
  it("sends exactly the ChessContext keys", () => {
    expect(configurableOf(DEFAULT_CONTEXT)).toEqual(DEFAULT_CONTEXT);
    expect(configurableOf(DEFAULT_CONTEXT)).not.toBe(DEFAULT_CONTEXT);
    const extra = { ...DEFAULT_CONTEXT, human_side: "black" } as typeof DEFAULT_CONTEXT;
    expect(configurableOf(extra)).not.toHaveProperty("human_side");
  });

  it("keeps the context when the value is undefined", () => {
    expect(withKnob(DEFAULT_CONTEXT, "policy", undefined)).toBe(DEFAULT_CONTEXT);
    expect(withKnob(DEFAULT_CONTEXT, "policy", "llm").policy).toBe("llm");
    expect(withKnob(DEFAULT_CONTEXT, "top_p", null).top_p).toBeNull();
  });
});
