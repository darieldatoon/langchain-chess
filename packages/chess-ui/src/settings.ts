// Mirrors libs/systemone/langchain_chess_systemone/settings.py: versions, migrations and loading.
// The types, checks and defaults are generated from it (./generated/settings.ts); the shared
// cases in libs/systemone/tests/fixtures/settings-cases.json hold both to the same answers.
import {
  DEFAULT_CONTEXT,
  LEGACY_KEYS,
  SETTING_SPECS,
  SETTINGS_VERSION,
  VERSION_DEFAULTS,
  type ChessContext,
  type SettingKey,
  type SettingSpec,
} from "./generated/settings";

export class SettingsError extends Error {
  override name = "SettingsError";
}

type Values = Record<string, unknown>;

export function isRecord(value: unknown): value is Values {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const SETTING_KEYS = Object.keys(SETTING_SPECS) as SettingKey[];

/** Whether `value` is a valid value of a setting with this spec. */
export function checkSetting(spec: SettingSpec, value: unknown): boolean {
  if (value === null) return spec.nullable;
  switch (spec.type) {
    case "enum":
      return typeof value === "string" && spec.values.includes(value);
    case "boolean":
      return typeof value === "boolean";
    case "string":
      return typeof value === "string" && value.length >= spec.minLength;
    case "number":
      return (
        typeof value === "number" &&
        Number.isFinite(value) &&
        (!spec.integer || Number.isInteger(value)) &&
        (spec.minimum === null || value >= spec.minimum) &&
        (spec.maximum === null || value <= spec.maximum) &&
        (spec.exclusiveMinimum === null || value > spec.exclusiveMinimum)
      );
  }
}

export function isSetting<K extends SettingKey>(key: K, value: unknown): value is ChessContext[K] {
  return checkSetting(SETTING_SPECS[key], value);
}

/** The keys of a version, `version` itself excluded. */
export function keysOf(version: number): readonly string[] {
  if (version === 0) return LEGACY_KEYS;
  return Object.keys(VERSION_DEFAULTS[version]).filter((key) => key !== "version");
}

/** 0 for settings without a version, when `legacy` allows them. */
export function versionOf(data: Values, legacy: boolean): number {
  if (!("version" in data)) {
    if (legacy) return 0;
    throw new SettingsError("settings need a `version`");
  }
  const version = data.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw new SettingsError(
      `\`version\` must be a positive integer, got ${JSON.stringify(version)}`,
    );
  }
  if (version > SETTINGS_VERSION) {
    throw new SettingsError(
      `settings version ${version} is newer than this app's (${SETTINGS_VERSION}); reload it`,
    );
  }
  return version;
}

const LEGACY_MEMORY: Record<string, boolean> = { none: false, summarize: true };

/** Settings from before versions to version 1. Both conversions keep what the model saw. */
export function fromLegacy(values: Values): Values {
  const { show_legal_moves: shown, ...rest } = values;
  const memory = rest.memory;
  if (typeof memory === "string" && memory in LEGACY_MEMORY) rest.memory = LEGACY_MEMORY[memory];
  if (!("show_legal_moves" in values)) return rest;
  if ("move_list" in rest) {
    throw new SettingsError("set move_list or the older show_legal_moves, not both");
  }
  if (shown === null) return rest;
  if (typeof shown !== "boolean") {
    throw new SettingsError(`show_legal_moves must be true or false, got ${JSON.stringify(shown)}`);
  }
  return { ...rest, move_list: shown ? "both" : "candidates" };
}

/** Version n's keys to version n + 1's. */
const MIGRATIONS: Record<number, (values: Values) => Values> = { 0: fromLegacy };

/** The keys partial settings set, carried to the current version, `version` excluded. */
export function migrateSettings(
  data: Values,
  { legacy = false, unknown = "error" }: { legacy?: boolean; unknown?: "error" | "drop" } = {},
): Values {
  const version = versionOf(data, legacy);
  const known = new Set(keysOf(version));
  const entries = Object.entries(data).filter(([key]) => key !== "version");
  const extra = entries.filter(([key]) => !known.has(key)).map(([key]) => key);
  if (extra.length > 0 && unknown === "error") {
    throw new SettingsError(
      `unknown settings for version ${version}: ${extra.toSorted().join(", ")}`,
    );
  }
  let values: Values = Object.fromEntries(entries.filter(([key]) => known.has(key)));
  for (let step = version; step < SETTINGS_VERSION; step += 1) values = MIGRATIONS[step](values);
  return values;
}

/** Every setting checked, or a SettingsError naming the ones that fail. */
function validated(values: Values): ChessContext {
  const bad = SETTING_KEYS.filter((key) => !isSetting(key, values[key]));
  if (bad.length > 0) throw new SettingsError(`invalid settings: ${bad.join(", ")}`);
  return { ...(values as unknown as ChessContext), version: SETTINGS_VERSION };
}

/**
 * Migrated partial settings over the defaults, later sources winning. An explicit null resets a
 * key to its default: every nullable setting defaults to null.
 */
export function resolveSettings(...sources: Values[]): ChessContext {
  const merged = Object.assign({}, ...sources) as Values;
  const given = Object.fromEntries(Object.entries(merged).filter(([, value]) => value !== null));
  return validated({ ...DEFAULT_CONTEXT, ...given });
}

/** A settings file: `version` required, any other key optional, unknown keys an error. */
export function loadSettings(data: unknown): ChessContext {
  if (!isRecord(data)) throw new SettingsError("settings must be a JSON object");
  return resolveSettings(migrateSettings(data));
}

/**
 * Settings a game recorded: every key of its version, or it's damaged. A game recorded before
 * versions has none and every legacy key.
 */
export function loadRecorded(data: unknown): ChessContext {
  if (!isRecord(data)) throw new SettingsError("settings must be a JSON object");
  const expected = keysOf(versionOf(data, true));
  const given = Object.keys(data).filter((key) => key !== "version");
  if (given.length !== expected.length || !expected.every((key) => key in data)) {
    throw new SettingsError("recorded settings are damaged");
  }
  return validated(migrateSettings(data, { legacy: true }));
}
