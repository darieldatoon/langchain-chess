import { describe, expect, it } from "vite-plus/test";
import { DEFAULT_SETUP, type Setup } from "./setup";
import {
  APP_KEY,
  DEFAULT_APP_SETTINGS,
  JEV_SETTINGS_KEY,
  LEGACY_SETTINGS_KEY,
  loadAppSettings,
  loadGame,
  loadSetup,
  saveAppSettings,
  saveGame,
  saveSetup,
  SETUP_KEY,
} from "./storage";
import { DEFAULT_CONTEXT } from "./types";

const store = (key: string, value: unknown) =>
  window.localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));

describe("setup storage", () => {
  it("defaults, then round-trips the last setup", () => {
    expect(loadSetup()).toEqual(DEFAULT_SETUP);
    const setup: Setup = {
      ...DEFAULT_SETUP,
      side: "random",
      llm: "custom",
      customModel: "openai:gpt-5.6-sol",
    };
    saveSetup(setup);
    expect(window.localStorage.getItem(SETUP_KEY)).toContain('"side":"random"');
    expect(loadSetup()).toEqual(setup);
  });

  it("migrates the old global settings, preferring the newer key", () => {
    store(JEV_SETTINGS_KEY, {
      apiKey: "old",
      context: { policy: "jev", human_side: "black", model: "gpt-5.6-sol", k: 3 },
    });
    expect(loadSetup()).toEqual({
      ...DEFAULT_SETUP,
      llm: "gpt-5.6-sol",
      knobs: { ...DEFAULT_SETUP.knobs, k: 3 },
    });
    store(LEGACY_SETTINGS_KEY, { context: { policy: "systemone", model: "my-model" } });
    expect(loadSetup()).toMatchObject({ llm: "none", customModel: "my-model" });
    store(SETUP_KEY, { side: "black" });
    expect(loadSetup()).toEqual({ ...DEFAULT_SETUP, side: "black" });
  });

  it("never crashes on corrupt entries", () => {
    store(LEGACY_SETTINGS_KEY, "{not json");
    expect(loadSetup()).toEqual(DEFAULT_SETUP);
    store(LEGACY_SETTINGS_KEY, "[1]");
    expect(loadSetup()).toEqual(DEFAULT_SETUP);
    store(SETUP_KEY, "{not json");
    expect(loadSetup()).toEqual(DEFAULT_SETUP);
  });
});

describe("app settings storage", () => {
  it("keeps the key under its own entry, migrating it from the old settings once", () => {
    expect(loadAppSettings()).toEqual(DEFAULT_APP_SETTINGS);
    store(LEGACY_SETTINGS_KEY, { apiKey: "lsv2_old", context: {} });
    expect(loadAppSettings()).toEqual({ apiKey: "lsv2_old" });
    saveAppSettings({ apiKey: "" });
    expect(window.localStorage.getItem(APP_KEY)).toBe('{"apiKey":""}');
    expect(loadAppSettings()).toEqual({ apiKey: "" });
    store(APP_KEY, { apiKey: 3 });
    expect(loadAppSettings()).toEqual(DEFAULT_APP_SETTINGS);
    store(APP_KEY, "null");
    expect(loadAppSettings()).toEqual(DEFAULT_APP_SETTINGS);
  });
});

describe("game storage", () => {
  it("pins a side and context per thread", () => {
    const context = { ...DEFAULT_CONTEXT, policy: "llm" as const, threshold: 0.3 };
    saveGame("t-1", { side: "black", context });
    expect(loadGame("t-1")).toEqual({ side: "black", context });
    expect(loadGame("t-2")).toEqual({ side: "white", context: DEFAULT_CONTEXT });
  });

  it("reads the side of a thread from before games pinned their context", () => {
    store("langchain-chess:side:old", "black");
    expect(loadGame("old")).toEqual({ side: "black", context: DEFAULT_CONTEXT });
    store("langchain-chess:side:odd", "purple");
    expect(loadGame("odd").side).toBe("white");
  });
});
