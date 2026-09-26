// The Analyze button: mark the game, start a grader sandbox, launch `lcchess grade` in it, and
// let go. The job settles the mark and deletes its sandbox
// (libs/cli/langchain_chess_cli/grade/job.py); this app only reads the mark.
import type { Call } from "./api";
import { GRADER, type FeedbackItem } from "./review";

export const STATUS_KEY = "grade_status";
export const SNAPSHOT = "langchain-chess-grader";
/** An `analyzing` mark older than this belongs to a job that died without reporting. */
export const STALL_MS = 10 * 60 * 1000;

/** The mark as the grader leaves it: `analyzing` until the job fails it or clears it. */
export type Mark =
  | { status: "analyzing"; id: string; startedAt: string }
  | { status: "failed"; id: string; log: string };

export type Analysis =
  | { status: "analyzing" }
  | { status: "stalled"; mark: Mark }
  | { status: "failed"; mark: Mark; log: string };

function toMark(item: FeedbackItem): Mark | null {
  if (!item.id) return null;
  if (item.value === "analyzing" && item.created_at) {
    return { status: "analyzing", id: item.id, startedAt: item.created_at };
  }
  if (item.value === "failed") return { status: "failed", id: item.id, log: item.comment ?? "" };
  return null;
}

/** This grader's newest mark on each run. */
export function marksByRun(items: readonly FeedbackItem[]): Map<string, Mark> {
  const newest = new Map<string, { at: string; mark: Mark }>();
  for (const item of items) {
    const ours = item.feedback_source?.metadata?.grader === GRADER;
    const mark = item.key === STATUS_KEY && ours && item.run_id ? toMark(item) : null;
    const at = item.created_at ?? "";
    const seen = item.run_id ? newest.get(item.run_id) : undefined;
    if (mark && item.run_id && (!seen || at >= seen.at)) newest.set(item.run_id, { at, mark });
  }
  return new Map([...newest].map(([run, { mark }]) => [run, mark]));
}

export function analysisOf(mark: Mark | null, now: Date): Analysis | null {
  if (!mark) return null;
  if (mark.status === "failed") return { status: "failed", mark, log: mark.log };
  const age = now.getTime() - new Date(mark.startedAt).getTime();
  return age > STALL_MS ? { status: "stalled", mark } : { status: "analyzing" };
}

export interface Target {
  projectId: string;
  projectName: string;
  threadId: string;
  runId: string;
  runStartTime: string | null;
}

export interface Launch {
  /** Re-grade a game graded with the same settings. */
  force: boolean;
  /** The mark of a job that failed or stalled, replaced by this one. */
  previous: Mark | null;
}

/** One per game, so a second start on the same game conflicts instead of running twice. */
export function sandboxName(threadId: string): string {
  const safe = threadId.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  return `lcchess-grade-${safe}`.slice(0, 63).replace(/-+$/, "");
}

const quote = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;

/** Detached and silent: the job must outlive `execute`, which ends its process group. */
export function gradeCommand(target: Target, force: boolean): string {
  const args = [
    "lcchess grade",
    `--project ${quote(target.projectName)}`,
    `--thread ${quote(target.threadId)}`,
    "--workers 4",
    ...(force ? ["--force"] : []),
    "--sandbox-job",
  ];
  return `nohup setsid ${args.join(" ")} </dev/null >/tmp/grade.log 2>&1 &`;
}

const BOXES = "/api/v2/sandboxes/boxes";
// What `lcchess grade --sandbox-job` does as the viewer: read the game, replace its feedback,
// settle the mark, delete its sandbox. A ceiling on the viewer's own access, never more.
const PERMISSIONS = [
  "projects:read",
  "runs:read",
  "runs:read-outputs",
  "feedback:read",
  "feedback:create",
  "feedback:update",
  "feedback:delete",
  "sandboxes:delete",
];
const POLLS = 10;
const POLL_MS = 1000;

const text = (error: unknown) => (error instanceof Error ? error.message : String(error));
const missing = (error: unknown) => /not found/i.test(text(error));

