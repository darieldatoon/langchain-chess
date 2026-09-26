import { describe, expect, it } from "vite-plus/test";
import { num, pct, points } from "../src/format";

describe("format", () => {
  it("formats shares as percentages", () => {
    expect(pct(0.2443)).toBe("24.4%");
    expect(pct(0.2443, 0)).toBe("24%");
    expect(pct(null)).toBe("–");
    expect(pct(undefined)).toBe("–");
  });

  it("formats numbers with separators and fixed decimals", () => {
    expect(num(1582.4)).toBe("1,582");
    expect(num(1.869, 2)).toBe("1.87");
    expect(num(null)).toBe("–");
  });

  it("gives the gap between two shares in points", () => {
    expect(points(0.244, 0.171)).toBe("7.3");
  });
});
