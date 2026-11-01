// What sign-in keeps in the browser. Every reader tolerates missing or corrupt entries and
// blocked storage, like storage.ts.

type KeyValueStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

// sessionStorage only: the key leaves with the tab and is never baked into the bundle.
export const API_KEY_KEY = "langchain-chess:api-key";
// Where older versions kept the key, in localStorage.
export const LEGACY_APP_KEY = "langchain-chess:app";
export const LAST_ACCOUNT_KEY = "langchain-chess:last-account";

/** Who last signed in with LangSmith here, for the sign-in screen. Never a token. */
export interface Account {
  readonly email: string;
}

function attempt<T>(fallback: T, run: () => T): T {
  try {
    return run();
  } catch {
    return fallback;
  }
}

export function loadApiKey(store: KeyValueStore | null): string | null {
  return attempt(null, () => store?.getItem(API_KEY_KEY)?.trim() || null);
}

export function saveApiKey(store: KeyValueStore | null, apiKey: string): void {
  attempt(undefined, () => store?.setItem(API_KEY_KEY, apiKey.trim()));
}

export function clearApiKey(store: KeyValueStore | null): void {
  attempt(undefined, () => store?.removeItem(API_KEY_KEY));
}

/** A long-lived secret has no business in localStorage; it is not carried over. */
export function forgetLegacyApiKey(store: KeyValueStore | null): void {
  attempt(undefined, () => store?.removeItem(LEGACY_APP_KEY));
}

// localStorage, unlike the credentials: it only names the account, and should outlive the tab.
export function loadLastAccount(store: KeyValueStore | null): Account | null {
  return attempt(null, () => {
    const saved = JSON.parse(store?.getItem(LAST_ACCOUNT_KEY) ?? "null") as {
      email?: unknown;
    } | null;
    return typeof saved?.email === "string" && saved.email ? { email: saved.email } : null;
  });
}

export function saveLastAccount(store: KeyValueStore | null, account: Account): void {
  attempt(undefined, () => store?.setItem(LAST_ACCOUNT_KEY, JSON.stringify(account)));
}

export function forgetLastAccount(store: KeyValueStore | null): void {
  attempt(undefined, () => store?.removeItem(LAST_ACCOUNT_KEY));
}

/** Null where the browser blocks site data. */
export function tabStorage(): Storage | null {
  return attempt(null, () => window.sessionStorage);
}
