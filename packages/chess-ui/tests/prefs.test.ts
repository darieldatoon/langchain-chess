import { describe, expect, it } from "vite-plus/test";
import { sanitizeTurnView } from "../src/prefs";
import { DEFAULT_TURN_VIEW } from "../src/types";

describe("sanitizeTurnView", () => {
  it("defaults anything that isn't a stored view", () => {
    for (const stored of [undefined, null, "x", [], { open: "x", show: 3 }]) {
      expect(sanitizeTurnView(stored)).toEqual(DEFAULT_TURN_VIEW);
    }
  });

  it("keeps each valid field and defaults each bad one on its own", () => {
    const view = sanitizeTurnView({
      open: { systemOne: false, llm: "no" },
      show: { tokens: true, gate: false, analysis: 1 },
    });
    expect(view.open).toEqual({ systemOne: false, llm: true });
    expect(view.show).toEqual({ ...DEFAULT_TURN_VIEW.show, tokens: true, gate: false });
  });

  it("migrates the older reply view, which a newer field wins over", () => {
    expect(sanitizeTurnView({ reasoning: false, topMoves: false }).show).toMatchObject({
      analysis: false,
      topMoves: false,
    });
    expect(sanitizeTurnView({ reasoning: false, show: { analysis: true } }).show.analysis).toBe(
      true,
    );
  });
});
