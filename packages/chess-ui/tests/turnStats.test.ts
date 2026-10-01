import { describe, expect, it } from "vite-plus/test";
import { call, live, ply, systemOne, turn } from "../src/testing";
import {
  accountingPrefix,
  gameSoFar,
  paceRatio,
  soFarAt,
  stageStats,
  tokenCounts,
  type GameSoFar,
} from "../src/turnStats";
import type { Stages } from "../src/types";

const HYBRID: Stages = { kind: "pipeline", systemOne: true, llm: true, certain: true };
const S1_ONLY: Stages = { kind: "pipeline", systemOne: true, llm: false, certain: true };
const LLM_ONLY: Stages = { kind: "pipeline", systemOne: false, llm: true, certain: true };

const s1Call = call({ kind: "systemone", cost_usd: 0.0001 });
const llmCall = call({ cost_usd: 0.002 });
const summary = call({ kind: "summary", cost_usd: 0.0004 });

describe("stageStats", () => {
  it("splits a committed hybrid turn: System 1's own time, the LLM's the rest", () => {
    const committed = turn({ calls: [llmCall, summary, s1Call], latency_ms: 9400 });
    const stats = stageStats(committed, systemOne({ latency_ms: 400 }), "committed", HYBRID);
    expect(stats.systemOne?.modelMs).toBe(400);
    expect(stats.systemOne?.cost).toEqual({ usd: 0.0001, complete: true });
    expect(stats.llm?.modelMs).toBe(9000);
    expect(stats.llm?.cost?.usd).toBeCloseTo(0.0024);
    expect(stats.summaryCost).toEqual({ usd: 0.0004, complete: true });
  });

  it("times a move System 1 played alone in a hybrid as System 1's", () => {
    const committed = turn({ calls: [s1Call], latency_ms: 400 });
    const stats = stageStats(committed, systemOne({ latency_ms: 400 }), "committed", HYBRID);
    expect(stats.systemOne?.modelMs).toBe(400);
    expect(stats.llm?.modelMs).toBe(0);
    expect(stats.llm?.cost).toBeNull();
  });

  it("times a skipped System 1 by how long it ran before failing", () => {
    const skipped = systemOne({ status: "skipped", latency_ms: 300 });
    const stats = stageStats(turn({ latency_ms: 5300 }), skipped, "committed", HYBRID);
    expect(stats.systemOne?.modelMs).toBe(300);
    expect(stats.llm?.modelMs).toBe(5000);
  });

  it("covers LLM-only, System 1-only and forced turns", () => {
    const llm = stageStats(
      turn({ calls: [llmCall], latency_ms: 7000 }),
      null,
      "committed",
      LLM_ONLY,
    );
    expect(llm.systemOne).toBeNull();
    expect(llm.llm?.modelMs).toBe(7000);
    const s1 = stageStats(
      turn({ calls: [s1Call] }),
      systemOne({ latency_ms: 250 }),
      "committed",
      S1_ONLY,
    );
    expect(s1.llm).toBeNull();
    expect(s1.systemOne?.modelMs).toBe(250);
    expect(stageStats(turn(), null, "committed", { kind: "forced" })).toEqual({
      systemOne: null,
      llm: null,
      summaryCost: null,
    });
  });

  it("leaves the LLM's time unknown when older metadata has no System 1 time", () => {
    const older = systemOne();
    const stats = stageStats(turn({ latency_ms: 5000 }), older, "committed", HYBRID);
    expect(stats.systemOne?.modelMs).toBeNull();
    expect(stats.llm?.modelMs).toBeNull();
  });

  it("is unknown, never zero, without a turn record", () => {
    const stats = stageStats(null, systemOne({ latency_ms: 400 }), "committed", HYBRID);
    expect(stats.systemOne).toMatchObject({ modelMs: null, cost: null });
    expect(stats.systemOne?.tokens.input).toEqual({ value: null, partial: false });
    expect(stats.llm?.modelMs).toBeNull();
    expect(stats.summaryCost).toBeNull();
  });

  it("reads a pending turn's System 1 from the live payload, and its completed LLM calls", () => {
    const open = turn({ status: "pending", calls: [llmCall], latency_ms: 6000 });
    const stats = stageStats(open, live(), "pending", HYBRID);
    expect(stats.systemOne?.modelMs).toBe(400);
    expect(stats.systemOne?.cost).toEqual({ usd: 0.0001, complete: true });
    expect(stats.llm?.modelMs).toBe(6000);
    expect(stats.llm?.cost).toEqual({ usd: 0.002, complete: true });
    // Before System 1 is done, and before any LLM call completes.
    const fresh = stageStats(turn({ status: "pending" }), null, "pending", HYBRID);
    expect(fresh.systemOne).toMatchObject({ modelMs: null, cost: null });
    expect(fresh.llm?.modelMs).toBeNull();
    // A memory summary isn't timed: it alone doesn't make the LLM's time known.
    const summarized = turn({ status: "pending", calls: [summary] });
    expect(stageStats(summarized, live(), "pending", HYBRID).llm?.modelMs).toBeNull();
  });
});

