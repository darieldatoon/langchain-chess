// Games as the list shows them, built from thread summaries, root runs and reviews. Pure.
import type { ChessValues, Outcome } from "@langchain-chess/chess-ui";
import type { GameReview } from "./review";

/** An item of `POST /api/v2/threads/query`. */
export interface ThreadItem {
  thread_id: string;
  count: number;
  min_start_time: string;
  max_start_time: string;
  last_trace_id: string;
}

/** An item of `POST /api/v2/runs/query` with the selects in api.ts. */
export interface RootRun {
  id: string;
  trace_id: string;
  start_time: string;
  metadata: Record<string, unknown> | null;
  outputs: ChessValues | null;
}

export interface Game {
  threadId: string;
  lastRunId: string;
  startedAt: string;
  turns: number;
  matchup: string;
  /** Null when the last run carries no game record (it errored, or it isn't a chess run). */
  values: ChessValues | null;
  review: GameReview | null;
}

/** `langsmith:anthropic/claude-opus-5-5` and `anthropic:claude-opus-5-5` read as the model. */
export function modelName(spec: unknown): string | null {
  if (typeof spec !== "string" || !spec) return null;
  return spec.replace(/^.*[:/]/, "");
}

export function matchup(metadata: Record<string, unknown> | null): string {
  const model = modelName(metadata?.model);
  const systemOne = modelName(metadata?.systemone_model);
  switch (metadata?.policy) {
    case "llm":
      return model ?? "LLM";
    case "systemone":
      return systemOne ?? "System 1";
    case "hybrid":
      return [model, systemOne].filter(Boolean).join(" + ") || "Hybrid";
    default:
      return "Unknown setup";
  }
}

export function resultText(outcome: Outcome | null | undefined): string {
  if (!outcome) return "In progress";
  if (outcome.kind === "draw") return "½-½";
  return outcome.winner === "white" ? "1-0" : "0-1";
}

export function toGame(
  thread: ThreadItem,
  run: RootRun | undefined,
  review: GameReview | undefined,
): Game {
  const values = run?.outputs && Array.isArray(run.outputs.moves) ? run.outputs : null;
  return {
    threadId: thread.thread_id,
    lastRunId: thread.last_trace_id,
    startedAt: thread.min_start_time,
    turns: thread.count,
    matchup: matchup(run?.metadata ?? null),
    values,
    review: review ?? null,
  };
}
