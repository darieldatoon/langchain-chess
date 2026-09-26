// The LangSmith API as the app uses it. `call` is `window.langsmith.call`, injected for tests.
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

export interface Api {
  projects(): Promise<Project[]>;
  games(projectId: string, since: string, cursor?: string | null): Promise<GamesPage>;
  runUrl(projectId: string, runId: string): Promise<string>;
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

    /** One page of threads, their last root runs, and this grader's reviews of them. */
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
          params: { run: ids, key: [REVIEW_KEY], limit: "100" },
        }) as Promise<FeedbackItem[]>,
      ]);
      const byId = new Map(runs.items.map((r) => [r.id, r]));
      const reviews = reviewsByRun(feedback);
      return {
        games: page.items.map((t) =>
          toGame(t, byId.get(t.last_trace_id), reviews.get(t.last_trace_id)),
        ),
        cursor: page.next_cursor,
      };
    },

    /** Resolved server-side, so the host and workspace are right on any deployment. */
    async runUrl(projectId, runId) {
      const { url } = (await call(`GET /api/v2/runs/${runId}/url`, {
        params: { project_id: projectId, trace_id: runId },
      })) as { url: string };
      return url;
    },
  };
}
