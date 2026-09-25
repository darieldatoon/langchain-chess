import { DEFAULT_CONTEXT, type ChessContext, type Side } from "./types";

export interface Settings {
  apiKey: string;
  context: ChessContext;
}

const KEY = "langchain-chess:settings";
/** Read only while KEY is absent: the jev-chess UI stored its settings here. */
export const LEGACY_KEY = "jev-chess:settings";
const SIDE_PREFIX = "langchain-chess:side:";

export const DEFAULT_SETTINGS: Settings = { apiKey: "", context: DEFAULT_CONTEXT };

type Check<T> = (value: unknown) => value is T;

const oneOf =
  <T extends string>(...values: readonly T[]): Check<T> =>
  (value): value is T =>
    typeof value === "string" && (values as readonly string[]).includes(value);

const isBool: Check<boolean> = (value) => typeof value === "boolean";

const isName: Check<string> = (value): value is string =>
  typeof value === "string" && value.trim() !== "";

const inRange =
  (min: number, max: number, { integer = false, minExclusive = false } = {}): Check<number> =>
  (value): value is number =>
    typeof value === "number" &&
    Number.isFinite(value) &&
    (!integer || Number.isInteger(value)) &&
    (minExclusive ? value > min : value >= min) &&
    value <= max;

const orNull =
  <T>(check: Check<T>): Check<T | null> =>
  (value): value is T | null =>
    value === null || check(value);

/** Every knob's type and range. Stored values that fail fall back to the default. */
export const CONTEXT_CHECKS: { [K in keyof ChessContext]: Check<ChessContext[K]> } = {
  policy: oneOf("llm", "systemone", "hybrid"),
  model: isName,
  reasoning_effort: oneOf("low", "medium", "high"),
  show_legal_moves: isBool,
  memory: oneOf("none", "full", "summarize"),
  systemone_model: oneOf("semif-qwen3.5-4b", "typesafe/jev-latest"),
  style: oneOf("rich", "terse"),
  with_eval: isBool,
  with_nouls: isBool,
  gate: oneOf("margin", "confidence"),
  threshold: inRange(0, 1),
  tournament_threshold: orNull(inRange(0, 1)),
  k: inRange(1, 255, { integer: true }),
  top_p: orNull(inRange(0, 1, { minExclusive: true })),
  draw_claims: oneOf("auto", "never"),
  seed: inRange(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, { integer: true }),
  summary_trigger_tokens: orNull(inRange(1, Number.MAX_SAFE_INTEGER, { integer: true })),
};

const CONTEXT_KEYS = Object.keys(DEFAULT_CONTEXT) as (keyof ChessContext)[];

function knob<K extends keyof ChessContext>(stored: Record<string, unknown>, key: K) {
  const value = stored[key];
  return CONTEXT_CHECKS[key](value) ? value : DEFAULT_CONTEXT[key];
}

/** Keeps only known knobs with valid values, so obsolete or corrupt storage can't reach a run. */
export function sanitizeContext(stored: unknown): ChessContext {
  const record = isRecord(stored) ? stored : {};
  return CONTEXT_KEYS.reduce<ChessContext>(
    (context, key) => ({ ...context, [key]: knob(record, key) }),
    DEFAULT_CONTEXT,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function loadSettings(storage: Storage = window.localStorage): Settings {
  const raw = storage.getItem(KEY) ?? storage.getItem(LEGACY_KEY);
  if (!raw) return DEFAULT_SETTINGS;
  try {
    const parsed: unknown = JSON.parse(raw);
    const record = isRecord(parsed) ? parsed : {};
    return {
      apiKey: typeof record.apiKey === "string" ? record.apiKey : "",
      context: sanitizeContext(record.context),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: Settings, storage: Storage = window.localStorage): void {
  storage.setItem(KEY, JSON.stringify(settings));
}

/** The human's side is adapter state, not graph state: one entry per thread. */
export function loadSide(threadId: string | null, storage: Storage = window.localStorage): Side {
  if (!threadId) return "white";
  return storage.getItem(SIDE_PREFIX + threadId) === "black" ? "black" : "white";
}

export function saveSide(
  threadId: string,
  side: Side,
  storage: Storage = window.localStorage,
): void {
  storage.setItem(SIDE_PREFIX + threadId, side);
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

/** `configurable` for a run: exactly the server's `ChessContext` fields, nothing else. */
export function configurableOf(context: ChessContext): Record<string, unknown> {
  return Object.fromEntries(CONTEXT_KEYS.map((key) => [key, context[key]]));
}

/** Select reports `undefined` on deselect; keep the previous value in that case. */
export function withKnob<K extends keyof ChessContext>(
  context: ChessContext,
  key: K,
  value: ChessContext[K] | undefined,
): ChessContext {
  return value === undefined ? context : { ...context, [key]: value };
}
