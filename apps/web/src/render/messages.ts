// What LangSmith posts to a custom output renderer, read into what the renderer draws. Pure.
// Shapes mirror evals/langchain_chess_evals/positions/schema.py (inputs, the Stockfish reference)
// and `outputs_of` in evals/langchain_chess_evals/systemone/target.py (System 1's outputs).
import { isFen, replay, sideToMove, type RankedMove, type Side } from "@langchain-chess/chess-ui";

/** From White's side. `mate: 0` is a mated position. */
export type Eval = { cp: number } | { mate: number; winner: Side };

export interface Position {
  /** After every move in `moves`. */
  fen: string;
  mover: Side;
  /** The move that led here; null at the start. */
  lastMove: string | null;
  legal: readonly string[];
}

export interface Reference {
  evals: Readonly<Record<string, Eval>>;
  /** Every legal move, best first. */
  ranked: readonly string[];
}

export type Ranking =
  | {
      kind: "ranked";
      /** Best first. After a tournament, the finalists only. */
      moves: readonly RankedMove[];
      confidence: number;
      margin: number;
      tournament: boolean;
      requests: number | null;
      latencyMs: number | null;
    }
  | { kind: "failed"; error: string; requests: number | null; latencyMs: number | null };

export type Shown =
  | { kind: "reference"; position: Position; reference: Reference }
  | { kind: "output"; position: Position; ranking: Ranking }
  /** A renderer message whose data this page can't draw, with the first reason why. */
  | { kind: "unreadable"; reason: string };

type Json = Record<string, unknown>;

const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const isJson = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isUci = (v: unknown): v is string => typeof v === "string" && UCI.test(v);
const isUcis = (v: unknown): v is string[] => Array.isArray(v) && v.every(isUci);
const numberOrNull = (v: unknown) => (isNumber(v) ? v : null);

class Unreadable extends Error {}

function fail(reason: string): never {
  throw new Unreadable(reason);
}

function positionOf(inputs: unknown): Position {
  if (!isJson(inputs)) fail("no inputs");
  const { start_fen: startFen, moves, legal } = inputs;
  if (typeof startFen !== "string" || !isUcis(moves) || !isUcis(legal) || legal.length === 0) {
    fail("inputs are not a position: start_fen, moves and legal");
  }
  if (!isFen(startFen)) fail(`start_fen is not a FEN: ${startFen}`);
  const { fen, sans } = replay(startFen, moves);
  if (sans.length < moves.length) fail(`move ${moves[sans.length]} is illegal after ${fen}`);
  return { fen, mover: sideToMove(fen), lastMove: moves.at(-1) ?? null, legal };
}

function isEval(v: unknown): v is Eval {
  if (!isJson(v)) return false;
  if ("cp" in v) return Number.isInteger(v.cp);
  return Number.isInteger(v.mate) && (v.winner === "white" || v.winner === "black");
}

function referenceOf(data: Json): Reference {
  const { evals, ranked } = data;
  if (!isJson(evals) || !isUcis(ranked) || ranked.length === 0) {
    fail("reference outputs have no evals and ranked");
  }
  for (const uci of ranked) {
    if (!isEval(evals[uci])) fail(`no eval for ${uci}`);
  }
  return { evals: evals as Record<string, Eval>, ranked };
}

const isRanked = (v: unknown): v is RankedMove =>
  isJson(v) && isUci(v.uci) && isNumber(v.probability);

function rankingOf(data: Json): Ranking {
  const requests = numberOrNull(data.requests);
  const latencyMs = numberOrNull(data.latency_ms);
  if (typeof data.error === "string") {
    return { kind: "failed", error: data.error, requests, latencyMs };
  }
  const { ranked, confidence, margin } = data;
  if (!Array.isArray(ranked) || ranked.length === 0 || !ranked.every(isRanked)) {
    fail("outputs have no ranked moves");
  }
  if (!isNumber(confidence) || !isNumber(margin)) fail("outputs have no confidence and margin");
  return {
    kind: "ranked",
    moves: ranked,
    confidence,
    margin,
    tournament: data.tournament === true,
    requests,
    latencyMs,
  };
}

/** Null for a message that isn't a renderer message at all, which the page ignores. */
export function readMessage(message: unknown): Shown | null {
  if (!isJson(message) || (message.type !== "output" && message.type !== "reference")) {
    return null;
  }
  try {
    if (!isJson(message.data)) fail("no outputs");
    const inputs = isJson(message.metadata) ? message.metadata.inputs : undefined;
    const position = positionOf(inputs);
    return message.type === "reference"
      ? { kind: "reference", position, reference: referenceOf(message.data) }
      : { kind: "output", position, ranking: rankingOf(message.data) };
  } catch (error) {
    // Only `fail` throws in here: the guards before each step keep the rest total.
    return { kind: "unreadable", reason: (error as Unreadable).message };
  }
}

/** From the mover's side, in pawns: `+0.4`, `mate in 3`. */
export function evalText(e: Eval, mover: Side): string {
  if ("cp" in e) {
    const tenths = Math.round((mover === "white" ? e.cp : -e.cp) / 10);
    return tenths === 0 ? "0.0" : `${tenths > 0 ? "+" : "-"}${(Math.abs(tenths) / 10).toFixed(1)}`;
  }
  if (e.mate === 0) return e.winner === mover ? "checkmate" : "checkmated";
  return e.winner === mover ? `mate in ${e.mate}` : `mated in ${e.mate}`;
}
