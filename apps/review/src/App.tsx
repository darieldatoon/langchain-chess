import { Banner } from "@langchain/macaw-components/Banner";
import { EmptyState } from "@langchain/macaw-components/EmptyState";
import { Select } from "@langchain/macaw-components/Select";
import { Text } from "@langchain/macaw-components/Text";
import { useEffect, useState } from "react";
import { defaultProject, type Api, type GamesPage, type Project } from "./api";
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
interface Loaded extends GamesPage {
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
    api.games(projectId, since).then(
      (page) => current && setLoaded({ ...page, key: `${projectId}|${since}` }),
      (e: unknown) => current && setError(message(e)),
    );
    return () => {
      current = false;
    };
  }, [api, projectId, since]);

  // Owned by the query like the first page, so a new query cancels it rather than racing it.
  useEffect(() => {
    if (!projectId || !moreFrom) return;
    let current = true;
    api.games(projectId, since, moreFrom.cursor).then(
      (next) => {
        if (!current) return;
        setLoaded({ ...moreFrom, games: [...moreFrom.games, ...next.games], cursor: next.cursor });
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
  };

  const openRun = (project: string, runId: string) => {
    api.runUrl(project, runId).then(openUrl, (e: unknown) => setError(message(e)));
  };

  const page = loaded?.key === key ? loaded : null;
  const games = page?.games ?? [];
  const game = games.find((g) => g.threadId === selected);
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
        />
        {game?.values && projectId ? (
          <GameView
            key={game.threadId}
            game={game}
            values={game.values}
            onOpenRun={(runId) => openRun(projectId, runId)}
          />
        ) : (
          <EmptyState
            title={game ? "No game record" : "Pick a game"}
            description={
              game
                ? "The thread's last run carries no game record; it may have errored."
                : "Games are threads in the project; grade them with lcchess grade."
            }
          />
        )}
      </main>
    </div>
  );
}
