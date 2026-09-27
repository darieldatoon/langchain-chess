import { LEGACY_KEYS, type ChessContext } from "./generated/settings";
import type { Call, Ply, SystemOneMeta, TurnRecord } from "./types";

export function call(overrides: Partial<Call> = {}): Call {
  return {
    kind: "llm",
    model: "anthropic:claude-opus-5",
    input_tokens: 1000,
    output_tokens: 200,
    reasoning_tokens: 0,
    cache_read_tokens: null,
    cache_write_tokens: null,
    cache_write_1h_tokens: null,
    called_at: "2026-09-25T10:00:00Z",
    cost_usd: 0.01,
    cost_complete: true,
    priced_with: "0.0.40",
    ...overrides,
  };
}

export function turn(overrides: Partial<TurnRecord> = {}): TurnRecord {
  return {
    id: "turn-1",
    request: "msg-1",
    initial_allowed: [],
    status: "committed",
    ply: 1,
    calls: [],
    rejected_message_ids: [],
    feedback_message_ids: [],
    opened_message_id: "msg-1",
    illegal_attempts: 0,
    latency_ms: 0,
    ...overrides,
  };
}

export function ply(overrides: Partial<Ply> = {}): Ply {
  return {
    ply: 0,
    side: "white",
    uci: "e2e4",
    san: "e4",
    source: "external",
    analysis: null,
    message_id: null,
    turn_id: null,
    model: null,
    latency_ms: 0,
    meta: {},
    ...overrides,
  };
}

export function systemOne(overrides: Partial<SystemOneMeta> = {}): SystemOneMeta {
  return {
    status: "played",
    model: "semif-qwen3.5-4b",
    shortlist: [],
    top: [
      { uci: "e7e5", probability: 0.95 },
      { uci: "c7c5", probability: 0.03 },
    ],
    followed: null,
    gate: "margin",
    signal: 0.92,
    confidence: 0.8,
    margin: 0.92,
    threshold_used: 0.9,
    finalist_conditional: false,
    played_move_result: [{ round: 1, heat: null, rank: 1, probability: 0.95, bye: false }],
    tournament: null,
    error: null,
    ...overrides,
  };
}

/** 1. e4 (human) e5 (System 1) with its turn: the smallest game with an opponent reply. */
export const E4_E5 = {
  moves: ["e2e4", "e7e5"],
  plies: [
    ply(),
    ply({
      ply: 1,
      side: "black",
      uci: "e7e5",
      san: "e5",
      source: "systemone",
      turn_id: "turn-1",
      model: "semif-qwen3.5-4b",
      latency_ms: 240,
      meta: { SystemOneMiddleware: { ...systemOne() } },
    }),
  ],
  turns: [turn({ calls: [call({ kind: "systemone", cost_usd: 0.0001 })] })],
};

export const AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";

/** A context's keys from before versions, `show_legal_moves` left to the caller. */
export function legacyOf(context: ChessContext): Record<string, unknown> {
  const keys = LEGACY_KEYS.filter((key) => key !== "show_legal_moves");
  return Object.fromEntries(keys.map((key) => [key, context[key as keyof ChessContext]]));
}