describe("tokenCounts", () => {
  it("sums known counts, marks partial sums, and leaves all-unknown counts unknown", () => {
    const counts = tokenCounts([
      call({ input_tokens: 100, output_tokens: 20, cache_write_tokens: 50 }),
      call({ input_tokens: null, output_tokens: 30, cache_write_tokens: 10 }),
    ]);
    expect(counts.input).toEqual({ value: 100, partial: true });
    expect(counts.output).toEqual({ value: 50, partial: false });
    expect(counts.cacheRead).toEqual({ value: null, partial: false });
    // The 1-hour writes are a subset of all writes, so they aren't added again.
    expect(counts.cacheWrite).toEqual({ value: 60, partial: false });
    expect(counts.reasoning).toEqual({ value: 0, partial: false });
    expect(tokenCounts([]).input).toEqual({ value: 0, partial: false });
  });

  it("does not count the 1-hour cache writes twice", () => {
    const counts = tokenCounts([call({ cache_write_tokens: 50, cache_write_1h_tokens: 50 })]);
    expect(counts.cacheWrite.value).toBe(50);
  });
});

// 1. e4 (human) e5 (System 1), 2. Nf3 (human), an abandoned turn, then Nc6 (LLM).
const plies = [
  ply(),
  ply({ ply: 1, side: "black", source: "systemone", turn_id: "t1", latency_ms: 400 }),
  ply({ ply: 2, uci: "g1f3", san: "Nf3" }),
  ply({ ply: 3, side: "black", source: "llm", turn_id: "t3", latency_ms: 8000 }),
];
const turns = [
  turn({ id: "t1", ply: 1, calls: [s1Call] }),
  turn({ id: "t2", ply: null, status: "abandoned", calls: [llmCall] }),
  turn({ id: "t3", ply: 3, calls: [s1Call, llmCall] }),
];

describe("accountingPrefix", () => {
  it("counts every turn at the latest position", () => {
    expect(accountingPrefix(turns, plies, 4, true)).toBe(2);
  });

  it("stops an earlier position at the turn of its last agent move", () => {
    // After Nc6: the abandoned turn before it belongs to that move.
    expect(accountingPrefix(turns, plies, 4, false)).toBe(2);
    // After the human's Nf3: the agent's last move is e5; the abandoned turn is the next one's.
    expect(accountingPrefix(turns, plies, 3, false)).toBe(0);
    expect(accountingPrefix(turns, plies, 2, false)).toBe(0);
  });

  it("is -1 before any agent move, and for a legacy ply with no turn record", () => {
    expect(accountingPrefix(turns, plies, 1, false)).toBe(-1);
    expect(accountingPrefix([], plies, 2, false)).toBe(-1);
  });
});

