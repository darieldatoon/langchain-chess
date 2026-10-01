// localStorage for the four things the UI remembers; a game's own setup is in its thread. Every
// reader tolerates missing, old, or corrupt entries, and blocked storage; every writer reports
// whether it landed. The pure parsing lives in setup.ts and settings.ts.
import {
  sanitizeDisplayPrefs,
  sanitizeTurnView,
  type DisplayPrefs,
  type TurnView,
} from "@langchain-chess/chess-ui";
import { isRecord } from "./settings";
import { DEFAULT_SETUP, sanitizeSetup, storedSetup, type Setup } from "./setup";

export const SETUP_KEY = "langchain-chess:setup";
export const APP_KEY = "langchain-chess:app";
export const VIEW_KEY = "langchain-chess:view";
export const DISPLAY_KEY = "langchain-chess:display";

export interface AppSettings {
  apiKey: string;
}

export const DEFAULT_APP_SETTINGS: AppSettings = { apiKey: "" };

/**
 * Null where the browser blocks site data: there reading `localStorage` throws, or it hands
 * over a storage whose every call throws.
 */
export function browserStorage(): Storage | null {
  try {
    const storage = window.localStorage;
    storage.getItem(APP_KEY);
    return storage;
  } catch {
    return null;
  }
}

function read(storage: Storage | null, key: string): string | null {
  try {
    return storage ? storage.getItem(key) : null;
  } catch {
    return null;
  }
}

/** False when the write didn't land: storage is blocked or full. */
function write(storage: Storage | null, key: string, value: unknown): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function parse(raw: string | null): unknown {
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/** The last setup, else the defaults. */
export function loadSetup(storage = browserStorage()): Setup {
  const raw = read(storage, SETUP_KEY);
  return raw === null ? DEFAULT_SETUP : sanitizeSetup(parse(raw));
}

export function saveSetup(setup: Setup, storage = browserStorage()): boolean {
  return write(storage, SETUP_KEY, storedSetup(setup));
}

function appSettingsOf(stored: unknown): AppSettings {
  const apiKey = isRecord(stored) ? stored.apiKey : undefined;
  return { apiKey: typeof apiKey === "string" ? apiKey : "" };
}

export function loadAppSettings(storage = browserStorage()): AppSettings {
  return appSettingsOf(parse(read(storage, APP_KEY)));
}

export function saveAppSettings(settings: AppSettings, storage = browserStorage()): boolean {
  return write(storage, APP_KEY, settings);
}

/** Each field falls back to its default on its own; an older `PlyView` migrates. */
export function loadTurnView(storage = browserStorage()): TurnView {
  return sanitizeTurnView(parse(read(storage, VIEW_KEY)));
}

export function saveTurnView(view: TurnView, storage = browserStorage()): boolean {
  return write(storage, VIEW_KEY, view);
}

export function loadDisplayPrefs(storage = browserStorage()): DisplayPrefs {
  return sanitizeDisplayPrefs(parse(read(storage, DISPLAY_KEY)));
}

export function saveDisplayPrefs(prefs: DisplayPrefs, storage = browserStorage()): boolean {
  return write(storage, DISPLAY_KEY, prefs);
}
