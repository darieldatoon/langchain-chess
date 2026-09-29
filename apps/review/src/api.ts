// The LangSmith API as the app uses it. `call` is `window.langsmith.call`, injected for tests.
import { analyze, marksByRun, STATUS_KEY, type Launch, type Target } from "./analysis";
import { toGame, type Game, type RootRun, type ThreadItem } from "./games";
import { REVIEW_KEY, reviewsByRun, type FeedbackItem } from "./review";

export type Call = (
  operation: string,
  args?: { params?: Record<string, string | string[]>; body?: unknown },
) => Promise<unknown>;

export interface Project {
  id: string;
  name: string;
}

/** The deployment's project first, then any other chess project, then the most recent. */
export function defaultProject(projects: readonly Project[]): string | null {
  const pick =
    projects.find((p) => p.name === "langchain-chess-app") ??
    projects.find((p) => p.name.includes("chess")) ??
    projects[0];
  return pick?.id ?? null;
}

export interface GamesPage {
  games: Game[];
  cursor: string | null;
}

/** The next page after the loaded ones; a game that moved up a page isn't listed twice. */
export function appended(loaded: GamesPage, next: GamesPage): GamesPage {
  const seen = new Set(loaded.games.map((g) => g.threadId));
  return {
    games: [...loaded.games, ...next.games.filter((g) => !seen.has(g.threadId))],
    cursor: next.cursor,
  };
}

export interface Pages extends GamesPage {
  pages: number;
}

/**
 * The first `pages` pages of a query, as one, and more until `keep` is among them: a refresh
 * reloads every page on screen, and new games may have pushed the open one further down.
 */
export async function firstPages(
  api: Pick<Api, "games">,
  projectId: string,
  since: string,
  pages: number,
  keep: string | null = null,
): Promise<Pages> {
  let loaded: Pages = { ...(await api.games(projectId, since)), pages: 1 };
  const missing = () => keep !== null && !loaded.games.some((g) => g.threadId === keep);
  while (loaded.cursor && (loaded.pages < pages || missing())) {
    const next = await api.games(projectId, since, loaded.cursor);
    loaded = { ...appended(loaded, next), pages: loaded.pages + 1 };
  }
  return loaded;
}

/** A run of a game's thread, to open in LangSmith; the start time only speeds up the lookup. */
export type TraceTarget = Pick<Target, "threadId" | "runId" | "runStartTime">;

/**
 * The thread view's UI parameters: its Trace tab, scrolled to the run's output. LangSmith's UI
 * reads them; they aren't a documented API.
 */
const THREAD_VIEW = { conversationTab: "trace", scroll_to: "output" };

/** The `/o/<org>/projects/p/<project>` a run link starts with, after any base path. */
const RUN_LINK = /^(.*\/o\/[^/]+\/projects\/p\/[^/]+)\/trace\//;

/** The thread link that shares `runUrl`'s host and project, or `runUrl` itself if it isn't one. */
export function threadUrl(runUrl: string, target: TraceTarget): string {
  let url: URL;
  try {
    url = new URL(runUrl);
  } catch {
    return runUrl;
  }
  const project = RUN_LINK.exec(url.pathname)?.[1];
  if (!project) return runUrl;
  const params = new URLSearchParams({
    run_id: target.runId,
    ...THREAD_VIEW,
    ...(target.runStartTime && { start_time: target.runStartTime }),
  });
  return `${url.origin}${project}/t/${encodeURIComponent(target.threadId)}?${params}`;
}

export interface Api {
  projects(): Promise<Project[]>;
  games(projectId: string, since: string, cursor?: string | null): Promise<GamesPage>;
  traceUrl(projectId: string, target: TraceTarget): Promise<string>;
  analyze(target: Target, launch: Launch): Promise<void>;
}

const PAGE_SIZE = 20;
const RUN_SELECTS = ["ID", "TRACE_ID", "START_TIME", "METADATA", "OUTPUTS"];

export function createApi(call: Call): Api {
  return {
    async projects() {
      const items = (await call("GET /api/v1/sessions", {
        params: { limit: "100", sort_by: "last_run_start_time", sort_by_desc: "true" },
      })) as Project[];
      return items.map(({ id, name }) => ({ id, name }));
    },

    /** One page of threads, their last root runs, and this grader's reviews and marks on them. */
    async games(projectId, since, cursor = null) {
      const page = (await call("POST /api/v2/threads/query", {
        body: {
          project_id: projectId,
          min_start_time: since,
          page_size: PAGE_SIZE,
          ...(cursor && { cursor }),
        },
      })) as { items: ThreadItem[]; next_cursor: string | null };
      const ids = page.items.map((t) => t.last_trace_id);
      if (ids.length === 0) return { games: [], cursor: null };
      const [runs, feedback] = await Promise.all([
        call("POST /api/v2/runs/query", {
          body: {
            project_ids: [projectId],
            ids,
            is_root: true,
            // Without a lower bound the query counts as a large window and is rate-limited harder.
            min_start_time: since,
            selects: RUN_SELECTS,
            page_size: PAGE_SIZE,
          },
        }) as Promise<{ items: RootRun[] }>,
        call("GET /api/v1/feedback", {
          params: { run: ids, key: [REVIEW_KEY, STATUS_KEY], limit: "100" },
        }) as Promise<FeedbackItem[]>,
      ]);
      const byId = new Map(runs.items.map((r) => [r.id, r]));
      const reviews = reviewsByRun(feedback);
      const marks = marksByRun(feedback);
      return {
        games: page.items.map((t) =>
          toGame(
            t,
            byId.get(t.last_trace_id),
            reviews.get(t.last_trace_id),
            marks.get(t.last_trace_id),
          ),
        ),
        cursor: page.next_cursor,
      };
    },

    /**
     * The game's thread at the run. The run's link is resolved server-side, so the host and
     * workspace are right on any deployment; the endpoint has no form for a thread.
     */
    async traceUrl(projectId, target) {
      const { url } = (await call(`GET /api/v2/runs/${target.runId}/url`, {
        params: { project_id: projectId, trace_id: target.runId },
      })) as { url: string };
      return threadUrl(url, target);
    },

    analyze: (target, launch) => analyze(call, target, launch),
  };
}
