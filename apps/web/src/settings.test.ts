import { describe, expect, it } from "vite-plus/test";
import {
  apiUrl,
  configurableOf,
  DEFAULT_SETTINGS,
  DEV_API_URL,
  loadSettings,
  saveSettings,
  withKnob,
} from "./settings";
import { DEFAULT_CONTEXT } from "./types";

describe("settings storage", () => {
  it("returns defaults when nothing is stored", () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("round-trips and fills missing context keys", () => {
    saveSettings({ apiKey: "k", context: { ...DEFAULT_CONTEXT, threshold: 0.5 } });
    const loaded = loadSettings();
    expect(loaded.apiKey).toBe("k");
    expect(loaded.context.threshold).toBe(0.5);
    expect(loaded.context.k).toBe(5);
  });

  it("tolerates partial or corrupt values", () => {
    window.localStorage.setItem("jev-chess:settings", JSON.stringify({ apiKey: 3 }));
    expect(loadSettings()).toEqual({ apiKey: "", context: DEFAULT_CONTEXT });
    window.localStorage.setItem("jev-chess:settings", "{not json");
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
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
  it("copies every context key", () => {
    expect(configurableOf(DEFAULT_CONTEXT)).toEqual(DEFAULT_CONTEXT);
    expect(configurableOf(DEFAULT_CONTEXT)).not.toBe(DEFAULT_CONTEXT);
  });

  it("keeps the context when the value is undefined", () => {
    expect(withKnob(DEFAULT_CONTEXT, "policy", undefined)).toBe(DEFAULT_CONTEXT);
    expect(withKnob(DEFAULT_CONTEXT, "policy", "jev").policy).toBe("jev");
  });
});
