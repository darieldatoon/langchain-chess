import { describe, expect, it } from "vite-plus/test";
import { DEFAULT_CONTEXT } from "../src/generated/settings";
import { liveSystemOne, recordedPolicy, replyAt, stageStatuses, stagesOf } from "../src/stages";
import { call, live, ply, systemOne, turn } from "../src/testing";
import type { ReplyState, Stages, SystemOneLive } from "../src/types";

const HYBRID: Stages = { kind: "pipeline", systemOne: true, llm: true, certain: true };
const S1_ONLY: Stages = { kind: "pipeline", systemOne: true, llm: false, certain: true };
const LLM_ONLY: Stages = { kind: "pipeline", systemOne: false, llm: true, certain: true };
const meta = (m = systemOne()) => ({ SystemOneMiddleware: { ...m } });

describe("recordedPolicy", () => {
  it("reads the recorded policy, and nothing from a bad or absent setup", () => {
    expect(recordedPolicy({ ...DEFAULT_CONTEXT, policy: "llm" })).toBe("llm");
    expect(recordedPolicy(undefined)).toBeNull();
    expect(recordedPolicy({ policy: "hybrid" })).toBeNull();
  });
});

describe("stagesOf", () => {
  it("maps each policy to its stages", () => {
    expect(stagesOf("hybrid", null, null)).toEqual(HYBRID);
    expect(stagesOf("systemone", null, null)).toEqual(S1_ONLY);
    expect(stagesOf("llm", null, null)).toEqual(LLM_ONLY);
  });

  it("knows a forced turn from the moment it opens, and from a forced ply", () => {
    expect(stagesOf("hybrid", turn({ initial_allowed: ["e7e5"] }), null)).toEqual({
      kind: "forced",
    });
    expect(stagesOf(null, null, ply({ source: "forced" }))).toEqual({ kind: "forced" });
  });

  it("infers uncertain stages from the ply without a policy", () => {
    const uncertain = (systemOne: boolean, llm: boolean) => ({
      kind: "pipeline",
      systemOne,
      llm,
      certain: false,
    });
    expect(stagesOf(null, null, ply({ source: "systemone", meta: meta() }))).toEqual(
      uncertain(true, false),
    );
    expect(stagesOf(null, null, ply({ source: "llm" }))).toEqual(uncertain(false, true));
    // A book move after an LLM call that the book overrode: the LLM still ran.
    expect(stagesOf(null, turn({ calls: [call()] }), ply({ source: "book" }))).toEqual(
      uncertain(false, true),
    );
    expect(stagesOf(null, null, null)).toEqual(uncertain(false, false));
  });
});

describe("replyAt", () => {
  const fens = ["f0", "f1", "f2", "f3"];
  const plies = [
    ply(),
    ply({ ply: 1, side: "black", source: "systemone", turn_id: "turn-1" }),
    ply({ ply: 2, san: "Nf3" }),
  ];
  const turns = [turn()];

  it("is the latest agent reply before the position, with its turn, position and stages", () => {
    expect(replyAt(plies, turns, fens, 3, "hybrid")).toEqual({
      ply: plies[1],
      turn: turns[0],
      fenBefore: "f1",
      stages: HYBRID,
    });
    expect(replyAt(plies, turns, fens, 2, null)?.ply).toBe(plies[1]);
  });

  it("is null at the start and before any agent move", () => {
    expect(replyAt(plies, turns, fens, 0, null)).toBeNull();
    expect(replyAt(plies, turns, fens, 1, null)).toBeNull();
  });
});

describe("liveSystemOne", () => {
  it("is the live result only while its turn is the last one and pending", () => {
    const result = live();
    const pending = turn({ status: "pending" });
    expect(liveSystemOne({ turns: [pending], systemone_live: result })).toBe(result);
    expect(liveSystemOne({ turns: [turn()], systemone_live: result })).toBeNull();
    expect(liveSystemOne({ turns: [pending], systemone_live: live({ turn_id: "old" }) })).toBe(
      null,
    );
    expect(liveSystemOne({ turns: [], systemone_live: result })).toBeNull();
    expect(liveSystemOne({ turns: [pending] })).toBeNull();
  });
});

