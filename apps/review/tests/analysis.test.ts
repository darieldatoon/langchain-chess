import { describe, expect, it, vi } from "vite-plus/test";
import {
  analysisOf,
  analyze,
  explain,
  gradeCommand,
  marksByRun,
  sandboxName,
  STALL_MS,
  type Mark,
  type Target,
} from "../src/analysis";
import { createApi } from "../src/api";
import { reviewFeedback, statusFeedback } from "./support/fixtures";

const NOW = new Date("2026-09-25T12:00:00Z");
const TARGET: Target = {
  projectId: "p1",
  projectName: "langchain-chess-app",
  threadId: "01a0dc23-15b8-7960-8f23-4079156516c0",
  runId: "run-3",
  runStartTime: "2026-09-25T11:00:00Z",
};
const BOX = "lcchess-grade-01a0dc23-15b8-7960-8f23-4079156516c0";
const BOXES = "/api/v2/sandboxes/boxes";

describe("marks", () => {
  it("keeps this grader's newest readable mark on each run", () => {
    const marks = marksByRun([
      statusFeedback("r1", "analyzing", { id: "old", createdAt: "2026-09-25T11:00:00Z" }),
      statusFeedback("r1", "failed", { id: "new", createdAt: "2026-09-25T11:30:00Z" }),
      statusFeedback("r1", "analyzing", { id: "older", createdAt: "2026-09-25T10:00:00Z" }),
      statusFeedback("r2", "failed", { id: "f", comment: "engine died" }),
      statusFeedback("r3", "analyzing", {}, "someone else"),
      statusFeedback("r4", "queued"),
      { ...statusFeedback("r5", "analyzing"), created_at: undefined },
      { ...statusFeedback("r6", "analyzing"), id: undefined },
      { ...statusFeedback("r7", "failed"), comment: undefined, created_at: undefined },
      { ...statusFeedback("r8", "failed"), run_id: null },
      reviewFeedback("r9"),
    ]);
    expect(Object.fromEntries(marks)).toEqual({
      r1: { status: "failed", id: "new", log: "" },
      r2: { status: "failed", id: "f", log: "engine died" },
      r7: { status: "failed", id: "r7-mark", log: "" },
    });
  });

  it("reads a mark as analyzing, stalled or failed", () => {
    const at = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
    const running: Mark = { status: "analyzing", id: "m", startedAt: at(STALL_MS) };
    const stalled: Mark = { status: "analyzing", id: "m", startedAt: at(STALL_MS + 1) };
    const failed: Mark = { status: "failed", id: "m", log: "boom" };
    expect(analysisOf(null, NOW)).toBeNull();
    expect(analysisOf(running, NOW)).toEqual({ status: "analyzing" });
    expect(analysisOf(stalled, NOW)).toEqual({ status: "stalled", mark: stalled });
    expect(analysisOf(failed, NOW)).toEqual({ status: "failed", mark: failed, log: "boom" });
  });

  it("reads marks along with the page's reviews", async () => {
    const call = vi.fn(async (operation: string): Promise<unknown> => {
      if (operation === "POST /api/v2/threads/query") {
        return {
          items: [
            {
              thread_id: "a",
              count: 1,
              min_start_time: "",
              max_start_time: "",
              last_trace_id: "r",
            },
          ],
        };
      }
      if (operation === "POST /api/v2/runs/query") {
        return { items: [{ id: "r", trace_id: "r", start_time: "2026-09-25T11:00:00Z" }] };
      }
      return [statusFeedback("r", "failed", { id: "m" })];
    });
    const [g] = (await createApi(call).games("p1", "2026-09-18T00:00:00Z")).games;
    expect(g.mark).toEqual({ status: "failed", id: "m", log: "" });
    expect(g.lastRunStartTime).toBe("2026-09-25T11:00:00Z");
    expect(call).toHaveBeenCalledWith("GET /api/v1/feedback", {
      params: { run: ["r"], key: ["game_review", "grade_status"], limit: "100", offset: "0" },
    });
  });
});

