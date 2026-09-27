import { Banner } from "@langchain/macaw-components/Banner";
import { EmptyState } from "@langchain/macaw-components/EmptyState";
import { Select } from "@langchain/macaw-components/Select";
import { Text } from "@langchain/macaw-components/Text";
import { DEFAULT_PLY_VIEW, type PlyView } from "@langchain-chess/chess-ui";
import { useEffect, useState } from "react";
import { analysisOf, type LaunchState } from "./analysis";
import { appended, defaultProject, firstPages, type Api, type Pages, type Project } from "./api";
import type { Game } from "./games";
import { GameList } from "./components/GameList";
import { GameView } from "./components/GameView";

interface Props {
  api: Api;
  openUrl: (url: string) => void;
  now?: () => Date;
}

const WINDOWS = [
  { value: "1", label: "Last day" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
];
const DAY_MS = 24 * 60 * 60 * 1000;

const sinceFor = (now: Date, days: string) =>
  new Date(now.getTime() - Number(days) * DAY_MS).toISOString();
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** A loaded page and the query it answers, so a stale answer is never shown for a new query. */
interface Loaded extends Pages {
  key: string;
}

export function App({ api, openUrl, now = () => new Date() }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [days, setDays] = useState("7");
  const [since, setSince] = useState(() => sinceFor(now(), "7"));
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  /** The page being extended by a load-more in flight. */
  const [moreFrom, setMoreFrom] = useState<Loaded | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The sandbox has no localStorage and LangSmith no preferences API: this lasts the session.
  const [view, setView] = useState<PlyView>(DEFAULT_PLY_VIEW);
  // A refresh reloads the pages on screen in place, so the list and the open game stay up
  // meanwhile.
  const [reload, setReload] = useState({ count: 0, pages: 1, keep: null as string | null });
  const [refreshing, setRefreshing] = useState(false);
  const [launches, setLaunches] = useState<Record<string, LaunchState>>({});
  const key = `${projectId}|${since}`;

  useEffect(() => {
    api.projects().then(
      (items) => {
        setProjects(items);
        setProjectId(defaultProject(items));
      },
      (e: unknown) => setError(message(e)),
    );
  }, [api]);

  useEffect(() => {
    if (!projectId) return;
    let current = true;
    firstPages(api, projectId, since, reload.pages, reload.keep).then(
      (page) => {
        if (!current) return;
        setLoaded({ ...page, key: `${projectId}|${since}` });
        setRefreshing(false);
        // The page now carries the marks of the jobs this tab started.
        setLaunches((all) =>
          Object.fromEntries(Object.entries(all).filter(([, l]) => l.status !== "started")),
        );
      },
      (e: unknown) => {
        if (!current) return;
        setError(message(e));
        setRefreshing(false);
      },
    );
    return () => {
      current = false;
    };
  }, [api, projectId, since, reload]);

  // Owned by the query like the first page, so a new query cancels it rather than racing it.
  useEffect(() => {
    if (!projectId || !moreFrom) return;
    let current = true;
    api.games(projectId, since, moreFrom.cursor).then(
      (next) => {
        if (!current) return;
        setLoaded({ ...appended(moreFrom, next), key: moreFrom.key, pages: moreFrom.pages + 1 });
        setMoreFrom(null);
      },
      (e: unknown) => {
        if (!current) return;
        setError(message(e));
        setMoreFrom(null);
      },
    );
    return () => {
      current = false;
    };
  }, [api, projectId, since, moreFrom]);

  const choose = (project: string, window: string) => {
    setProjectId(project);
    setDays(window);
    setSince(sinceFor(now(), window));
    setSelected(null);
    setError(null);
    setMoreFrom(null);
    setReload((r) => ({ ...r, pages: 1, keep: null }));
  };

  const refresh = () => {
    setMoreFrom(null);
    setError(null);
    setRefreshing(true);
    const pages = loaded?.key === key ? loaded.pages : 1;
    setReload((r) => ({ count: r.count + 1, pages, keep: selected }));
  };

  const analyze = (game: Game, project: Project) => {
    const analysis = analysisOf(game.mark, now());
    const launch = (state: LaunchState) =>
      setLaunches((all) => ({ ...all, [game.threadId]: state }));
    launch({ status: "starting" });
    api
      .analyze(
        {
          projectId: project.id,
          projectName: project.name,
          threadId: game.threadId,
          runId: game.lastRunId,
          runStartTime: game.lastRunStartTime,
        },
        {
          force: game.grading.status !== "ungraded",
          previous: analysis && analysis.status !== "analyzing" ? analysis.mark : null,
        },
      )
      .then(
        () => {
          launch({ status: "started" });
          refresh();
        },
        (e: unknown) => launch({ status: "error", message: message(e) }),
      );
  };

  const openRun = (project: string, runId: string) => {
    api.runUrl(project, runId).then(openUrl, (e: unknown) => setError(message(e)));
  };

  const page = loaded?.key === key ? loaded : null;
  const games = page?.games ?? [];
  const game = games.find((g) => g.threadId === selected);
  const project = projects.find((p) => p.id === projectId);
  const loading = (projectId !== null && !page && !error) || moreFrom !== null;

  return (
    <div className="flex h-screen flex-col gap-space-4 bg-surface-level-1 p-space-4">
      <header className="flex flex-wrap items-center justify-between gap-space-3">
        <Text variant="h3" as="h1">
          Game review
        </Text>
        <div className="flex items-center gap-space-2">
          <div className="w-64">
            <Select
              aria-label="Project"
              placeholder="Choose a project"
              options={projects.map((p) => ({ value: p.id, label: p.name }))}
              value={projectId ?? undefined}
              onChange={(value) => value && choose(value, days)}
            />
          </div>
          <div className="w-40">
            <Select
              aria-label="Window"
              hideSearch
              options={WINDOWS}
              value={days}
              onChange={(value) => value && projectId && choose(projectId, value)}
            />
          </div>
        </div>
      </header>
      {error && (
        <Banner intent="error" title="LangSmith request failed">
          {error}
        </Banner>
      )}
      <main className="grid min-h-0 flex-1 gap-space-4 md:grid-cols-[18rem_1fr]">
        <GameList
          games={games}
          selected={selected}
          loading={loading}
          onSelect={setSelected}
          onMore={page?.cursor ? () => setMoreFrom(page) : null}
          onRefresh={refresh}
          refreshing={refreshing}
          now={now()}
        />
        {game?.values && project ? (
          <GameView
            key={game.threadId}
            game={game}
            values={game.values}
            view={view}
            onViewChange={setView}
            onOpenRun={(runId) => openRun(project.id, runId)}
            analysis={analysisOf(game.mark, now())}
            launch={launches[game.threadId]}
            onAnalyze={() => analyze(game, project)}
          />
        ) : (
          <EmptyState
            title={game ? "No game record" : "Pick a game"}
            description={
              game
                ? "The thread's last run carries no game record; it may have errored."
                : "Games are threads in the project; analyze one to grade it."
            }
          />
        )}
      </main>
    </div>
  );
}
