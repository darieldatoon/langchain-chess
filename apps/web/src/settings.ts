import {
  DEFAULT_CONTEXT,
  SETTING_KEYS,
  SETTINGS_VERSION,
  isRecord,
  isSetting,
  loadRecorded,
  migrateSettings,
  type ChessContext,
  type SettingKey,
} from "@langchain-chess/chess-ui";

export { isRecord };

type Check<T> = (value: unknown) => value is T;

export const oneOf =
  <T extends string>(...values: readonly T[]): Check<T> =>
  (value): value is T =>
    typeof value === "string" && (values as readonly string[]).includes(value);

/** Every setting's type and range, from the generated schema. */
export const CONTEXT_CHECKS = Object.fromEntries(
  SETTING_KEYS.map((key) => [key, (value: unknown) => isSetting(key, value)]),
) as { [K in SettingKey]: Check<ChessContext[K]> };

// `full` was removed; the dialog turns memory off for models that can't keep it.
const withoutFull = (raw: Record<string, unknown>) =>
  raw.memory === "full" ? { ...raw, memory: "summarize" } : raw;

/**
 * Stored settings, any subset, of this app's version or from before versions: only valid values
 * are kept, each on its own, so obsolete or corrupt storage can't reach a run.
 */
export function sanitizeContext(stored: unknown): ChessContext {
  const raw = withoutFull(isRecord(stored) ? stored : {});
  const migrate = (data: Record<string, unknown>) =>
    migrateSettings(data, { legacy: true, unknown: "drop" });
  let values: Record<string, unknown> = {};
  try {
    values = migrate(raw);
  } catch {
    // An unreadable older field costs only itself; a newer version can't be trusted at all.
    const { show_legal_moves: _, ...rest } = raw;
    try {
      values = migrate(rest);
    } catch {
      values = {};
    }
  }
  return SETTING_KEYS.reduce<ChessContext>(
    (context, key) => (isSetting(key, values[key]) ? { ...context, [key]: values[key] } : context),
    DEFAULT_CONTEXT,
  );
}

/**
 * A context exactly as a game recorded it, carried to this version, else null: a setting filled
 * in from the defaults would play a different game.
 */
export function recordedContext(stored: unknown): ChessContext | null {
  try {
    return loadRecorded(stored);
  } catch {
    return null;
  }
}

export const DEV_API_URL = "http://localhost:2024";

/** Same origin in production (served under /ui); `vp dev` talks to `langgraph dev` instead. */
export function apiUrl(
  env: { DEV?: boolean; VITE_API_URL?: string } = import.meta.env as {
    DEV?: boolean;
    VITE_API_URL?: string;
  },
): string {
  if (env.VITE_API_URL) return env.VITE_API_URL;
  return env.DEV ? DEV_API_URL : window.location.origin;
}

/** `configurable` for a run: exactly the server's `ChessContext` keys, `version` included. */
export function configurableOf(context: ChessContext): Record<string, unknown> {
  return {
    version: SETTINGS_VERSION,
    ...Object.fromEntries(SETTING_KEYS.map((key) => [key, context[key]])),
  };
}

/** Select reports `undefined` on deselect; keep the previous value in that case. */
export function withKnob<T, K extends keyof T>(values: T, key: K, value: T[K] | undefined): T {
  return value === undefined ? values : { ...values, [key]: value };
}
