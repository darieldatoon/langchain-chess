import { describe, expect, it } from "vite-plus/test";
import {
  costText,
  isAtBottom,
  money,
  moveLabel,
  outcomeLine,
  pairs,
  qualitySymbol,
  percent,
  scoreText,
  seconds,
  sourceClass,
  sourceLabel,
  stripResult,
  type MoveEntry,
} from "../src/format";
import { AFTER_E4 } from "../src/testing";
import { START_FEN, type Outcome } from "../src/types";

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
  it("describes every outcome, without the score", () => {
    expect(outcomeLine({ kind: "checkmate", winner: "white" })).toBe("Checkmate · White wins");
    expect(outcomeLine({ kind: "checkmate", winner: "black" })).toBe("Checkmate · Black wins");
    expect(outcomeLine({ kind: "draw", reason: "threefold" })).toBe("Draw by threefold repetition");
    expect(outcomeLine({ kind: "resignation", winner: "white", reason: "illegal_moves" })).toBe(
      "Black forfeited after repeated illegal moves · White wins",
    );
    expect(outcomeLine({ kind: "resignation", winner: "black", reason: "illegal_moves" })).toBe(
      "White forfeited after repeated illegal moves · Black wins",
    );
    expect(outcomeLine({ kind: "resignation", winner: "white", reason: "resigned" })).toBe(
      "Black resigned · White wins",
    );
  });
});

describe("scoreText and stripResult", () => {
  it("scores the game and names each side's result in a word", () => {
    const mate: Outcome = { kind: "checkmate", winner: "black" };
    const forfeit: Outcome = { kind: "resignation", winner: "white", reason: "illegal_moves" };
    const draw: Outcome = { kind: "draw", reason: "stalemate" };
    expect([scoreText(mate), scoreText(forfeit), scoreText(draw)]).toEqual(["0-1", "1-0", "½-½"]);
    expect([stripResult(mate, "black"), stripResult(mate, "white")]).toEqual(["Won", "Checkmated"]);
    expect(stripResult(forfeit, "black")).toBe("Forfeited");
    const resigned: Outcome = { kind: "resignation", winner: "white", reason: "resigned" };
    expect(stripResult(resigned, "black")).toBe("Resigned");
    expect([stripResult(draw, "white"), stripResult(draw, "black")]).toEqual(["Draw", "Draw"]);
  });
});

describe("moveLabel", () => {
  it("numbers a move from the root, with an ellipsis for Black", () => {
    expect(moveLabel(START_FEN, 0, "e4")).toBe("1. e4");
    expect(moveLabel(START_FEN, 3, "Nc6")).toBe("2\u2026 Nc6");
    const black12 = "8/8/8/8/8/8/8/K1k5 b - - 0 12";
    expect(moveLabel(black12, 0, "Kc2")).toBe("12\u2026 Kc2");
    expect(moveLabel(black12, 1, "Ka2")).toBe("13. Ka2");
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
  it("detects the bottom within tolerance", () => {
    expect(isAtBottom({ scrollTop: 92, scrollHeight: 200, clientHeight: 100 })).toBe(true);
    expect(isAtBottom({ scrollTop: 40, scrollHeight: 200, clientHeight: 100 })).toBe(false);
  });
});
