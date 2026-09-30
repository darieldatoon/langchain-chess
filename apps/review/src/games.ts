// Games as the list shows them, built from thread summaries, root runs and reviews. Pure.
import type { ChessValues, Outcome, Ply, Side } from "@langchain-chess/chess-ui";
import type { Mark } from "./analysis";
import type { Grading } from "./review";
import { decodeValues } from "./values";

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
  outputs: unknown;
}

export interface Game {
  threadId: string;
  lastRunId: string;
  /** Null when the run wasn't found. */
  lastRunStartTime: string | null;
  startedAt: string;
  turns: number;
  matchup: string;
  /** Where the game was played (`web`, `tui`, ...), from the last root run's metadata. */
  surface: string | null;
  /** Null when the last run carries no game record (it errored, or it isn't a chess run). */
  values: ChessValues | null;
  grading: Grading;
  /** The Analyze button's mark, while a job runs or after it failed. */
  mark: Mark | null;
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

/**
 * A side's name on its strip: the matchup for a side the agent played, else "Human" for a game
 * from the web app, else its colour. From the whole game, not the viewed ply.
 */
export function sideLabel(
  game: Pick<Game, "matchup" | "surface">,
  plies: readonly Ply[],
  side: Side,
): string {
  if (plies.some((p) => p.side === side && p.source !== "external")) return game.matchup;
  if (game.surface === "web") return "Human";
  return side === "white" ? "White" : "Black";
}

export function resultText(outcome: Outcome | null | undefined): string {
  if (!outcome) return "In progress";
  if (outcome.kind === "draw") return "½-½";
  return outcome.winner === "white" ? "1-0" : "0-1";
}

const UNGRADED: Grading = { status: "ungraded" };

/** A review of other moves than the game's would draw the wrong evaluations on the board. */
function against(values: ChessValues | null, grading: Grading): Grading {
  const moves = values?.moves;
  if (grading.status !== "graded" || !moves) return grading;
  const plies = grading.review.plies;
  const matches = plies.length === moves.length && plies.every((p, i) => p.uci === moves[i]);
  return matches
    ? grading
    : { status: "invalid", problem: "it grades different moves than the game's" };
}

export function toGame(
  thread: ThreadItem,
  run: RootRun | undefined,
  grading: Grading = UNGRADED,
  mark: Mark | null = null,
): Game {
  const values = decodeValues(run?.outputs);
  return {
    threadId: thread.thread_id,
    lastRunId: thread.last_trace_id,
    lastRunStartTime: run?.start_time || null,
    startedAt: thread.min_start_time,
    turns: thread.count,
    matchup: matchup(run?.metadata ?? null),
    surface: typeof run?.metadata?.surface === "string" ? run.metadata.surface : null,
    values,
    grading: against(values, grading),
    mark,
  };
}
