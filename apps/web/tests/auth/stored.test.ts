import { describe, expect, it, vi } from "vite-plus/test";
import {
  API_KEY_KEY,
  clearApiKey,
  forgetLastAccount,
  forgetLegacyApiKey,
  LAST_ACCOUNT_KEY,
  LEGACY_APP_KEY,
  loadApiKey,
  loadLastAccount,
  saveApiKey,
  saveLastAccount,
  tabStorage,
} from "../../src/auth/stored";

const insecure = () => {
  throw new DOMException("The operation is insecure.", "SecurityError");
};
const broken = { getItem: insecure, setItem: insecure, removeItem: insecure } as unknown as Storage;

describe("the API key", () => {
  it("round-trips trimmed in the tab's storage, and clears", () => {
    expect(loadApiKey(sessionStorage)).toBeNull();
    saveApiKey(sessionStorage, " lsv2_k ");
    expect(sessionStorage.getItem(API_KEY_KEY)).toBe("lsv2_k");
    expect(loadApiKey(sessionStorage)).toBe("lsv2_k");
    clearApiKey(sessionStorage);
    expect(loadApiKey(sessionStorage)).toBeNull();
    sessionStorage.setItem(API_KEY_KEY, "  ");
    expect(loadApiKey(sessionStorage)).toBeNull();
    sessionStorage.clear();
  });

  it("drops the key older versions kept in localStorage, and nothing else", () => {
    localStorage.setItem(LEGACY_APP_KEY, '{"apiKey":"lsv2_old"}');
    localStorage.setItem("langchain-chess:setup", "{}");
    forgetLegacyApiKey(localStorage);
    expect(localStorage.getItem(LEGACY_APP_KEY)).toBeNull();
    expect(localStorage.getItem("langchain-chess:setup")).toBe("{}");
  });
});

describe("the last account", () => {
  it("round-trips the email only, and forgets it", () => {
    expect(loadLastAccount(localStorage)).toBeNull();
    saveLastAccount(localStorage, { email: "ada@example.com" });
    expect(loadLastAccount(localStorage)).toEqual({ email: "ada@example.com" });
    forgetLastAccount(localStorage);
    expect(localStorage.getItem(LAST_ACCOUNT_KEY)).toBeNull();
  });

  it.each(["{not json", "null", '{"email":""}', '{"email":3}', "[]"])(
    "ignores a corrupt entry: %s",
    (raw) => {
      localStorage.setItem(LAST_ACCOUNT_KEY, raw);
      expect(loadLastAccount(localStorage)).toBeNull();
    },
  );
});

describe("blocked storage", () => {
  it("reads nothing and writes nowhere, without throwing", () => {
    for (const store of [null, broken]) {
      expect(loadApiKey(store)).toBeNull();
      expect(loadLastAccount(store)).toBeNull();
      expect(() => {
        saveApiKey(store, "k");
        clearApiKey(store);
        forgetLegacyApiKey(store);
        saveLastAccount(store, { email: "a@b.c" });
        forgetLastAccount(store);
      }).not.toThrow();
    }
  });

  it("finds the tab's storage, or none where the browser blocks it", () => {
    expect(tabStorage()).toBe(window.sessionStorage);
    const blocked = vi.spyOn(window, "sessionStorage", "get").mockImplementation(insecure);
    try {
      expect(tabStorage()).toBeNull();
    } finally {
      blocked.mockRestore();
    }
  });
});
