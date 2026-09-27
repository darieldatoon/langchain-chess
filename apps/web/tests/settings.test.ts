import { describe, expect, it } from "vite-plus/test";
import {
  apiUrl,
  configurableOf,
  DEV_API_URL,
  recordedContext,
  sanitizeContext,
  withKnob,
} from "../src/settings";
import { DEFAULT_CONTEXT } from "@langchain-chess/chess-ui";
import { legacyOf } from "@langchain-chess/chess-ui/testing";

describe("sanitizeContext", () => {
  it("reads the removed full memory as summarize and drops the removed trigger", () => {
    const legacy = legacyOf(DEFAULT_CONTEXT);
    const stored = { ...legacy, memory: "full", summary_trigger_tokens: 50000 };
    expect(sanitizeContext(stored)).toEqual({ ...DEFAULT_CONTEXT, memory: true });
    expect(sanitizeContext({ show_legal_moves: false })).toEqual({
      ...DEFAULT_CONTEXT,
      move_list: "candidates",
    });
  });

  it("validates every knob's type and range", () => {
    const bad = {
      version: 1,
      policy: "random",
      model: "",
      reasoning_effort: "max",
      move_list: "all",
      memory: "forever",
      systemone_model: "",
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
    };
    expect(sanitizeContext(bad)).toEqual(DEFAULT_CONTEXT);
    expect(sanitizeContext({ k: 256, threshold: Number.NaN, top_p: 1.2 })).toEqual(DEFAULT_CONTEXT);
    expect(sanitizeContext("nope")).toEqual(DEFAULT_CONTEXT);
  });

  it("trusts nothing in a newer version or an unreadable conversion", () => {
    expect(sanitizeContext({ version: 99, k: 3 })).toEqual(DEFAULT_CONTEXT);
    expect(sanitizeContext({ show_legal_moves: "yes", k: 3 })).toEqual({
      ...DEFAULT_CONTEXT,
      k: 3,
    });
  });

  it("keeps valid values, including nulls for nullable knobs and custom System 1 names", () => {
    const good = {
      ...DEFAULT_CONTEXT,
      policy: "systemone",
      systemone_model: "someone/ranker",
      move_list: "legal",
      tournament_threshold: 0.7,
      k: 255,
      top_p: 1,
      draw_claims: "never",
      seed: -3,
      memory: true,
    };
    expect(sanitizeContext(good)).toEqual(good);
    expect(sanitizeContext({ ...good, tournament_threshold: null, top_p: null })).toEqual({
      ...good,
      tournament_threshold: null,
      top_p: null,
    });
  });
});

describe("recordedContext", () => {
  it("takes a whole context of its version", () => {
    expect(recordedContext(DEFAULT_CONTEXT)).toEqual(DEFAULT_CONTEXT);
    const custom = { ...DEFAULT_CONTEXT, systemone_model: "other" };
    expect(recordedContext(custom)).toEqual(custom);
  });

  it("refuses a context with any knob missing, unknown or invalid, rather than guess", () => {
    const { model: _, ...noModel } = DEFAULT_CONTEXT;
    expect(recordedContext(noModel)).toBeNull();
    expect(recordedContext({ ...DEFAULT_CONTEXT, k: 0 })).toBeNull();
    expect(recordedContext({ ...DEFAULT_CONTEXT, newer_knob: 1 })).toBeNull();
    expect(recordedContext({})).toBeNull();
    expect(recordedContext(null)).toBeNull();
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
  it("sends exactly the ChessContext keys, version included", () => {
    expect(configurableOf(DEFAULT_CONTEXT)).toEqual(DEFAULT_CONTEXT);
    expect(configurableOf(DEFAULT_CONTEXT)).toHaveProperty("version", 2);
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
