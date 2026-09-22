import { DEFAULT_CONTEXT, type PlayContext } from "./types";

export interface Settings {
  apiKey: string;
  context: PlayContext;
}

const KEY = "jev-chess:settings";

export const DEFAULT_SETTINGS: Settings = { apiKey: "", context: DEFAULT_CONTEXT };

export function loadSettings(storage: Storage = window.localStorage): Settings {
  const raw = storage.getItem(KEY);
  if (!raw) return DEFAULT_SETTINGS;
  try {
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : "",
      context: { ...DEFAULT_CONTEXT, ...(parsed.context ?? {}) },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: Settings, storage: Storage = window.localStorage): void {
  storage.setItem(KEY, JSON.stringify(settings));
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

/** `configurable` for a run: the graph factory reads exactly these keys. */
export function configurableOf(context: PlayContext): Record<string, unknown> {
  return { ...context };
}
