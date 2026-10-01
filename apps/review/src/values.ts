// A root run's outputs as a game record. The project picker lists every project, so outputs can
// be anything; only what the review draws is checked, and a record that fails is no record. Pure.
import {
  isFen,
  SYSTEMONE_META_KEY,
  type ChessValues,
  type DrawReason,
  type Ply,
} from "@langchain-chess/chess-ui";
import { isArrayOf, isJson, isNumber, isSide, isString, type Json } from "./json";

const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const DRAW_REASONS: Record<DrawReason, true> = {
  stalemate: true,
  insufficient_material: true,
  threefold: true,
  fivefold: true,
  fifty_moves: true,
  seventyfive_moves: true,
};
const S1_STATUSES: readonly unknown[] = ["played", "shortlist", "skipped"];

const isUci = (v: unknown) => isString(v) && UCI.test(v);
const optional = (v: unknown, check: (v: unknown) => boolean) => v === undefined || check(v);
const nullable = (v: unknown, check: (v: unknown) => boolean) => v === null || check(v);
const isStringOrNull = (v: unknown) => optional(v, (x) => nullable(x, isString));

const RESIGN_REASONS: readonly unknown[] = ["illegal_moves", "resigned"];

function isOutcome(v: unknown): boolean {
  if (!isJson(v)) return false;
  if (v.kind === "draw") return isString(v.reason) && Object.hasOwn(DRAW_REASONS, v.reason);
  if (v.kind === "resignation") return isSide(v.winner) && RESIGN_REASONS.includes(v.reason);
  return v.kind === "checkmate" && isSide(v.winner);
}

const isDrawOffer = (v: unknown) =>
  isJson(v) && Number.isInteger(v.ply) && isSide(v.by) && v.answer === "declined";

const isRanked = (v: unknown) => isJson(v) && isString(v.uci) && isNumber(v.probability);
const isStage = (v: unknown) =>
  isJson(v) && nullable(v.heat, isNumber) && typeof v.bye === "boolean" && isNumber(v.probability);

const isNumberOrNull = (v: unknown) => optional(v, (x) => nullable(x, isNumber));

/** What the card reads from a decision, committed or live: its ranking and its gate. */
const isDecision = (v: Json) =>
  S1_STATUSES.includes(v.status) &&
  isStringOrNull(v.error) &&
  isArrayOf(v.shortlist, isRanked) &&
  optional(v.top, (top) => isArrayOf(top, isRanked)) &&
  isStringOrNull(v.gate) &&
  [v.signal, v.threshold_used, v.latency_ms].every(isNumberOrNull);

/** System 1's metadata as the ply details read it; absent or status-less metadata is ignored. */
function isSystemOne(v: unknown): boolean {
  if (!isJson(v) || !isString(v.status)) return true;
  return isDecision(v) && nullable(v.played_move_result, (r) => isArrayOf(r, isStage));
}

function isPly(v: unknown): boolean {
  return (
    isJson(v) &&
    isUci(v.uci) &&
    isString(v.san) &&
    isString(v.source) &&
    isNumber(v.latency_ms) &&
    [v.analysis, v.model, v.turn_id].every(isStringOrNull) &&
    isJson(v.meta) &&
    isSystemOne(v.meta[SYSTEMONE_META_KEY])
  );
}

const isCall = (v: unknown) =>
  isJson(v) &&
  isNumber(v.reasoning_tokens) &&
  nullable(v.cost_usd, isNumber) &&
  typeof v.cost_complete === "boolean";

const isTurn = (v: unknown) =>
  isJson(v) && isString(v.id) && isNumber(v.illegal_attempts) && isArrayOf(v.calls, isCall);

const isLive = (v: unknown) =>
  isJson(v) &&
  isString(v.turn_id) &&
  isDecision(v) &&
  isNumber(v.latency_ms) &&
  isArrayOf(v.calls, isCall);

function isValues(v: Json): boolean {
  return (
    isArrayOf(v.moves, isUci) &&
    optional(v.start_fen, (fen) => isString(fen) && (fen === "" || isFen(fen))) &&
    optional(v.plies, (plies) => isArrayOf(plies, isPly)) &&
    optional(v.turns, (turns) => isArrayOf(turns, isTurn)) &&
    optional(v.outcome, (outcome) => nullable(outcome, isOutcome)) &&
    optional(v.draw_offers, (offers) => isArrayOf(offers, isDrawOffer)) &&
    optional(v.systemone_live, (live) => nullable(live, isLive))
  );
}

/** The game record in a run's outputs, or null when they hold none this app can draw. */
export function decodeValues(outputs: unknown): ChessValues | null {
  return isJson(outputs) && isValues(outputs) ? (outputs as ChessValues) : null;
}

/**
 * The records by their own `ply`, one slot per move, undefined where a record is missing. Never
 * index `values.plies` by position: a missing record would shift every later one.
 */
export function recordsByPly(plies: readonly Ply[], count: number): (Ply | undefined)[] {
  const byPly = new Map(plies.map((p) => [p.ply, p]));
  return Array.from({ length: count }, (_, i) => byPly.get(i));
}
