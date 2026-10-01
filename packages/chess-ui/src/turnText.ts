// The reply card's words: the gate line, the LLM's notes, token details and the footer. Pure.
import { fullmoveNumber, sideToMove } from "./chess";
import { costText, percent, seconds } from "./format";
import type { TurnCost } from "./selectors";
import type { GameSoFar, TokenCounts, TokenSum } from "./turnStats";
import type { RankedMove, SystemOneLive, SystemOneMeta } from "./types";

/** "Move 12 · Black": the move being decided, from the position it's decided in. */
export function moveHeading(fenBefore: string): string {
  const side = sideToMove(fenBefore) === "white" ? "White" : "Black";
  return `Move ${fullmoveNumber(fenBefore)} · ${side}`;
}

type GateFacts = Pick<
  SystemOneMeta | SystemOneLive,
  "status" | "gate" | "signal" | "threshold_used" | "tournament"
>;

const two = (value: number) => value.toFixed(2);

/**
 * Why the LLM was or wasn't called, as the gate decided it. `played` is the SAN System 1 played.
 * Null when System 1 was skipped.
 */
export function gateLine(facts: GateFacts, played: string | null): string | null {
  const { signal, threshold_used: bar } = facts;
  // Older metadata may lack the gate's facts altogether.
  if (facts.status === "skipped" || signal == null || bar == null) return null;
  const rounds = facts.tournament ? " (ranked in rounds)" : "";
  if (bar >= 1) return `Never plays alone (bar ${two(bar)}) → asked the LLM${rounds}`;
  const measure = `${facts.gate} ${two(signal)}, bar ${two(bar)}`;
  return facts.status === "played"
    ? `Confident: ${measure} → played ${played ?? "its top move"}${rounds}`
    : `Not confident enough: ${measure} → asked the LLM${rounds}`;
}

/** The played move, if any, as System 1's ranking places it. */
export function rankNote(ranking: readonly RankedMove[], uci: string, san: string): string {
  const rank = ranking.findIndex((m) => m.uci === uci);
  return rank < 0
    ? `${san}: not in System 1's top ${ranking.length}`
    : `${san}: System 1's #${rank + 1} (${percent(ranking[rank].probability)})`;
}

export interface LlmNoteFacts {
  /** What stopped a failed turn, when this client saw it. */
  error: string | null;
  illegalAttempts: number;
  /** The committed move's SAN; null while the turn is pending. */
  san: string | null;
  /** How the move relates to System 1's displayed ranking; null without one. */
  rank: string | null;
  summaryCost: TurnCost | null;
  /** Whether the turn summarized the memory at all, priced or not. */
  summarized: boolean;
}

/** The one line under the analysis, in order of priority. Null when there's nothing to say. */
export function llmNotes(facts: LlmNoteFacts): string | null {
  const notes: string[] = facts.error ? [facts.error] : [];
  const n = facts.illegalAttempts;
  if (n > 0) {
    const moves = n === 1 ? "1 illegal move" : `${n} illegal moves`;
    notes.push(facts.san ? `${moves} before ${facts.san}` : `${moves} so far`);
  }
  if (facts.rank) notes.push(facts.rank);
  if (facts.summarized) notes.push(`Memory summarized · ${costText(facts.summaryCost).text}`);
  return notes.length > 0 ? notes.join(" · ") : null;
}

function tokenText({ value, partial }: TokenSum): string {
  if (value === null) return "—";
  return `${value.toLocaleString("en-US")}${partial ? "+" : ""}`;
}

/** "in 1,200 · out 300 · cache read — · cache write — · reasoning 0". */
export function tokenLine(tokens: TokenCounts): string {
  return [
    `in ${tokenText(tokens.input)}`,
    `out ${tokenText(tokens.output)}`,
    `cache read ${tokenText(tokens.cacheRead)}`,
    `cache write ${tokenText(tokens.cacheWrite)}`,
    `reasoning ${tokenText(tokens.reasoning)}`,
  ].join(" · ");
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "13 moves · avg 20.1 s model time", with the pace when this move stands out. */
export function soFarLine(soFar: GameSoFar, pace: number | null): string {
  const parts = [plural(soFar.agentMoves, "move")];
  if (soFar.avgModelMs !== null) parts.push(`avg ${seconds(soFar.avgModelMs)} model time`);
  if (pace !== null) parts.push(`this move ${pace.toFixed(1)}× avg`);
  return parts.join(" · ");
}

/** "System 1 played 6 · LLM 7 · forced 1 · 1 abandoned turn": the counts that aren't zero. */
export function sourcesLine(soFar: GameSoFar): string {
  const { systemone, llm, forced, other } = soFar.bySource;
  return [
    systemone > 0 && `System 1 played ${systemone}`,
    llm > 0 && `LLM ${llm}`,
    forced > 0 && `forced ${forced}`,
    other > 0 && `other ${other}`,
    soFar.abandoned > 0 && plural(soFar.abandoned, "abandoned turn"),
  ]
    .filter(Boolean)
    .join(" · ");
}

/** A stage's model time and cost: "0.4 s · $0.0001". */
export function statText(modelMs: number | null, cost: TurnCost | null): string {
  return `${modelMs === null ? "—" : seconds(modelMs)} · ${costText(cost).text}`;
}
