import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { monotonic } from "../src/useClock";

afterEach(() => vi.restoreAllMocks());

describe("monotonic", () => {
  it("reads the page's monotonic clock, which a changed wall clock can't move", () => {
    vi.spyOn(performance, "now").mockReturnValue(1234.5);
    expect(monotonic()).toBe(1234.5);
  });
});
