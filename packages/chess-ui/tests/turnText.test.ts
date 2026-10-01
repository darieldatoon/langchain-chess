import { describe, expect, it } from "vite-plus/test";
import { live, systemOne } from "../src/testing";
import {
  gateLine,
  llmNotes,
  moveHeading,
  rankNote,
  soFarLine,
  sourcesLine,
  statText,
  tokenLine,
} from "../src/turnText";
import type { GameSoFar } from "../src/turnStats";
import { AFTER_E4 } from "../src/testing";
import { START_FEN } from "../src/types";

describe("moveHeading", () => {
  it("names the move and the side deciding it", () => {
    expect(moveHeading(START_FEN)).toBe("Move 1 · White");
    expect(moveHeading(AFTER_E4)).toBe("Move 1 · Black");
  });
});

describe("gateLine", () => {
  const tournament = { max_options: 16, rounds: 2, finalists: [], moves: [] };

  it("says why System 1 played or asked the LLM", () => {
    expect(
      gateLine(systemOne({ signal: 0.31, threshold_used: 0.9, status: "played" }), "Nf3"),
    ).toBe("Confident: margin 0.31, bar 0.90 → played Nf3");
    expect(gateLine(live(), null)).toBe(
      "Not confident enough: margin 0.02, bar 0.90 → asked the LLM",
    );
    expect(gateLine(live({ gate: "confidence", signal: 0.4, tournament }), null)).toBe(
      "Not confident enough: confidence 0.40, bar 0.90 → asked the LLM (ranked in rounds)",
    );
    expect(gateLine(live({ threshold_used: 1 }), null)).toBe(
      "Never plays alone (bar 1.00) → asked the LLM",
    );
    expect(gateLine(systemOne({ status: "played" }), null)).toMatch(/played its top move$/);
  });

  it("has nothing to say when System 1 was skipped", () => {
    expect(gateLine(live({ status: "skipped", signal: null, threshold_used: null }), null)).toBe(
      null,
    );
    expect(gateLine(live({ signal: null }), null)).toBeNull();
    // Older metadata may lack the gate's facts altogether.
    const legacy = { ...systemOne(), signal: undefined, threshold_used: undefined };
    expect(gateLine(legacy as never, null)).toBeNull();
  });
});

describe("rankNote", () => {
  const ranking = [
    { uci: "g1f3", probability: 0.2 },
    { uci: "d2d4", probability: 0.18 },
  ];

  it("places the move in System 1's displayed ranking", () => {
    expect(rankNote(ranking, "d2d4", "d4")).toBe("d4: System 1's #2 (18%)");
    expect(rankNote(ranking, "e2e4", "e4")).toBe("e4: not in System 1's top 2");
  });
});

describe("llmNotes", () => {
  const none = {
    error: null,
    illegalAttempts: 0,
    san: null,
    rank: null,
    summaryCost: null,
    summarized: false,
  };

  it("is null with nothing to say", () => {
    expect(llmNotes(none)).toBeNull();
  });

  it("joins what applies, in priority order", () => {
    expect(
      llmNotes({
        ...none,
        error: "Gateway timeout",
        illegalAttempts: 2,
        san: "d5",
        rank: "d5: not in System 1's top 5",
        summaryCost: { usd: 0.0004, complete: true },
        summarized: true,
      }),
    ).toBe(
      "Gateway timeout · 2 illegal moves before d5 · d5: not in System 1's top 5 · Memory summarized · $0.0004",
    );
    expect(llmNotes({ ...none, illegalAttempts: 1 })).toBe("1 illegal move so far");
    expect(llmNotes({ ...none, summarized: true })).toBe("Memory summarized · —");
  });
});

describe("tokenLine", () => {
  it("shows unknown counts as a dash and partial sums with a plus", () => {
    expect(
      tokenLine({
        input: { value: 12345, partial: true },
        output: { value: 300, partial: false },
        cacheRead: { value: null, partial: false },
        cacheWrite: { value: 0, partial: false },
        reasoning: { value: 0, partial: false },
      }),
    ).toBe("in 12,345+ · out 300 · cache read — · cache write 0 · reasoning 0");
  });
});

const soFar = (overrides: Partial<GameSoFar> = {}): GameSoFar => ({
  cost: { usd: 0.038, complete: true },
  agentMoves: 13,
  avgModelMs: 20100,
  bySource: { systemone: 6, llm: 6, forced: 1, other: 0 },
  abandoned: 0,
  ...overrides,
});

describe("the footer's lines", () => {
  it("counts the moves and their average model time, with the pace when it stands out", () => {
    expect(soFarLine(soFar(), null)).toBe("13 moves · avg 20.1 s model time");
    expect(soFarLine(soFar(), 1.84)).toBe("13 moves · avg 20.1 s model time · this move 1.8× avg");
    expect(soFarLine(soFar({ agentMoves: 1, avgModelMs: 400 }), null)).toBe(
      "1 move · avg 400 ms model time",
    );
    expect(soFarLine(soFar({ agentMoves: 0, avgModelMs: null }), null)).toBe("0 moves");
  });

  it("lists the sources that aren't zero, and the abandoned turns", () => {
    expect(sourcesLine(soFar())).toBe("System 1 played 6 · LLM 6 · forced 1");
    expect(
      sourcesLine(soFar({ bySource: { systemone: 0, llm: 0, forced: 0, other: 2 }, abandoned: 1 })),
    ).toBe("other 2 · 1 abandoned turn");
    expect(
      sourcesLine(soFar({ bySource: { systemone: 0, llm: 0, forced: 0, other: 0 }, abandoned: 2 })),
    ).toBe("2 abandoned turns");
  });
});

describe("statText", () => {
  it("shows a stage's time and cost, with a dash for each unknown", () => {
    expect(statText(400, { usd: 0.0001, complete: true })).toBe("400 ms · $0.0001");
    expect(statText(null, null)).toBe("— · —");
  });
});
