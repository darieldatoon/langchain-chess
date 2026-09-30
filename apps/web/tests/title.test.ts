import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { pageTitle, useTurnAlert } from "../src/title";

describe("useTurnAlert", () => {
  afterEach(() => vi.restoreAllMocks());

  it("takes a fresh baseline after loading, so a restored turn isn't an arrival", () => {
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    const { result, rerender } = renderHook(({ turn, settled }) => useTurnAlert(turn, settled), {
      initialProps: { turn: false, settled: true },
    });
    rerender({ turn: false, settled: false });
    rerender({ turn: true, settled: true });
    expect(result.current).toBe(false);
    rerender({ turn: false, settled: true });
    rerender({ turn: true, settled: true });
    expect(result.current).toBe(true);
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current).toBe(false);
  });
});
describe("pageTitle", () => {
  it("puts game over first, then your turn, then the opening", () => {
    const none = { yourTurn: false, over: false, opening: null };
    expect(pageTitle(none)).toBe("LangChain Chess");
    expect(pageTitle({ ...none, yourTurn: true, over: true })).toBe("Game over · LangChain Chess");
    expect(pageTitle({ ...none, yourTurn: true, opening: "Sicilian Defense" })).toBe(
      "Your turn · LangChain Chess",
    );
    expect(pageTitle({ ...none, over: true, opening: "Sicilian Defense" })).toBe(
      "Game over · LangChain Chess",
    );
    expect(pageTitle({ ...none, opening: "Sicilian Defense" })).toBe(
      "Sicilian Defense · LangChain Chess",
    );
  });
});
