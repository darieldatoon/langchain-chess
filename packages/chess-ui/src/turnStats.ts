// Model time, cost and tokens per stage and for the game so far. "Model time" is always the
// recorded `latency_ms`, never wall-clock time. Pure.
import { turnCost, turnOf, type TurnCost } from "./selectors";
import type { Call, Ply, Stages, SystemOneLive, SystemOneMeta, TurnRecord } from "./types";

/** `value` is null when every call's count is unknown; `partial` when only some are. */
export interface TokenSum {
  value: number | null;
  partial: boolean;
}

export interface TokenCounts {
  input: TokenSum;
  output: TokenSum;
  cacheRead: TokenSum;
  cacheWrite: TokenSum;
  reasoning: TokenSum;
}

/** A stage's figures. Null wherever they're unknown, never zero. */
export interface Stat {
  modelMs: number | null;
  cost: TurnCost | null;
  tokens: TokenCounts;
}

export interface StageStats {
  systemOne: Stat | null;
  llm: Stat | null;
  /** The memory summaries' cost: they aren't timed separately. */
  summaryCost: TurnCost | null;
}

const NONE: TokenSum = { value: null, partial: false };

function tokenSum(values: readonly (number | null)[]): TokenSum {
  const known = values.filter((v): v is number => typeof v === "number");
  if (values.length > 0 && known.length === 0) return NONE;
  return { value: known.reduce((a, b) => a + b, 0), partial: known.length < values.length };
}

/** `cache_write_1h_tokens` is a subset of `cache_write_tokens`, so it isn't added again. */
export function tokenCounts(calls: readonly Call[]): TokenCounts {
  return {
    input: tokenSum(calls.map((c) => c.input_tokens)),
    output: tokenSum(calls.map((c) => c.output_tokens)),
    cacheRead: tokenSum(calls.map((c) => c.cache_read_tokens)),
    cacheWrite: tokenSum(calls.map((c) => c.cache_write_tokens)),
    reasoning: tokenSum(calls.map((c) => c.reasoning_tokens)),
  };
}

const UNKNOWN: Stat = {
  modelMs: null,
  cost: null,
  tokens: { input: NONE, output: NONE, cacheRead: NONE, cacheWrite: NONE, reasoning: NONE },
};

const ofKind = (calls: readonly Call[], ...kinds: Call["kind"][]) =>
  calls.filter((c) => kinds.includes(c.kind));

/**
 * Each stage's figures. System 1's calls join a turn only when it finalizes, so a pending turn's
 * come from the live payload, and a pending turn's time is only the LLM calls completed so far.
 */
export function stageStats(
  turn: TurnRecord | null,
  systemOne: SystemOneMeta | SystemOneLive | null,
  status: "pending" | "committed",
  stages: Stages,
): StageStats {
  if (stages.kind === "forced") return { systemOne: null, llm: null, summaryCost: null };
  const systemOneMs = systemOne?.latency_ms ?? null;
  const stat = (calls: readonly Call[], modelMs: number | null): Stat =>
    turn ? { modelMs, cost: turnCost(calls), tokens: tokenCounts(calls) } : UNKNOWN;
  const systemOneCalls =
    status === "pending"
      ? systemOne && "calls" in systemOne
        ? systemOne.calls
        : []
      : ofKind(turn?.calls ?? [], "systemone");
  const llmCalls = ofKind(turn?.calls ?? [], "llm", "summary");
  const llmMs = (): number | null => {
    if (!turn) return null;
    // Summaries aren't timed: only a completed model call makes the time known.
    if (status === "pending")
      return llmCalls.some((c) => c.kind === "llm") ? turn.latency_ms : null;
    if (!stages.systemOne) return turn.latency_ms;
    return systemOneMs === null ? null : turn.latency_ms - systemOneMs;
  };
  return {
    systemOne: stages.systemOne ? stat(systemOneCalls, systemOneMs) : null,
    llm: stages.llm ? stat(llmCalls, llmMs()) : null,
    summaryCost: turn ? turnCost(ofKind(turn.calls, "summary")) : null,
  };
}

const isAgent = (ply: Ply) => ply.source !== "external";

/**
 * The last turn index the footer counts at position `index` (moves played), or -1. The latest
 * position counts every turn; an earlier one stops at the turn of the last agent move before it,
 * because a turn records no position until it commits.
 */
export function accountingPrefix(
  turns: readonly TurnRecord[],
  plies: readonly Ply[],
  index: number,
  live: boolean,
): number {
  if (live) return turns.length - 1;
  const ply = plies.findLast((p) => p.ply < index && isAgent(p));
  const turn = ply ? turnOf(ply, turns) : null;
  return turn ? turns.indexOf(turn) : -1;
}

export type SourceCounts = Record<"systemone" | "llm" | "forced" | "other", number>;

export interface GameSoFar {
  cost: TurnCost | null;
  agentMoves: number;
  /** The average model time of the agent's moves; null before the first. */
  avgModelMs: number | null;
  bySource: SourceCounts;
  abandoned: number;
}

const sourceKey = (source: string): keyof SourceCounts =>
  source === "systemone" || source === "llm" || source === "forced" ? source : "other";

/**
 * Turns `0..through`: every call's cost, abandoned and terminal turns included, plus a pending
 * turn's live System 1 calls (a finalized turn already holds its own, so none is counted twice).
 * Only committed turns are moves.
 */
export function gameSoFar(
  turns: readonly TurnRecord[],
  plies: readonly Ply[],
  through: number,
  live: SystemOneLive | null,
): GameSoFar {
  const counted = turns.slice(0, through + 1);
  const pendingLive = live && counted.some((t) => t.id === live.turn_id && t.status === "pending");
  const calls = [...counted.flatMap((t) => t.calls), ...(pendingLive ? live.calls : [])];
  const moves = counted
    .filter((t) => t.status === "committed")
    .flatMap((t) => plies.filter((p) => p.turn_id === t.id));
  const bySource: SourceCounts = { systemone: 0, llm: 0, forced: 0, other: 0 };
  for (const ply of moves) bySource[sourceKey(ply.source)] += 1;
  return {
    cost: turnCost(calls),
    agentMoves: moves.length,
    avgModelMs:
      moves.length === 0 ? null : moves.reduce((sum, p) => sum + p.latency_ms, 0) / moves.length,
    bySource,
    abandoned: counted.filter((t) => t.status === "abandoned").length,
  };
}

/** The footer at position `index`, `live` when it's the latest; null before any turn counts. */
export function soFarAt(
  turns: readonly TurnRecord[],
  plies: readonly Ply[],
  index: number,
  live: boolean,
  systemOne: SystemOneLive | null,
): GameSoFar | null {
  const through = accountingPrefix(turns, plies, index, live);
  return through < 0 ? null : gameSoFar(turns, plies, through, systemOne);
}

const PACE_MOVES = 3;

/**
 * How a committed move's model time compares with the game's average, when it stands out: at
 * least 1.5 times or at most half the average, once there are three agent moves.
 */
export function paceRatio(modelMs: number, soFar: GameSoFar): number | null {
  if (soFar.agentMoves < PACE_MOVES || !soFar.avgModelMs) return null;
  const ratio = modelMs / soFar.avgModelMs;
  return ratio >= 1.5 || ratio <= 0.5 ? ratio : null;
}
