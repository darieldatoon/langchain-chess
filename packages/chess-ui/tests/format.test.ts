import { describe, expect, it } from "vite-plus/test";
import {
  costText,
  isAtBottom,
  lastMoveStyles,
  money,
  outcomeLine,
  pairs,
  percent,
  seconds,
  sourceClass,
  sourceLabel,
  type MoveEntry,
} from "../src/format";
import { AFTER_E4 } from "../src/testing";
import { START_FEN } from "../src/types";

const entry = (ply: number, san: string, source = "external"): MoveEntry => ({ ply, san, source });

describe("cost formatting", () => {
  it("shows a dash when unpriced, marks incomplete totals, and prints complete ones plainly", () => {
    expect(costText(null)).toEqual({ text: "—", incomplete: false });
    expect(costText({ usd: 0.245, complete: true })).toEqual({ text: "$0.245", incomplete: false });
    expect(costText({ usd: 0.00006, complete: false })).toEqual({
      text: "$0.0001+",
      incomplete: true,
    });
    expect(money(0.00006)).toBe("$0.0001");
  });
});

describe("labels", () => {
  it("formats time, percentages, and sources", () => {
    expect(seconds(240)).toBe("240 ms");
    expect(seconds(8200)).toBe("8.2 s");
    expect(percent(0.456)).toBe("46%");
    expect(sourceLabel("external")).toBe("Human");
    expect(sourceLabel("llm")).toBe("LLM chose");
    expect(sourceLabel("systemone")).toBe("System 1 played");
    expect(sourceLabel("forced")).toBe("Forced move");
    expect(sourceLabel("book")).toBe("book");
    expect(["external", "llm", "systemone", "forced", "book"].map(sourceClass)).toEqual([
      "external",
      "llm",
      "systemone",
      "forced",
      "other",
    ]);
  });
});

describe("pairs", () => {
  it("numbers rows from a white-to-move root", () => {
    expect(pairs([], START_FEN)).toEqual([]);
    const rows = pairs([entry(0, "e4"), entry(1, "e5"), entry(2, "Nf3")], START_FEN);
    expect(rows.map(([n, w, b]) => [n, w?.san, b?.san])).toEqual([
      [1, "e4", "e5"],
      [2, "Nf3", undefined],
    ]);
  });

  it("starts a black-to-move root on the black slot at its fullmove number", () => {
    const root = AFTER_E4.replace(" 0 1", " 0 7");
    const rows = pairs([entry(0, "e5"), entry(1, "Nf3")], root);
    expect(rows.map(([n, w, b]) => [n, w?.san, b?.san])).toEqual([
      [7, undefined, "e5"],
      [8, "Nf3", undefined],
    ]);
  });
});

describe("outcomeLine", () => {
  it("describes every outcome", () => {
    expect(outcomeLine({ kind: "checkmate", winner: "white" })).toBe("Checkmate, White wins. 1-0");
    expect(outcomeLine({ kind: "checkmate", winner: "black" })).toBe("Checkmate, Black wins. 0-1");
    expect(outcomeLine({ kind: "draw", reason: "threefold" })).toBe(
      "Draw by threefold repetition. 1/2-1/2",
    );
    expect(outcomeLine({ kind: "resignation", winner: "white", reason: "illegal_moves" })).toBe(
      "Black resigns after repeated illegal moves. 1-0",
    );
    expect(outcomeLine({ kind: "resignation", winner: "black", reason: "illegal_moves" })).toBe(
      "White resigns after repeated illegal moves. 0-1",
    );
  });
});

describe("ui helpers", () => {
  it("highlights the last move squares", () => {
    expect(lastMoveStyles(null)).toEqual({});
    expect(lastMoveStyles("e2")).toEqual({});
    expect(Object.keys(lastMoveStyles("e2e4"))).toEqual(["e2", "e4"]);
  });

  it("detects the bottom within tolerance", () => {
    expect(isAtBottom({ scrollTop: 92, scrollHeight: 200, clientHeight: 100 })).toBe(true);
    expect(isAtBottom({ scrollTop: 40, scrollHeight: 200, clientHeight: 100 })).toBe(false);
  });
});
