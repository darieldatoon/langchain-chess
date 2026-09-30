import { START_FEN } from "@langchain-chess/chess-ui";
import { call, ply, turn } from "@langchain-chess/chess-ui/testing";
import { describe, expect, it } from "vite-plus/test";
import {
  accuracyBand,
  barCost,
  flawNote,
  latencyBars,
  lineNumber,
  nextFlaw,
  previewFens,
  searchLimit,
  summarize,
} from "../src/tools";
import { review, values } from "./support/fixtures";

/** Before 3...Nf6?? in the fixture's game. */
const BEFORE_BLUNDER = "r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3";

describe("searchLimit", () => {
  it("names whichever limit the grader wrote", () => {
    expect(searchLimit({ depth: 18, multipv: 3 })).toBe("depth 18");
    expect(searchLimit({ nodes: 1500000 })).toBe("1,500,000 nodes");
    expect(searchLimit({ movetime: 500 })).toBe("500 ms a move");
    expect(searchLimit({ multipv: 3 })).toBeNull();
  });
});

describe("summarize", () => {
  it("counts, averages and splits each side by who chose its moves", () => {
    const { white, black } = summarize(review(), values().plies!);
    expect(white).toEqual({
      counts: { inaccuracy: 0, mistake: 0, blunder: 0 },
      acpl: 0,
      accuracy: 97.5,
      bySource: [
        {
          source: "external",
          moves: 4,
          counts: { inaccuracy: 0, mistake: 0, blunder: 0 },
          acpl: 0,
          meanAccuracy: 100,
        },
      ],
    });
    expect(black.counts.blunder).toBe(1);
    expect(black.acpl).toBeCloseTo(1000 / 3);
    expect(black.bySource).toHaveLength(1);
    expect(black.bySource[0].source).toBe("llm");
    expect(black.bySource[0].meanAccuracy).toBeCloseTo(212 / 3);
  });

  it("orders agent sources, and counts grades with no ply record as unknown", () => {
    const sources = ["forced", "llm", "custom", "systemone", "external", "llm", "systemone"];
    const plies = values().plies!.map((p, i) => ({ ...p, source: sources[i] }));
    const { white, black } = summarize(review(), plies);
    expect(white.bySource.map((g) => g.source)).toEqual([
      "systemone",
      "forced",
      "external",
      "custom",
    ]);
    expect(black.bySource.map((g) => g.source)).toEqual(["systemone", "llm"]);
    const unknown = summarize(review(), []);
    expect(unknown.white.bySource.map((g) => g.source)).toEqual(["unknown"]);
  });

  it("matches grades to records by ply, so a missing record shifts nothing", () => {
    const plies = values().plies!.filter((p) => p.ply !== 0);
    const { white, black } = summarize(review(), plies);
    expect(white.bySource.map((g) => [g.source, g.moves])).toEqual([
      ["external", 3],
      ["unknown", 1],
    ]);
    expect(black.bySource).toHaveLength(1);
    expect(black.bySource[0]).toMatchObject({ source: "llm", moves: 3 });
    expect(black.bySource[0].counts.blunder).toBe(1);
  });

  it("leaves a side with no graded moves empty", () => {
    const { white } = summarize(review({ plies: [], accuracy: { white: null, black: null } }), []);
    expect(white).toEqual({
      counts: { inaccuracy: 0, mistake: 0, blunder: 0 },
      acpl: null,
      accuracy: null,
      bySource: [],
    });
  });
});

describe("nextFlaw", () => {
  it("finds the side's next such move after the cursor, wrapping round", () => {
    const plies = review().plies.map((p) =>
      p.ply === 1 || p.ply === 5 ? { ...p, quality: "mistake" as const } : p,
    );
    const r = review({ plies });
    expect(nextFlaw(r, "black", "mistake", 0)).toBe(2);
    expect(nextFlaw(r, "black", "mistake", 2)).toBe(6);
    expect(nextFlaw(r, "black", "mistake", 6)).toBe(2);
    expect(nextFlaw(r, "white", "mistake", 0)).toBeNull();
  });
});

describe("accuracyBand", () => {
  it("bands at 85, 70 and 55", () => {
    expect([85, 84.9, 70, 69.9, 55, 54.9].map(accuracyBand)).toEqual([
      "success",
      "info",
      "info",
      "warning",
      "warning",
      "error",
    ]);
  });
});

describe("flawNote", () => {
  const blunder = review().plies[5];

  it("names the grade, the better move and the start of the best line", () => {
    expect(flawNote(blunder, BEFORE_BLUNDER)).toEqual({
      quality: "blunder",
      text: "Blunder. d5 was best.",
      line: "d5 Bxd5",
    });
    const long = { ...blunder, lines: [{ eval: { cp: 0 }, pv: Array(10).fill("d7d5") }] };
    expect(flawNote(long, BEFORE_BLUNDER)!.line).toBe("d5");
  });

  it("has nothing to say about a good move, and copes without a best move or line", () => {
    expect(flawNote(review().plies[0], START_FEN)).toBeNull();
    expect(flawNote(undefined, START_FEN)).toBeNull();
    expect(flawNote({ ...blunder, best_move: null, lines: [] }, BEFORE_BLUNDER)).toEqual({
      quality: "blunder",
      text: "Blunder.",
      line: "",
    });
  });
});

describe("previewFens", () => {
  it("plays a line out, stopping before a move that isn't legal", () => {
    const line = previewFens(START_FEN, ["e2e4", "e7e5", "e1e3", "g1f3"]);
    expect(line.moves).toEqual(["e2e4", "e7e5"]);
    expect(line.sans).toEqual(["e4", "e5"]);
    expect(line.fens).toHaveLength(2);
    expect(line.fens[1]).toContain("4p3/4P3");
    expect(line.base).toBe(START_FEN);
  });
});

describe("lineNumber", () => {
  it("numbers White's moves, and Black's first", () => {
    expect([0, 1, 2].map((at) => lineNumber(START_FEN, at))).toEqual(["1.", null, "2."]);
    expect([0, 1, 2].map((at) => lineNumber(BEFORE_BLUNDER, at))).toEqual(["3…", "4.", null]);
  });
});

describe("latencyBars", () => {
  it("times agent plies with a turn, and leaves the rest as gaps", () => {
    const plies = [
      ply({ ply: 0, san: "e4", latency_ms: 0 }),
      ply({ ply: 1, san: "e5", source: "llm", turn_id: "t1", latency_ms: 2500 }),
      ply({ ply: 2, san: "Nf3", source: "systemone", turn_id: "gone", latency_ms: 90 }),
    ];
    const turns = [turn({ id: "t1", calls: [call({ cost_usd: 0.02 })] })];
    const bars = latencyBars(plies, turns);
    expect(bars.map((b) => [b.index, b.label, b.seconds, b.source])).toEqual([
      [1, "e4", null, "external"],
      [2, "e5", 2.5, "llm"],
      [3, "Nf3", null, "systemone"],
    ]);
    expect(barCost(bars[1])).toEqual({ usd: 0.02, complete: true });
    expect(barCost(bars[0])).toBeNull();
  });
});
