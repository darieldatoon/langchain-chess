import { describe, expect, it } from "vite-plus/test";
import raw from "../../../libs/systemone/tests/fixtures/settings-cases.json?raw";
import {
  checkSetting,
  DEFAULT_CONTEXT,
  fromLegacy,
  keysOf,
  LEGACY_KEYS,
  loadRecorded,
  loadSettings,
  migrateSettings,
  resolveSettings,
  SETTING_KEYS,
  SETTINGS_VERSION,
  SettingsError,
  VERSION_DEFAULTS,
} from "../src";

interface Case {
  name: string;
  input: unknown;
  output?: Record<string, unknown>;
  error?: boolean;
}

const cases = JSON.parse(raw) as {
  files: Case[];
  recorded: Case[];
  values: Record<string, { valid: unknown[]; invalid: unknown[] }>;
};

function expectCase(load: (data: unknown) => unknown, { input, output, error }: Case) {
  if (error) expect(() => load(input)).toThrow(SettingsError);
  else expect(load(input)).toEqual({ ...DEFAULT_CONTEXT, ...output });
}

describe("the cases the Python tests share", () => {
  it.each(cases.files.map((c) => [c.name, c] as const))("settings file: %s", (_, c) =>
    expectCase(loadSettings, c),
  );

  it.each(cases.recorded.map((c) => [c.name, c] as const))("recorded: %s", (_, c) =>
    expectCase(loadRecorded, c),
  );

  const values = Object.entries(cases.values).flatMap(([key, { valid, invalid }]) => [
    ...valid.map((value) => [key, value, true] as const),
    ...invalid.map((value) => [key, value, false] as const),
  ]);

  it.each(values)("%s = %j is valid: %s", (key, value, valid) => {
    const recorded = { ...DEFAULT_CONTEXT, [key]: value };
    if (valid) expect(loadRecorded(recorded)).toEqual(recorded);
    else expect(() => loadRecorded(recorded)).toThrow("invalid settings: " + key);
  });

  it("cover every setting", () => {
    expect(Object.keys(cases.values).toSorted()).toEqual(SETTING_KEYS.toSorted());
  });
});

describe("versions", () => {
  it("freezes the current version as the defaults", () => {
    expect(VERSION_DEFAULTS[SETTINGS_VERSION]).toEqual(DEFAULT_CONTEXT);
    expect(keysOf(0)).toBe(LEGACY_KEYS);
    expect(keysOf(SETTINGS_VERSION)).toEqual(SETTING_KEYS);
  });

  it("migrates only the keys a source set", () => {
    expect(migrateSettings({ memory: "summarize" }, { legacy: true })).toEqual({ memory: true });
    expect(migrateSettings({ version: 1, k: 3, thread_id: "t" }, { unknown: "drop" })).toEqual({
      k: 3,
    });
    expect(() => migrateSettings({ version: 1, thread_id: "t" })).toThrow(
      "unknown settings for version 1: thread_id",
    );
    expect(() => migrateSettings({ k: 3 })).toThrow("settings need a `version`");
    expect(() => migrateSettings({ version: 9 })).toThrow("newer than this app's");
  });

  it("converts settings from before versions", () => {
    expect(fromLegacy({ memory: "none", show_legal_moves: null })).toEqual({ memory: false });
    expect(fromLegacy({ memory: true, show_legal_moves: true })).toEqual({
      memory: true,
      move_list: "both",
    });
    expect(fromLegacy({ memory: "full" })).toEqual({ memory: "full" });
    expect(() => fromLegacy({ show_legal_moves: true, move_list: "none" })).toThrow("not both");
    expect(() => fromLegacy({ show_legal_moves: "yes" })).toThrow("true or false");
  });

  it("lets later sources win, and a null reset", () => {
    const settings = resolveSettings({ k: 3, top_p: 0.5, threshold: 0.4 }, { k: 4, top_p: null });
    expect([settings.k, settings.top_p, settings.threshold]).toEqual([4, null, 0.4]);
    expect(resolveSettings({ threshold: 0.4 }, { threshold: null }).threshold).toBe(0.9);
    expect(() => resolveSettings({ k: 0 })).toThrow("invalid settings: k");
  });
});

describe("checkSetting", () => {
  it("rejects what JSON can't hold", () => {
    const threshold = { ...DEFAULT_CONTEXT, threshold: Number.NaN };
    expect(() => loadRecorded(threshold)).toThrow("invalid settings: threshold");
    expect(checkSetting({ type: "boolean", nullable: true }, null)).toBe(true);
  });
});
