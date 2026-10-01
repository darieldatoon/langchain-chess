// The agent's pipeline, stage by stage: which stages a turn has and where each one stands. Pure.
import type { Policy } from "./generated/settings";
import { systemOneMeta, turnOf } from "./selectors";
import { loadRecorded } from "./settings";
import type {
  ChessValues,
  Ply,
  Reply,
  ReplyState,
  Stages,
  SystemOneLive,
  TurnRecord,
} from "./types";

/** The policy a game recorded in its `setup`; null when it recorded none this app can read. */
export function recordedPolicy(setup: unknown): Policy | null {
  try {
    return loadRecorded(setup).policy;
  } catch {
    return null;
  }
}

const PIPELINES: Record<Policy, { systemOne: boolean; llm: boolean }> = {
  hybrid: { systemOne: true, llm: true },
  systemone: { systemOne: true, llm: false },
  llm: { systemOne: false, llm: true },
};

/**
 * A turn's stages. A forced turn is known when it opens, so the card never switches at commit.
 * Without a policy they're inferred from the ply; missing calls never mean the LLM didn't run.
 */
export function stagesOf(policy: Policy | null, turn: TurnRecord | null, ply: Ply | null): Stages {
  if (turn?.initial_allowed.length === 1 || ply?.source === "forced") return { kind: "forced" };
  if (policy) return { kind: "pipeline", ...PIPELINES[policy], certain: true };
  return {
    kind: "pipeline",
    systemOne: ply !== null && systemOneMeta(ply) !== null,
    llm: ply?.source === "llm" || (turn?.calls.some((c) => c.kind === "llm") ?? false),
    certain: false,
  };
}

/** An agent ply as the card shows it: with its turn, the position it was chosen from, and stages. */
export function replyOf(
  ply: Ply,
  turns: readonly TurnRecord[],
  fens: readonly string[],
  policy: Policy | null,
): Reply {
  const turn = turnOf(ply, turns);
  return { ply, turn, fenBefore: fens[ply.ply], stages: stagesOf(policy, turn, ply) };
}

/** The reply that led to position `index`: the latest agent ply before it, or null. */
export function replyAt(
  plies: readonly Ply[],
  turns: readonly TurnRecord[],
  fens: readonly string[],
  index: number,
  policy: Policy | null,
): Reply | null {
  const ply = plies.findLast((p) => p.ply < index && p.source !== "external");
  return ply ? replyOf(ply, turns, fens, policy) : null;
}

/** System 1's live result, only while its turn is the last one and still pending. */
export function liveSystemOne(
  values: Pick<ChessValues, "turns" | "systemone_live">,
): SystemOneLive | null {
  const live = values.systemone_live;
  const last = values.turns?.at(-1);
  return live && last?.status === "pending" && live.turn_id === last.id ? live : null;
}

export type StageStatus = "waiting" | "running" | "done" | "skipped" | "not-needed" | "failed";

export interface StageStatuses {
  /** Null where the turn has no such stage. */
  systemOne: StageStatus | null;
  llm: StageStatus | null;
}

const NO_STAGES: StageStatuses = { systemOne: null, llm: null };

/**
 * Where each stage stands. A stopped turn whose System 1 already played keeps System 1 done and
 * the LLM not needed: the run can fail while finalizing a decision that succeeded.
 */
export function stageStatuses(reply: ReplyState): StageStatuses {
  if (reply.status === "none" || reply.status === "external") return NO_STAGES;
  const stages = reply.status === "played" ? reply.reply.stages : reply.stages;
  if (stages.kind === "forced") return NO_STAGES;
  if (reply.status === "played") {
    const { ply, turn } = reply.reply;
    const meta = systemOneMeta(ply);
    // An LLM that ran and was overruled (a book move, say) still ran.
    const ran = ply.source === "llm" || (turn?.calls.some((c) => c.kind === "llm") ?? false);
    return {
      systemOne: stages.systemOne ? (meta?.status === "skipped" ? "skipped" : "done") : null,
      llm: stages.llm ? (ran ? "done" : "not-needed") : null,
    };
  }
  const live = reply.systemOne;
  const stopped = reply.activity === "stopped";
  const systemOne = (): StageStatus => {
    if (live) return live.status === "skipped" ? "skipped" : "done";
    return stopped ? "failed" : "running";
  };
  const llm = (): StageStatus => {
    if (live?.status === "played") return "not-needed";
    if (stopped) return "failed";
    return stages.systemOne && !live ? "waiting" : "running";
  };
  return {
    systemOne: stages.systemOne ? systemOne() : null,
    llm: stages.llm ? llm() : null,
  };
}
