// localStorage for the three things the UI remembers. Every reader tolerates missing, old, or
// corrupt entries; the pure parsing lives in setup.ts and settings.ts.
import { isRecord } from "./settings";
import {
  DEFAULT_SETUP,
  isSide,
  sanitizeGame,
  sanitizeSetup,
  setupFromContext,
  type GameRecord,
  type Setup,
} from "./setup";
import { DEFAULT_CONTEXT } from "./types";

export const SETUP_KEY = "langchain-chess:setup";
export const APP_KEY = "langchain-chess:app";
const GAME_PREFIX = "langchain-chess:game:";
/** Read only while the keys above are absent: one global settings blob held key and knobs. */
export const LEGACY_SETTINGS_KEY = "langchain-chess:settings";
/** Side-only game entries from before a game pinned its context. */
const LEGACY_SIDE_PREFIX = "langchain-chess:side:";

export interface AppSettings {
  apiKey: string;
}

export const DEFAULT_APP_SETTINGS: AppSettings = { apiKey: "" };

function parse(raw: string | null): unknown {
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function legacySettings(storage: Storage): Record<string, unknown> | null {
  const stored = parse(storage.getItem(LEGACY_SETTINGS_KEY));
  return isRecord(stored) ? stored : null;
}

/** The last setup, else one migrated from the old global settings, else the defaults. */
export function loadSetup(storage: Storage = window.localStorage): Setup {
  const raw = storage.getItem(SETUP_KEY);
  if (raw !== null) return sanitizeSetup(parse(raw));
  const legacy = legacySettings(storage);
  return legacy ? setupFromContext(legacy.context) : DEFAULT_SETUP;
}

export function saveSetup(setup: Setup, storage: Storage = window.localStorage): void {
  storage.setItem(SETUP_KEY, JSON.stringify(setup));
}

export function loadAppSettings(storage: Storage = window.localStorage): AppSettings {
  const raw = storage.getItem(APP_KEY);
  const stored = raw === null ? legacySettings(storage) : parse(raw);
  const apiKey = isRecord(stored) ? stored.apiKey : undefined;
  return { apiKey: typeof apiKey === "string" ? apiKey : "" };
}

export function saveAppSettings(settings: AppSettings, storage: Storage = window.localStorage) {
  storage.setItem(APP_KEY, JSON.stringify(settings));
}

/** A game's pinned side and context; threads from before pinning keep their side only. */
export function loadGame(threadId: string, storage: Storage = window.localStorage): GameRecord {
  const raw = storage.getItem(GAME_PREFIX + threadId);
  if (raw !== null) return sanitizeGame(parse(raw));
  const side = storage.getItem(LEGACY_SIDE_PREFIX + threadId);
  return { side: isSide(side) ? side : "white", context: DEFAULT_CONTEXT };
}

export function saveGame(
  threadId: string,
  game: GameRecord,
  storage: Storage = window.localStorage,
): void {
  storage.setItem(GAME_PREFIX + threadId, JSON.stringify(game));
}
