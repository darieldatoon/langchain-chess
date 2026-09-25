import { describe, expect, it } from "vite-plus/test";
import {
  costText,
  describeError,
  isBusyRejection,
  isAtBottom,
  lastMoveStyles,
  money,
  outcomeLine,
  pairs,
  parseKnob,
  parseNullableKnob,
  percent,
  seconds,
  sliderValue,
  sourceClass,
  sourceLabel,
  standingLine,
  statusLine,
  type MoveEntry,
} from "./format";
import { CONTEXT_CHECKS } from "./settings";
import { AFTER_E4 } from "./test/fixtures";
import { START_FEN, type Side } from "./types";

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

describe("status", () => {
  const base = {
    outcome: null,
    fen: START_FEN,
    moveCount: 0,
    humanSide: "white" as Side,
    pending: false,
  };

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
    const draw = { kind: "draw", reason: "stalemate" } as const;
    expect(statusLine({ ...base, outcome: draw })).toBe("Draw by stalemate. 1/2-1/2");
  });

  it("says whose move it is", () => {
    expect(statusLine({ ...base, humanSide: "white" })).toBe("Your move.");
    expect(statusLine({ ...base, humanSide: "black" })).toMatch(/Press Start/);
    expect(statusLine({ ...base, humanSide: "black", pending: true })).toBe("Opponent to move.");
    expect(statusLine({ ...base, fen: AFTER_E4, moveCount: 1, humanSide: "white" })).toBe(
      "Opponent to move.",
    );
    expect(statusLine({ ...base, fen: AFTER_E4, moveCount: 1, humanSide: "black" })).toBe(
      "Your move.",
    );
  });

  it("places the played move in System 1's ranking", () => {
    const stage = { round: 1, heat: null, rank: 2, probability: 0.3, bye: false };
    expect(standingLine([], false)).toMatch(/Not among/);
    expect(standingLine([stage], false)).toBe("System 1 ranked #2 at 30%.");
    expect(standingLine([stage], true)).toBe("System 1 ranked #2 at 30% among finalists.");
    expect(standingLine([{ ...stage, heat: 3, round: 2, rank: 4 }], true)).toBe(
      "Out in round 2, heat 3: ranked #4 at 30% in its heat.",
    );
    expect(standingLine([{ ...stage, bye: true }], true)).toBe("Bye in round 1.");
  });

  it("describes errors", () => {
    expect(isBusyRejection(new Error("submit() rejected: a run is already in flight"))).toBe(true);
    expect(isBusyRejection(new Error("Failed to fetch"))).toBe(false);
    expect(isBusyRejection("a run is already in flight")).toBe(false);
    expect(describeError(undefined)).toBeNull();
    expect(describeError(new Error("boom"))).toBe("boom");
    expect(describeError("plain")).toBe("plain");
    expect(describeError({ detail: "x" })).toBe('{"detail":"x"}');
  });
});

describe("ui helpers", () => {
  it("highlights the last move squares", () => {
    expect(lastMoveStyles(null)).toEqual({});
    expect(lastMoveStyles("e2")).toEqual({});
    expect(Object.keys(lastMoveStyles("e2e4"))).toEqual(["e2", "e4"]);
  });

  it("takes the first slider value from a range", () => {
    expect(sliderValue(0.4)).toBe(0.4);
    expect(sliderValue([0.2, 0.8])).toBe(0.2);
  });

  it("detects the bottom within tolerance", () => {
    expect(isAtBottom({ scrollTop: 92, scrollHeight: 200, clientHeight: 100 })).toBe(true);
    expect(isAtBottom({ scrollTop: 40, scrollHeight: 200, clientHeight: 100 })).toBe(false);
  });

  it("parses number fields into knob values", () => {
    expect(parseKnob("3", CONTEXT_CHECKS.k)).toBe(3);
    expect(parseKnob("", CONTEXT_CHECKS.k)).toBeUndefined();
    expect(parseKnob("0", CONTEXT_CHECKS.k)).toBeUndefined();
    expect(parseNullableKnob(" ", CONTEXT_CHECKS.top_p)).toBeNull();
    expect(parseNullableKnob("0.5", CONTEXT_CHECKS.top_p)).toBe(0.5);
    expect(parseNullableKnob("0", CONTEXT_CHECKS.top_p)).toBeUndefined();
  });
});