describe("the launch", () => {
  it("names one sandbox per game, within the name rules", () => {
    expect(sandboxName(TARGET.threadId)).toBe(BOX);
    const long = sandboxName(`${"A_".repeat(24)}-tail`);
    expect(long).toMatch(/^[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/);
    expect(long.length).toBeLessThanOrEqual(63);
  });

  it("launches the grader detached, quoting what it's given", () => {
    expect(gradeCommand(TARGET, false)).toBe(
      "nohup setsid lcchess grade --project 'langchain-chess-app' " +
        "--thread '01a0dc23-15b8-7960-8f23-4079156516c0' --workers 4 --sandbox-job " +
        "</dev/null >/tmp/grade.log 2>&1 &",
    );
    const odd = gradeCommand({ ...TARGET, projectName: "it's $HOME" }, true);
    expect(odd).toContain(`--project 'it'\\''s $HOME'`);
    expect(odd).toContain("--workers 4 --force --sandbox-job");
  });

  it("explains why a sandbox couldn't start", () => {
    expect(explain(new Error("Sandbox feature is not enabled for this organization"))).toBe(
      "Sandboxes aren't enabled for this organization.",
    );
    expect(explain(new Error('snapshot "langchain-chess-grader:latest" not found'))).toMatch(
      /mise run review:snapshot/,
    );
    expect(
      explain(new Error("Limit of 10 sandbox(es) per organization exceeded. Current usage: 10")),
    ).toMatch(/sandbox limit is reached/);
    expect(explain(new Error("Sandbox 'x' already exists"))).toBe(
      "This game is already being analyzed.",
    );
    expect(explain(new Error("Forbidden"))).toBe("Your role doesn't allow it (Forbidden).");
    expect(explain("socket hang up")).toBe("socket hang up");
  });
});

type Handler = (args?: { params?: unknown; body?: unknown }) => unknown;

/** A LangSmith that answers by operation, and logs every call. */
function fakeCall(handlers: Record<string, Handler>) {
  const log: string[] = [];
  const bodies: Record<string, unknown> = {};
  const call = vi.fn(async (operation: string, args?: { params?: unknown; body?: unknown }) => {
    log.push(operation);
    bodies[operation] = args?.body;
    const handler = handlers[operation];
    if (!handler) throw new Error(`unexpected ${operation}`);
    return handler(args);
  });
  return { call, log, bodies };
}

const fail = (message: string) => () => {
  throw new Error(message);
};
const HAPPY: Record<string, Handler> = {
  "POST /api/v1/feedback": () => ({ id: "mark-1" }),
  [`POST ${BOXES}`]: () => ({ status: "ready" }),
  [`GET ${BOXES}/${BOX}/status`]: () => ({ status: "ready" }),
  [`POST /api/v2/sandboxes/${BOX}/execute`]: () => ({ exit_code: 0, stderr: "" }),
  [`DELETE ${BOXES}/${BOX}`]: () => null,
  "DELETE /api/v1/feedback/mark-1": () => null,
};
const noWait = () => Promise.resolve();

describe("analyze", () => {
  it("marks the game, starts a delegated sandbox, and launches the grader", async () => {
    const { call, log, bodies } = fakeCall(HAPPY);
    await analyze(call, TARGET, { force: false, previous: null }, noWait);
    expect(log).toEqual([
      "POST /api/v1/feedback",
      `POST ${BOXES}`,
      `GET ${BOXES}/${BOX}/status`,
      `POST /api/v2/sandboxes/${BOX}/execute`,
    ]);
    expect(bodies["POST /api/v1/feedback"]).toEqual({
      run_id: "run-3",
      session_id: "p1",
      start_time: "2026-09-25T11:00:00Z",
      key: "grade_status",
      value: "analyzing",
      feedback_source: { type: "api", metadata: { grader: "lcchess grade" } },
    });
    expect(bodies[`POST ${BOXES}`]).toMatchObject({
      name: BOX,
      snapshot_name: "langchain-chess-grader",
      vcpus: 4,
      idle_ttl_seconds: 900,
      access_delegation: {
        mode: "EXPLICIT",
        permissions: expect.arrayContaining(["feedback:create", "workspaces:read"]),
      },
    });
    expect(bodies[`POST /api/v2/sandboxes/${BOX}/execute`]).toEqual({
      command: gradeCommand(TARGET, false),
      timeout_seconds: 8,
    });
  });

  it("marks a run whose start time is unknown", async () => {
    const { call, bodies } = fakeCall(HAPPY);
    await analyze(call, { ...TARGET, runStartTime: null }, { force: true, previous: null }, noWait);
    expect(bodies["POST /api/v1/feedback"]).not.toHaveProperty("start_time");
  });

  it("waits out a create the bridge gave up on while the sandbox boots", async () => {
    const statuses = ["provisioning", "ready"];
    const { call, log } = fakeCall({
      ...HAPPY,
      [`POST ${BOXES}`]: fail("LangSmith API call timed out"),
      [`GET ${BOXES}/${BOX}/status`]: () => ({ status: statuses.shift() }),
    });
    const wait = vi.fn(noWait);
    await analyze(call, TARGET, { force: false, previous: null }, wait);
    expect(log.filter((op) => op.endsWith("/status"))).toHaveLength(2);
    expect(wait).toHaveBeenCalledOnce();
  });

  it("clears its mark and its sandbox when the sandbox fails to start", async () => {
    const { call, log } = fakeCall({
      ...HAPPY,
      [`GET ${BOXES}/${BOX}/status`]: () => ({ status: "failed" }),
    });
    await expect(analyze(call, TARGET, { force: false, previous: null }, noWait)).rejects.toThrow(
      "The grader sandbox failed to start.",
    );
    expect(log.slice(-2).sort()).toEqual(
      ["DELETE /api/v1/feedback/mark-1", `DELETE ${BOXES}/${BOX}`].sort(),
    );
  });

  it("gives up on a sandbox that never comes up", async () => {
    const { call, log } = fakeCall({
      ...HAPPY,
      [`GET ${BOXES}/${BOX}/status`]: fail(`Sandbox '${BOX}' not found`),
    });
    await expect(analyze(call, TARGET, { force: false, previous: null }, noWait)).rejects.toThrow(
      "The grader sandbox didn't start in time.",
    );
    expect(log.filter((op) => op.endsWith("/status"))).toHaveLength(10);
  });

  it("reports a launch that exits with an error", async () => {
    const execute = `POST /api/v2/sandboxes/${BOX}/execute`;
    const { call } = fakeCall({
      ...HAPPY,
      [execute]: () => ({ exit_code: 127, stderr: "nope\n" }),
    });
    await expect(analyze(call, TARGET, { force: false, previous: null }, noWait)).rejects.toThrow(
      "The grader didn't launch: nope",
    );
    const silent = fakeCall({ ...HAPPY, [execute]: () => ({ exit_code: 2, stderr: "" }) });
    await expect(
      analyze(silent.call, TARGET, { force: false, previous: null }, noWait),
    ).rejects.toThrow("The grader didn't launch: 2");
  });

  it("leaves another viewer's sandbox alone and explains the conflict", async () => {
    const { call, log } = fakeCall({
      ...HAPPY,
      [`POST ${BOXES}`]: fail(`Sandbox '${BOX}' already exists`),
    });
    await expect(analyze(call, TARGET, { force: false, previous: null }, noWait)).rejects.toThrow(
      "This game is already being analyzed.",
    );
    expect(log).not.toContain(`DELETE ${BOXES}/${BOX}`);
    expect(log.at(-1)).toBe("DELETE /api/v1/feedback/mark-1");
  });

  it("reports a status read that fails outright", async () => {
    const { call } = fakeCall({ ...HAPPY, [`GET ${BOXES}/${BOX}/status`]: fail("Forbidden") });
    await expect(analyze(call, TARGET, { force: false, previous: null }, noWait)).rejects.toThrow(
      "Your role doesn't allow it (Forbidden).",
    );
  });

  it("stops before anything else when the viewer can't write feedback", async () => {
    const { call, log } = fakeCall({ ...HAPPY, "POST /api/v1/feedback": fail("Forbidden") });
    await expect(analyze(call, TARGET, { force: false, previous: null }, noWait)).rejects.toThrow(
      "Couldn't mark the game as analyzing: Your role doesn't allow it (Forbidden).",
    );
    expect(log).toEqual(["POST /api/v1/feedback"]);
  });

  it("clears the last job's sandbox and mark before a retry", async () => {
    let gone = false;
    const previous: Mark = { status: "failed", id: "old-mark", log: "" };
    const { call, log } = fakeCall({
      ...HAPPY,
      [`DELETE ${BOXES}/${BOX}`]: () => {
        gone = true;
        return null;
      },
      [`GET ${BOXES}/${BOX}/status`]: () => {
        if (gone) {
          gone = false;
          throw new Error(`Sandbox '${BOX}' not found`);
        }
        return { status: "ready" };
      },
      "DELETE /api/v1/feedback/old-mark": fail("feedback not found"),
    });
    await analyze(call, TARGET, { force: false, previous }, noWait);
    expect(log.slice(0, 4)).toEqual([
      `DELETE ${BOXES}/${BOX}`,
      `GET ${BOXES}/${BOX}/status`,
      "DELETE /api/v1/feedback/old-mark",
      "POST /api/v1/feedback",
    ]);
  });

  it("retries after a sandbox that's already gone, but not past a failed delete", async () => {
    const previous: Mark = { status: "analyzing", id: "old-mark", startedAt: "" };
    const gone = fakeCall({
      ...HAPPY,
      [`DELETE ${BOXES}/${BOX}`]: fail(`Sandbox '${BOX}' not found`),
      [`GET ${BOXES}/${BOX}/status`]: fail(`Sandbox '${BOX}' not found`),
      "DELETE /api/v1/feedback/old-mark": () => null,
    });
    await expect(analyze(gone.call, TARGET, { force: false, previous }, noWait)).rejects.toThrow(
      "The grader sandbox didn't start in time.",
    );
    expect(gone.log).toContain("POST /api/v1/feedback");

    const denied = fakeCall({ ...HAPPY, [`DELETE ${BOXES}/${BOX}`]: fail("Forbidden") });
    await expect(analyze(denied.call, TARGET, { force: false, previous }, noWait)).rejects.toThrow(
      "Forbidden",
    );
    expect(denied.log).toEqual([`DELETE ${BOXES}/${BOX}`]);
  });

  it("waits a bounded time for the last job's sandbox to go", async () => {
    const previous: Mark = { status: "failed", id: "old-mark", log: "" };
    const { call } = fakeCall(HAPPY);
    await expect(analyze(call, TARGET, { force: false, previous }, noWait)).rejects.toThrow(
      /still shutting down/,
    );
  });

  it("sleeps for real between polls by default", async () => {
    vi.useFakeTimers();
    try {
      const statuses = ["provisioning", "ready"];
      const { call } = fakeCall({
        ...HAPPY,
        [`GET ${BOXES}/${BOX}/status`]: () => ({ status: statuses.shift() }),
      });
      const done = analyze(call, TARGET, { force: false, previous: null });
      await vi.advanceTimersByTimeAsync(1000);
      await expect(done).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("goes through the api", async () => {
    const { call, log } = fakeCall(HAPPY);
    await createApi(call).analyze(TARGET, { force: false, previous: null });
    expect(log).toContain(`POST /api/v2/sandboxes/${BOX}/execute`);
  });
});
