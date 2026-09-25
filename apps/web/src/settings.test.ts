import { describe, expect, it } from "vite-plus/test";
import {
  apiUrl,
  configurableOf,
  DEFAULT_SETTINGS,
  DEV_API_URL,
  LEGACY_KEY,
  loadSettings,
  loadSide,
  sanitizeContext,
  saveSettings,
  saveSide,
  withKnob,
} from "./settings";
import { DEFAULT_CONTEXT } from "./types";

const KEY = "langchain-chess:settings";

describe("settings storage", () => {
  it("returns defaults when nothing is stored", () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("round-trips under the new key", () => {
    saveSettings({ apiKey: "k", context: { ...DEFAULT_CONTEXT, threshold: 0.5, top_p: 0.8 } });
    expect(window.localStorage.getItem(KEY)).toContain('"threshold":0.5');
    const loaded = loadSettings();
    expect(loaded.apiKey).toBe("k");
    expect(loaded.context).toEqual({ ...DEFAULT_CONTEXT, threshold: 0.5, top_p: 0.8 });
  });

  it("migrates the jev-chess settings: drops obsolete keys and replaces invalid values", () => {
    window.localStorage.setItem(
      LEGACY_KEY,
      JSON.stringify({
        apiKey: "lsv2_old",
        context: {
          policy: "jev",
          human_side: "black",
          max_plies: 200,
          jev_model: "jev-latest",
          include_legal_moves: false,
          model: "gpt-5.6-sol",
          reasoning_effort: "high",
          style: "terse",
          k: 3,
          top_p: null,
          gate: "confidence",
          threshold: 0.4,
        },
      }),
    );
    const { apiKey, context } = loadSettings();
    expect(apiKey).toBe("lsv2_old");
    expect(context).toEqual({
      ...DEFAULT_CONTEXT,
      model: "gpt-5.6-sol",
      reasoning_effort: "high",
      style: "terse",
      k: 3,
      gate: "confidence",
      threshold: 0.4,
    });
    expect(Object.keys(context).sort()).toEqual(Object.keys(DEFAULT_CONTEXT).sort());
  });

  it("prefers the new key over the legacy one", () => {
    window.localStorage.setItem(LEGACY_KEY, JSON.stringify({ apiKey: "old" }));
    window.localStorage.setItem(KEY, JSON.stringify({ apiKey: "new" }));
    expect(loadSettings().apiKey).toBe("new");
  });

  it("tolerates partial or corrupt values", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ apiKey: 3 }));
    expect(loadSettings()).toEqual({ apiKey: "", context: DEFAULT_CONTEXT });
    window.localStorage.setItem(KEY, JSON.stringify([1, 2]));
    expect(loadSettings()).toEqual({ apiKey: "", context: DEFAULT_CONTEXT });
    window.localStorage.setItem(KEY, "null");
    expect(loadSettings()).toEqual({ apiKey: "", context: DEFAULT_CONTEXT });
    window.localStorage.setItem(KEY, "{not json");
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});

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

describe("side storage", () => {
  it("is per thread and defaults to white", () => {
    expect(loadSide(null)).toBe("white");
    expect(loadSide("abc")).toBe("white");
    saveSide("abc", "black");
    expect(loadSide("abc")).toBe("black");
    expect(window.localStorage.getItem("langchain-chess:side:abc")).toBe("black");
    expect(loadSide("other")).toBe("white");
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
