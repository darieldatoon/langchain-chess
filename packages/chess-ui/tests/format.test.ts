import { describe, expect, it } from "vite-plus/test";
import {
  clockText,
  costText,
  isAtBottom,
  lastMoveStyles,
  money,
  outcomeLine,
  pairs,
  qualitySymbol,
  percent,
  seconds,
  sourceClass,
  sourceLabel,
  timeControlText,
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
    expect(outcomeLine({ kind: "timeout", winner: "black" })).toBe("White runs out of time. 0-1");
    expect(outcomeLine({ kind: "draw", reason: "timeout_vs_insufficient_material" })).toBe(
      "Draw by timeout vs insufficient material. 1/2-1/2",
    );
  });
});

describe("clocks", () => {
  it("shows mm:ss, tenths under ten seconds, rounded down and never below zero", () => {
    expect(clockText(3_600_000)).toBe("60:00");
    expect(clockText(900_000)).toBe("15:00");
    expect(clockText(65_999)).toBe("01:05");
    expect(clockText(10_000)).toBe("00:10");
    expect(clockText(9_999)).toBe("00:09.9");
    expect(clockText(50)).toBe("00:00.0");
    expect(clockText(-300)).toBe("00:00.0");
  });

  it("names a time control in minutes plus seconds", () => {
    expect(timeControlText({ base_ms: 900_000, increment_ms: 10_000 })).toBe("15+10");
  });
});

describe("qualitySymbol", () => {
  it("annotates only the moves that lost something", () => {
    expect(["best", "good", undefined].map((q) => qualitySymbol(q as never))).toEqual(["", "", ""]);
    expect(qualitySymbol("inaccuracy")).toBe("?!");
    expect(qualitySymbol("mistake")).toBe("?");
    expect(qualitySymbol("blunder")).toBe("??");
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
