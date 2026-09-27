import { describe, expect, it, vi } from "vite-plus/test";
import { followSystemTheme } from "../src/theme";

function fakeWindow(matches: boolean) {
  const listeners: (() => void)[] = [];
  const query = {
    matches,
    addEventListener: vi.fn((_: string, fn: () => void) => listeners.push(fn)),
  };
  return { win: { matchMedia: () => query } as unknown as Window, query, listeners };
}

describe("followSystemTheme", () => {
  it("applies the system theme and follows changes", () => {
    const html = document.createElement("html");
    const { win, query, listeners } = fakeWindow(true);
    followSystemTheme(win, html);
    expect(html.classList.contains("dark")).toBe(true);

    query.matches = false;
    listeners[0]();
    expect(html.classList.contains("dark")).toBe(false);
  });
});
