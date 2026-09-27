// A root run's outputs as a game record. The project picker lists every project, so outputs can
// be anything; only what the review draws is checked, and a record that fails is no record. Pure.
import {
  isFen,
  SYSTEMONE_META_KEY,
  type ChessValues,
  type DrawReason,
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
  timeout_vs_insufficient_material: true,
};
const S1_STATUSES: readonly unknown[] = ["played", "shortlist", "skipped"];

const isUci = (v: unknown) => isString(v) && UCI.test(v);
const optional = (v: unknown, check: (v: unknown) => boolean) => v === undefined || check(v);
const nullable = (v: unknown, check: (v: unknown) => boolean) => v === null || check(v);
const isStringOrNull = (v: unknown) => optional(v, (x) => nullable(x, isString));

function isOutcome(v: unknown): boolean {
  if (!isJson(v)) return false;
  if (v.kind === "draw") return isString(v.reason) && Object.hasOwn(DRAW_REASONS, v.reason);
  return (
    (v.kind === "checkmate" || v.kind === "resignation" || v.kind === "timeout") && isSide(v.winner)
  );
}

const isRanked = (v: unknown) => isJson(v) && isString(v.uci) && isNumber(v.probability);
const isStage = (v: unknown) =>
  isJson(v) && nullable(v.heat, isNumber) && typeof v.bye === "boolean" && isNumber(v.probability);

/** System 1's metadata as the ply details read it; absent or status-less metadata is ignored. */
function isSystemOne(v: unknown): boolean {
  if (!isJson(v) || !isString(v.status)) return true;
  return (
    S1_STATUSES.includes(v.status) &&
    isStringOrNull(v.error) &&
    isArrayOf(v.shortlist, isRanked) &&
    optional(v.top, (top) => isArrayOf(top, isRanked)) &&
    nullable(v.played_move_result, (r) => isArrayOf(r, isStage))
  );
}

function isPly(v: unknown): boolean {
  return (
    isJson(v) &&
    isUci(v.uci) &&
    isString(v.san) &&
    isString(v.source) &&
    isNumber(v.latency_ms) &&
    optional(v.clock_ms, (ms) => nullable(ms, isNumber)) &&
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

const isTimeControl = (v: unknown) => isJson(v) && isNumber(v.base_ms) && isNumber(v.increment_ms);

const isTurn = (v: unknown) =>
  isJson(v) && isString(v.id) && isNumber(v.illegal_attempts) && isArrayOf(v.calls, isCall);

function isValues(v: Json): boolean {
  return (
    isArrayOf(v.moves, isUci) &&
    optional(v.start_fen, (fen) => isString(fen) && (fen === "" || isFen(fen))) &&
    optional(v.plies, (plies) => isArrayOf(plies, isPly)) &&
    optional(v.turns, (turns) => isArrayOf(turns, isTurn)) &&
    optional(v.outcome, (outcome) => nullable(outcome, isOutcome)) &&
    optional(v.time_control, (control) => nullable(control, isTimeControl))
  );
}

/** The game record in a run's outputs, or null when they hold none this app can draw. */
export function decodeValues(outputs: unknown): ChessValues | null {
  return isJson(outputs) && isValues(outputs) ? (outputs as ChessValues) : null;
}
