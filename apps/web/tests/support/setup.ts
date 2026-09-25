import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeAll, vi } from "vite-plus/test";

// jsdom lacks the layout and media APIs Radix and Macaw's theme provider touch.
function polyfill(target: object, name: string, value: unknown) {
  if (typeof (target as Record<string, unknown>)[name] !== "function") {
    Object.defineProperty(target, name, { value, configurable: true, writable: true });
  }
}

beforeAll(() => {
  polyfill(window, "matchMedia", (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
  polyfill(Element.prototype, "scrollIntoView", () => {});
  polyfill(Element.prototype, "hasPointerCapture", () => false);
  polyfill(Element.prototype, "releasePointerCapture", () => {});
  polyfill(
    globalThis,
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});
