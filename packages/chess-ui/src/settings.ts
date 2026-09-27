// Mirrors libs/systemone/langchain_chess_systemone/settings.py: versions, migrations and loading.
// The types, checks and defaults are generated from it (./generated/settings.ts); the shared
// cases in libs/systemone/tests/fixtures/settings-cases.json hold both to the same answers.
import {
  DEFAULT_CONTEXT,
  LEGACY_KEYS,
  MODEL_KWARGS_RULES,
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

function isJson(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJson);
  return isRecord(value) && Object.values(value).every(isJson);
}

/** Whether `value` is a valid value of a setting with this spec. */
export function checkSetting(spec: SettingSpec, value: unknown): boolean {
  if (value === null) return spec.nullable;
  switch (spec.type) {
    case "object":
      return isRecord(value) && isJson(value);
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
  if (!checkSetting(SETTING_SPECS[key], value)) return false;
  return key !== "model_kwargs" || modelKwargsProblems(value as Values, "local").length === 0;
}

export type Surface = "local" | "server";

const RULES = MODEL_KWARGS_RULES;
const CONNECTION = new RegExp(RULES.connectionPattern);
const has = (names: readonly string[], name: string) => names.includes(name);

/** Why `model_kwargs` can't set `name`, or null. Mirrors model_arguments.py's `held_back`. */
export function heldBack(name: string, surface: Surface, inExtraBody = false): string | null {
  if (has(RULES.modelNames, name)) return "the model is the `model` setting";
  if (has(RULES.agentOwned, name)) return "the agent sends it";
  if (!inExtraBody && has(RULES.appOwned, name)) return "the app sets it";
  // Inside `extra_body` too: a proxy may honor a body's own key or base URL.
  if (!has(RULES.connectionExempt, name) && CONNECTION.test(name)) {
    return "credentials and connections come from the environment";
  }
  if (surface === "server" && has(RULES.accountResources, name)) {
    return "it reaches the deployment's own tools and resources";
  }
  if (surface === "server" && !inExtraBody && !has(RULES.serverAllowed, name)) {
    return "the server doesn't send it";
  }
  return null;
}

/** JSON with sorted keys: equal values compare equal whatever their key order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isRecord(value)) {
    const keys = Object.keys(value).toSorted();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function aliased(modelKwargs: Values, name: string): unknown {
  const [head, tail] = name.split(".");
  const value = modelKwargs[head];
  if (tail === undefined) return value;
  return isRecord(value) ? value[tail] : undefined;
}

/** The value the aliases share; undefined when none is set. */
function oneOf(modelKwargs: Values, names: readonly string[]): unknown {
  return names.map((name) => aliased(modelKwargs, name)).find((v) => v !== undefined && v !== null);
}

/** Everything wrong with `model_kwargs` on a surface. Mirrors model_arguments.py's `problems`. */
export function modelKwargsProblems(modelKwargs: Values, surface: Surface): string[] {
  const given = Object.fromEntries(Object.entries(modelKwargs).filter(([, v]) => v !== null));
  const found: string[] = [];
  for (const name of Object.keys(given)) {
    const why = heldBack(name, surface);
    if (why !== null) found.push(`\`${name}\`: ${why}`);
  }
  const extraBody = given.extra_body;
  if (extraBody !== undefined && !isRecord(extraBody)) found.push("`extra_body` must be an object");
  for (const name of isRecord(extraBody) ? Object.keys(extraBody) : []) {
    const why = heldBack(name, surface, true);
    if (why !== null) found.push(`\`extra_body.${name}\`: ${why}`);
  }
  if (given.reasoning !== undefined && !isRecord(given.reasoning)) {
    found.push("`reasoning` must be an object");
  }
  for (const names of [RULES.effortNames, RULES.maxTokensNames]) {
    const values = names
      .map((name) => aliased(given, name))
      .filter((v) => v !== undefined && v !== null)
      .map(canonical);
    if (values.some((v) => v !== values[0])) {
      found.push(`${names.map((n) => `\`${n}\``).join(", ")} disagree: set one of them`);
    }
  }
  const effort = oneOf(given, RULES.effortNames);
  if (effort !== undefined && !(typeof effort === "string" && effort !== "")) {
    found.push("the reasoning effort must be a non-empty string");
  }
  const limit = oneOf(given, RULES.maxTokensNames);
  if (
    limit !== undefined &&
    !(typeof limit === "number" && Number.isInteger(limit) && limit >= 1)
  ) {
    found.push("the output limit must be a positive integer");
  }
  return found;
}

/** The reasoning effort a game's requests carry: `model_kwargs` over the setting, and
 * `extra_body.reasoning` replacing the whole object. */
export function sentEffort(context: Pick<ChessContext, "model_kwargs" | "reasoning_effort">) {
  const kwargs = context.model_kwargs;
  const extraBody = kwargs.extra_body;
  if (isRecord(extraBody) && "reasoning" in extraBody) {
    const replaced = extraBody.reasoning;
    const effort = isRecord(replaced) ? replaced.effort : undefined;
    return typeof effort === "string" ? effort : null;
  }
  const effort = oneOf(kwargs, RULES.effortNames);
  return typeof effort === "string" ? effort : context.reasoning_effort;
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

/** Version 2 only adds keys. Their defaults play as version 1 did (see settings.py). */
function addsPromptAndModelOptions(values: Values, complete: boolean): Values {
  if (!complete) return values;
  const added = keysOf(2).filter((key) => !keysOf(1).includes(key));
  return { ...Object.fromEntries(added.map((key) => [key, VERSION_DEFAULTS[2][key]])), ...values };
}

/**
 * Version n's keys to version n + 1's. For partial settings (`complete` false) a step writes only
 * what it must: an added key's default would override a source merged under this one.
 */
const MIGRATIONS: Record<number, (values: Values, complete: boolean) => Values> = {
  0: (values) => fromLegacy(values),
  1: addsPromptAndModelOptions,
};

/** The keys partial settings set, carried to the current version, `version` excluded. */
export function migrateSettings(
  data: Values,
  {
    legacy = false,
    unknown = "error",
    complete = false,
  }: { legacy?: boolean; unknown?: "error" | "drop"; complete?: boolean } = {},
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
  for (let step = version; step < SETTINGS_VERSION; step += 1)
    values = MIGRATIONS[step](values, complete);
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
  return validated(migrateSettings(data, { legacy: true, complete: true }));
}