/** The bridge passes on only the error's message, so the cause is read from its words. */
export function explain(error: unknown): string {
  const message = text(error);
  if (/not enabled/i.test(message)) return "Sandboxes aren't enabled for this organization.";
  if (/snapshot .*not found/i.test(message)) {
    return `The ${SNAPSHOT} snapshot isn't in this workspace: run mise run review:snapshot.`;
  }
  if (/limit of .*exceeded/i.test(message)) {
    return "The organization's sandbox limit is reached. Try again when a sandbox frees up.";
  }
  if (/already exists/i.test(message)) return "This game is already being analyzed.";
  if (/forbidden|insufficient|permission/i.test(message)) {
    return `Your role doesn't allow it (${message}).`;
  }
  return message;
}

type Sleep = (ms: number) => Promise<void>;
const sleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function boxStatus(call: Call, name: string): Promise<string | null> {
  try {
    const { status } = (await call(`GET ${BOXES}/${name}/status`)) as { status: string };
    return status;
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}

async function until(done: () => Promise<boolean>, wait: Sleep, failure: string) {
  for (let i = 0; i < POLLS; i++) {
    if (await done()) return;
    await wait(POLL_MS);
  }
  throw new Error(failure);
}

async function ignoreMissing(request: Promise<unknown>) {
  try {
    await request;
  } catch (error) {
    if (!missing(error)) throw error;
  }
}

/** Resolves once the job is running; the mark is the only way to follow it from there. */
export async function analyze(
  call: Call,
  target: Target,
  { force, previous }: Launch,
  wait: Sleep = sleep,
): Promise<void> {
  const name = sandboxName(target.threadId);
  if (previous) {
    // The last job never reported, and its sandbox may still hold the name.
    await ignoreMissing(call(`DELETE ${BOXES}/${name}`));
    await until(
      async () => (await boxStatus(call, name)) === null,
      wait,
      "The last analysis's sandbox is still shutting down. Retry in a minute.",
    );
    await ignoreMissing(call(`DELETE /api/v1/feedback/${previous.id}`));
  }
  let mark: { id: string };
  try {
    mark = (await call("POST /api/v1/feedback", {
      body: {
        run_id: target.runId,
        session_id: target.projectId,
        ...(target.runStartTime && { start_time: target.runStartTime }),
        key: STATUS_KEY,
        value: "analyzing",
        feedback_source: { type: "api", metadata: { grader: GRADER } },
      },
    })) as { id: string };
  } catch (error) {
    throw new Error(`Couldn't mark the game as analyzing: ${explain(error)}`);
  }

  let mayExist = false;
  try {
    try {
      await call(`POST ${BOXES}`, {
        body: {
          name,
          snapshot_name: SNAPSHOT,
          vcpus: 4,
          mem_bytes: 8 * 1024 ** 3,
          // Only requests into the sandbox count as activity, and nothing sends any while the
          // job runs: the job deletes the sandbox, and this TTL is only the backstop.
          idle_ttl_seconds: 900,
          delete_after_stop_seconds: 60,
          access_delegation: { mode: "EXPLICIT", permissions: PERMISSIONS },
        },
      });
    } catch (error) {
      // The bridge gives up after 10 s, but the server goes on booting the sandbox.
      if (!/timed out/i.test(text(error))) throw error;
    }
    mayExist = true;
    await until(
      async () => {
        const status = await boxStatus(call, name);
        if (status === "failed") throw new Error("The grader sandbox failed to start.");
        return status === "ready";
      },
      wait,
      "The grader sandbox didn't start in time.",
    );
    const result = (await call(`POST /api/v2/sandboxes/${name}/execute`, {
      body: { command: gradeCommand(target, force), timeout_seconds: 8 },
    })) as { exit_code: number; stderr: string };
    if (result.exit_code !== 0) {
      throw new Error(`The grader didn't launch: ${result.stderr.trim() || result.exit_code}`);
    }
  } catch (error) {
    await Promise.allSettled([
      call(`DELETE /api/v1/feedback/${mark.id}`),
      ...(mayExist ? [call(`DELETE ${BOXES}/${name}`)] : []),
    ]);
    throw new Error(explain(error));
  }
}

/** A click's progress in this tab, until the mark it wrote is loaded. */
export type LaunchState =
  | { status: "starting" }
  | { status: "started" }
  | { status: "error"; message: string };