describe("gameSoFar", () => {
  it("costs every turn, abandoned ones included, and averages the moves only", () => {
    const soFar = gameSoFar(turns, plies, 2, null);
    expect(soFar.cost?.usd).toBeCloseTo(0.0042);
    expect(soFar.agentMoves).toBe(2);
    expect(soFar.avgModelMs).toBe(4200);
    expect(soFar.bySource).toEqual({ systemone: 1, llm: 1, forced: 0, other: 0 });
    expect(soFar.abandoned).toBe(1);
  });

  it("is empty before the first turn", () => {
    expect(gameSoFar(turns, plies, -1, null)).toEqual({
      cost: null,
      agentMoves: 0,
      avgModelMs: null,
      bySource: { systemone: 0, llm: 0, forced: 0, other: 0 },
      abandoned: 0,
    });
  });

  it("counts a terminal resignation's cost, but not as a move or an abandoned turn", () => {
    const resigned = [turn({ id: "r", ply: null, status: "terminal", calls: [llmCall] })];
    expect(gameSoFar(resigned, [], 0, null)).toMatchObject({
      cost: { usd: 0.002, complete: true },
      agentMoves: 0,
      avgModelMs: null,
      abandoned: 0,
    });
  });

  it("adds a pending turn's live System 1 calls once, until the turn finalizes", () => {
    const result = live({ turn_id: "p", calls: [s1Call] });
    const open = turn({ id: "p", ply: null, status: "pending", calls: [llmCall] });
    expect(gameSoFar([open], [], 0, result).cost?.usd).toBeCloseTo(0.0021);
    // Committed, the turn holds System 1's calls itself.
    const done = { ...open, status: "committed" as const, ply: 0, calls: [llmCall, s1Call] };
    expect(gameSoFar([done], [], 0, result).cost?.usd).toBeCloseTo(0.0021);
    const abandoned = { ...open, status: "abandoned" as const, calls: [llmCall, s1Call] };
    expect(gameSoFar([abandoned], [], 0, result).cost?.usd).toBeCloseTo(0.0021);
    // A stale payload, from another turn, adds nothing.
    expect(gameSoFar([open], [], 0, live({ turn_id: "old" })).cost?.usd).toBeCloseTo(0.002);
  });

  it("marks the cost incomplete when any call was unpriced, and counts other sources", () => {
    const book = [turn({ id: "b", ply: 0, calls: [call({ cost_usd: null }), llmCall] })];
    const soFar = gameSoFar(book, [ply({ source: "book", turn_id: "b" })], 0, null);
    expect(soFar.cost).toEqual({ usd: 0.002, complete: false });
    expect(soFar.bySource.other).toBe(1);
  });
});

describe("soFarAt", () => {
  it("is the footer at a position, and nothing before any turn counts", () => {
    expect(soFarAt(turns, plies, 4, true, null)).toEqual(gameSoFar(turns, plies, 2, null));
    expect(soFarAt(turns, plies, 3, false, null)?.agentMoves).toBe(1);
    expect(soFarAt(turns, plies, 1, false, null)).toBeNull();
    expect(soFarAt([], [], 0, true, null)).toBeNull();
  });
});

describe("paceRatio", () => {
  const soFar = (agentMoves: number, avgModelMs: number | null): GameSoFar => ({
    cost: null,
    agentMoves,
    avgModelMs,
    bySource: { systemone: 0, llm: 0, forced: 0, other: 0 },
    abandoned: 0,
  });

  it("speaks only once there are three moves and this one stands out", () => {
    expect(paceRatio(3000, soFar(3, 2000))).toBe(1.5);
    expect(paceRatio(1000, soFar(3, 2000))).toBe(0.5);
    expect(paceRatio(2900, soFar(3, 2000))).toBeNull();
    expect(paceRatio(1100, soFar(3, 2000))).toBeNull();
    expect(paceRatio(9000, soFar(2, 2000))).toBeNull();
    expect(paceRatio(9000, soFar(3, 0))).toBeNull();
    expect(paceRatio(9000, soFar(3, null))).toBeNull();
  });
});
