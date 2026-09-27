import { Button } from "@langchain/macaw-components/Button";
import { Card } from "@langchain/macaw-components/Card";
import { SkeletonRows } from "@langchain/macaw-components/Skeleton";
import { Text } from "@langchain/macaw-components/Text";
import { cn } from "@langchain/macaw-components/utils/cn";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/dist/ssr/ArrowClockwise";
import { analysisOf, type Analysis } from "../analysis";
import { resultText, type Game } from "../games";
import type { Grading } from "../review";

interface Props {
  games: readonly Game[];
  selected: string | null;
  loading: boolean;
  onSelect: (threadId: string) => void;
  /** Null when there are no more pages. */
  onMore: (() => void) | null;
  onRefresh: () => void;
  refreshing: boolean;
  now: Date;
}

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export function GameList({
  games,
  selected,
  loading,
  onSelect,
  onMore,
  onRefresh,
  refreshing,
  now,
}: Props) {
  return (
    <Card intent="neutral" className="flex min-h-0 flex-col gap-space-3" aria-label="games">
      <div className="flex items-center justify-between gap-space-2">
        <Text variant="h4" as="h2" color="secondary">
          Games
        </Text>
        <Button
          variant="plain"
          color="secondary"
          size="sm"
          leftDecorator={ArrowClockwiseIcon}
          loading={refreshing}
          onClick={onRefresh}
        >
          Refresh
        </Button>
      </div>
      <ul className="flex min-h-0 flex-col gap-space-1 overflow-auto">
        {games.map((game) => (
          <li key={game.threadId}>
            <GameRow
              game={game}
              analysis={analysisOf(game.mark, now)}
              current={game.threadId === selected}
              onSelect={onSelect}
            />
          </li>
        ))}
      </ul>
      {loading && <SkeletonRows rows={4} />}
      {!loading && games.length === 0 && (
        <Text variant="sm" color="tertiary">
          No games in this window.
        </Text>
      )}
      {onMore && !loading && (
        <Button variant="plain" color="secondary" size="sm" onClick={onMore}>
          Load more
        </Button>
      )}
    </Card>
  );
}

function GameRow({
  game,
  analysis,
  current,
  onSelect,
}: {
  game: Game;
  analysis: Analysis | null;
  current: boolean;
  onSelect: (threadId: string) => void;
}) {
  const plies = game.values?.moves?.length ?? 0;
  return (
    <button
      type="button"
      aria-current={current ? "true" : undefined}
      onClick={() => onSelect(game.threadId)}
      className={cn(
        "flex w-full flex-col gap-space-1 rounded-md px-space-3 py-space-2 text-left hover:bg-surface-level-2-hover",
        current && "bg-elevated-selected",
      )}
    >
      <span className="flex items-center justify-between gap-space-2">
        <Text variant="sm" weight="semibold" as="span" className="truncate">
          {game.matchup}
        </Text>
        <Text variant="sm" as="span" className="shrink-0 whitespace-nowrap">
          {game.values ? resultText(game.values.outcome) : "No record"}
        </Text>
      </span>
      <span className="flex items-center justify-between gap-space-2">
        <Text variant="xs" color="tertiary" as="span" className="truncate">
          {when(game.startedAt)} · {plies === 1 ? "1 ply" : `${plies} plies`}
        </Text>
        <Text
          variant="xs"
          color={game.grading.status === "graded" && !analysis ? "secondary" : "tertiary"}
          as="span"
          className="shrink-0 whitespace-nowrap"
        >
          {analysis ? ANALYSIS_TEXT[analysis.status] : gradeText(game.grading)}
        </Text>
      </span>
    </button>
  );
}

const ANALYSIS_TEXT: Record<Analysis["status"], string> = {
  analyzing: "Analyzing…",
  stalled: "Analysis didn't finish",
  failed: "Analysis failed",
};

function gradeText(grading: Grading): string {
  switch (grading.status) {
    case "graded": {
      const { white, black } = grading.review.accuracy;
      return `${white?.toFixed(0) ?? "–"} / ${black?.toFixed(0) ?? "–"}`;
    }
    case "invalid":
      return "Unreadable review";
    case "ungraded":
      return "Not graded";
  }
}
