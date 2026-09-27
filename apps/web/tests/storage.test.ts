import { describe, expect, it, vi } from "vite-plus/test";
import { DEFAULT_SETUP, type Setup } from "../src/setup";
import {
  APP_KEY,
  browserStorage,
  DEFAULT_APP_SETTINGS,
  loadAppSettings,
  loadPlyView,
  loadSetup,
  saveAppSettings,
  savePlyView,
  saveSetup,
  SETUP_KEY,
  VIEW_KEY,
} from "../src/storage";

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

  it("never crashes on corrupt entries", () => {
    store(SETUP_KEY, "[1]");
    expect(loadSetup()).toEqual(DEFAULT_SETUP);
    store(SETUP_KEY, "{not json");
    expect(loadSetup()).toEqual(DEFAULT_SETUP);
  });
});

describe("app settings storage", () => {
  it("keeps the key under its own entry", () => {
    expect(loadAppSettings()).toEqual(DEFAULT_APP_SETTINGS);
    saveAppSettings({ apiKey: "" });
    expect(window.localStorage.getItem(APP_KEY)).toBe('{"apiKey":""}');
    expect(loadAppSettings()).toEqual({ apiKey: "" });
    store(APP_KEY, { apiKey: 3 });
    expect(loadAppSettings()).toEqual(DEFAULT_APP_SETTINGS);
    store(APP_KEY, "null");
    expect(loadAppSettings()).toEqual(DEFAULT_APP_SETTINGS);
  });
});

describe("unavailable storage", () => {
  it("reads defaults and reports every write as lost where the browser blocks storage", () => {
    const blocked = vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    });
    try {
      expect(browserStorage()).toBeNull();
      expect(loadSetup()).toEqual(DEFAULT_SETUP);
      expect(loadAppSettings()).toEqual(DEFAULT_APP_SETTINGS);
      expect(saveSetup(DEFAULT_SETUP)).toBe(false);
      expect(saveAppSettings({ apiKey: "k" })).toBe(false);
    } finally {
      blocked.mockRestore();
    }
  });

  it("reads defaults where storage is handed over but every call on it throws", () => {
    const insecure = () => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    };
    const read = vi.spyOn(Storage.prototype, "getItem").mockImplementation(insecure);
    try {
      expect(browserStorage()).toBeNull();
    } finally {
      read.mockRestore();
    }
    const broken = { getItem: insecure, setItem: insecure } as unknown as Storage;
    expect(loadSetup(broken)).toEqual(DEFAULT_SETUP);
    expect(loadAppSettings(broken)).toEqual(DEFAULT_APP_SETTINGS);
  });

  it("reports a write that doesn't fit", () => {
    const full = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      },
    } as unknown as Storage;
    expect(saveSetup(DEFAULT_SETUP, full)).toBe(false);
    expect(saveSetup(DEFAULT_SETUP)).toBe(true);
  });
});

describe("ply view storage", () => {
  it("defaults, round-trips, and resets each corrupt toggle on its own", () => {
    expect(loadPlyView()).toEqual({ reasoning: true, topMoves: true });
    expect(savePlyView({ reasoning: false, topMoves: true })).toBe(true);
    expect(loadPlyView()).toEqual({ reasoning: false, topMoves: true });
    store(VIEW_KEY, { reasoning: "no", topMoves: false });
    expect(loadPlyView()).toEqual({ reasoning: true, topMoves: false });
    store(VIEW_KEY, "{not json");
    expect(loadPlyView()).toEqual({ reasoning: true, topMoves: true });
  });
});