function pending(
  stages: Stages,
  activity: "running" | "stopped",
  systemOne: SystemOneLive | null = null,
): ReplyState {
  return {
    status: "pending",
    activity,
    error: null,
    turn: turn({ status: "pending" }),
    systemOne,
    analysis: null,
    fenBefore: "f",
    stages,
  };
}

function played(stages: Stages, source: string, m = systemOne()): ReplyState {
  return {
    status: "played",
    reply: { ply: ply({ source, meta: meta(m) }), turn: turn(), fenBefore: "f", stages },
  };
}

describe("stageStatuses", () => {
  it("has no stages before a reply, for an external move, or for a forced one", () => {
    const none = { systemOne: null, llm: null };
    expect(stageStatuses({ status: "none" })).toEqual(none);
    expect(stageStatuses({ status: "external", ply: ply(), fenBefore: "f", label: "x" })).toEqual(
      none,
    );
    expect(stageStatuses(pending({ kind: "forced" }, "running"))).toEqual(none);
  });

  it("runs System 1, then the LLM, in a hybrid turn", () => {
    expect(stageStatuses(pending(HYBRID, "running"))).toEqual({
      systemOne: "running",
      llm: "waiting",
    });
    expect(stageStatuses(pending(HYBRID, "running", live()))).toEqual({
      systemOne: "done",
      llm: "running",
    });
    expect(stageStatuses(pending(HYBRID, "running", live({ status: "played" })))).toEqual({
      systemOne: "done",
      llm: "not-needed",
    });
    expect(stageStatuses(pending(HYBRID, "running", live({ status: "skipped" })))).toEqual({
      systemOne: "skipped",
      llm: "running",
    });
    expect(stageStatuses(pending(LLM_ONLY, "running"))).toEqual({
      systemOne: null,
      llm: "running",
    });
  });

  it("keeps a stopped turn's System 1 decision, and fails only what didn't finish", () => {
    // The run can fail finalizing a decision that succeeded: the LLM was still not needed.
    expect(stageStatuses(pending(HYBRID, "stopped", live({ status: "played" })))).toEqual({
      systemOne: "done",
      llm: "not-needed",
    });
    expect(stageStatuses(pending(HYBRID, "stopped", live()))).toEqual({
      systemOne: "done",
      llm: "failed",
    });
    expect(stageStatuses(pending(LLM_ONLY, "stopped"))).toEqual({
      systemOne: null,
      llm: "failed",
    });
    expect(stageStatuses(pending(S1_ONLY, "stopped"))).toEqual({
      systemOne: "failed",
      llm: null,
    });
  });

  it("reads a committed move's stages from its ply", () => {
    expect(stageStatuses(played(HYBRID, "systemone"))).toEqual({
      systemOne: "done",
      llm: "not-needed",
    });
    expect(stageStatuses(played(HYBRID, "llm", systemOne({ status: "skipped" })))).toEqual({
      systemOne: "skipped",
      llm: "done",
    });
    expect(stageStatuses(played(S1_ONLY, "systemone"))).toEqual({
      systemOne: "done",
      llm: null,
    });
    expect(stageStatuses(played(LLM_ONLY, "llm"))).toEqual({ systemOne: null, llm: "done" });
    const unranked: ReplyState = {
      status: "played",
      reply: { ply: ply({ source: "llm" }), turn: null, fenBefore: "f", stages: HYBRID },
    };
    expect(stageStatuses(unranked)).toEqual({ systemOne: "done", llm: "done" });
    // A book move after an LLM call that the book overruled: the LLM still ran.
    const overruled: ReplyState = {
      status: "played",
      reply: {
        ply: ply({ source: "book" }),
        turn: turn({ calls: [call()] }),
        fenBefore: "f",
        stages: LLM_ONLY,
      },
    };
    expect(stageStatuses(overruled)).toEqual({ systemOne: null, llm: "done" });
    expect(stageStatuses(played({ kind: "forced" }, "forced"))).toEqual({
      systemOne: null,
      llm: null,
    });
  });
});
