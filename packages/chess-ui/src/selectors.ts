// Pure reads over the thread values. Nothing here touches the stream or storage.
import {
  SYSTEMONE_META_KEY,
  type Call,
  type Message,
  type Ply,
  type Reply,
  type SystemOneMeta,
  type TurnRecord,
} from "./types";

export interface TurnCost {
  usd: number;
  /** False when any call is unpriced or approximated. */
  complete: boolean;
}

/** Mirrors `turn_cost` in libs/chess/langchain_chess/pricing.py: a move costs its whole turn. */
export function turnCost(calls: readonly Call[]): TurnCost | null {
  const priced = calls.flatMap((c) => (c.cost_usd === null ? [] : [c.cost_usd]));
  if (priced.length === 0) return null;
  return {
    usd: priced.reduce((sum, usd) => sum + usd, 0),
    complete: calls.every((c) => c.cost_usd !== null && c.cost_complete),
  };
}

export function turnOf(ply: Ply, turns: readonly TurnRecord[]): TurnRecord | null {
  if (ply.turn_id === null) return null;
  return turns.find((t) => t.id === ply.turn_id) ?? null;
}

export function lastPolicyPly(plies: readonly Ply[]): Ply | null {
  return plies.findLast((p) => p.source !== "external") ?? null;
}

/**
 * The reply that led to position `index`: the latest agent ply before it, with its turn and the
 * position it was chosen from. Null at the start or before any agent move.
 */
export function replyAt(
  plies: readonly Ply[],
  turns: readonly TurnRecord[],
  fens: readonly string[],
  index: number,
): Reply | null {
  const ply = plies.findLast((p) => p.ply < index && p.source !== "external");
  return ply ? { ply, turn: turnOf(ply, turns), fenBefore: fens[ply.ply] } : null;
}

export function systemOneMeta(ply: Ply): SystemOneMeta | null {
  const meta = ply.meta[SYSTEMONE_META_KEY];
  return meta && typeof meta.status === "string" ? (meta as unknown as SystemOneMeta) : null;
}

export function isPending(turns: readonly TurnRecord[]): boolean {
  return turns.at(-1)?.status === "pending";
}

/** Message content is a string or a list of blocks; only text blocks are the reply. */
export function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block: unknown) =>
      typeof block === "object" &&
      block !== null &&
      (block as { type?: unknown }).type === "text" &&
      typeof (block as { text?: unknown }).text === "string"
        ? (block as { text: string }).text
        : "",
    )
    .join("");
}

/**
 * The streaming reply: the latest AI text after the current turn opened. Committed replies are
 * skipped so the previous move's analysis never shows as live before the new turn lands.
 */
export function liveAnalysis(
  messages: readonly Message[],
  turns: readonly TurnRecord[],
  plies: readonly Ply[],
): string | null {
  const turn = turns.at(-1);
  const opened =
    turn?.status === "pending" ? messages.findIndex((m) => m.id === turn.opened_message_id) : -1;
  const anchor = opened >= 0 ? opened : messages.findLastIndex((m) => m.type === "human");
  const committed = new Set(plies.flatMap((p) => (p.message_id === null ? [] : [p.message_id])));
  for (let i = messages.length - 1; i > anchor; i -= 1) {
    const message = messages[i];
    if (message.type !== "ai" || (message.id !== undefined && committed.has(message.id))) continue;
    const text = textOf(message.content).trim();
    if (text) return text;
  }
  return null;
}
