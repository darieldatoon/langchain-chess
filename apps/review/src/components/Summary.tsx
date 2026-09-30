import { Badge } from "@langchain/macaw-components/Badge";
import { Button } from "@langchain/macaw-components/Button";
import { Card } from "@langchain/macaw-components/Card";
import { Text } from "@langchain/macaw-components/Text";
import { TOUCH_TARGET, type Ply, type Side } from "@langchain-chess/chess-ui";
import type { GameReview } from "../review";
import {
  accuracyBand,
  FLAWS,
  nextFlaw,
  summarize,
  type AccuracyBand,
  type Flaw,
  type SideSummary,
} from "../tools";

interface Props {
  review: GameReview;
  plies: readonly Ply[];
  names: Record<Side, string>;
  index: number;
  onGo: (index: number) => void;
}

const DASH = "—";
const SIDES: readonly Side[] = ["white", "black"];

// Macaw's Badge has no info colour; brand stands in for it.
const BAND_COLORS: Record<AccuracyBand, "success" | "primary" | "warning" | "error"> = {
  success: "success",
  info: "primary",
  warning: "warning",
  error: "error",
};

const COUNT_LABELS: Record<Flaw, [string, string]> = {
  inaccuracy: ["inaccuracy", "inaccuracies"],
  mistake: ["mistake", "mistakes"],
  blunder: ["blunder", "blunders"],
};

const SYMBOLS: Record<Flaw, string> = { inaccuracy: "?!", mistake: "?", blunder: "??" };

const SOURCE_NAMES: Record<string, string> = {
  systemone: "System 1",
  llm: "LLM",
  forced: "Forced",
  external: "External",
  unknown: "Unknown",
};

const pct = (accuracy: number) => `${accuracy.toFixed(0)}%`;

/** Each side's counts, average loss, accuracy, and the same split by who chose the moves. */
export function Summary({ review, plies, names, index, onGo }: Props) {
  const summary = summarize(review, plies);
  return (
    <Card intent="neutral" className="flex flex-col gap-space-3" aria-label="summary">
      <Text variant="h4" as="h2" color="secondary">
        Summary
      </Text>
      {SIDES.map((side) => (
        <SideRows
          key={side}
          side={side}
          name={names[side]}
          summary={summary[side]}
          // A flaw's button is disabled when the side made none, so there is always a next one.
          onFlaw={(flaw) => onGo(nextFlaw(review, side, flaw, index)!)}
        />
      ))}
    </Card>
  );
}

function SideRows({
  side,
  name,
  summary,
  onFlaw,
}: {
  side: Side;
  name: string;
  summary: SideSummary;
  onFlaw: (flaw: Flaw) => void;
}) {
  const { accuracy, acpl } = summary;
  return (
    <section className="flex flex-col gap-space-2" aria-label={`${side} summary`}>
      <div className="flex items-center justify-between gap-space-2">
        <Text variant="sm" weight="semibold" as="h3" className="truncate">
          {name}
        </Text>
        {accuracy === null ? (
          <Text variant="xs" color="tertiary" as="span" aria-label="accuracy">
            Accuracy {DASH}
          </Text>
        ) : (
          <Badge
            color={BAND_COLORS[accuracyBand(accuracy)]}
            size="sm"
            className="shrink-0 whitespace-nowrap"
            aria-label="accuracy"
          >
            {`Accuracy ${pct(accuracy)}`}
          </Badge>
        )}
      </div>
      <div className="flex flex-wrap gap-space-1">
        {FLAWS.map((flaw) => {
          const n = summary.counts[flaw];
          return (
            <Button
              key={flaw}
              variant="outlined"
              color="secondary"
              size="sm"
              className={TOUCH_TARGET}
              disabled={n === 0}
              onClick={() => onFlaw(flaw)}
            >
              {`${n} ${COUNT_LABELS[flaw][n === 1 ? 0 : 1]}`}
            </Button>
          );
        })}
      </div>
      <Text variant="xs" color="secondary">
        Average centipawn loss {acpl === null ? DASH : acpl.toFixed(0)}
      </Text>
      {summary.bySource.length === 0 ? (
        <Text variant="xs" color="tertiary">
          {DASH}
        </Text>
      ) : (
        <ul className="flex flex-col gap-space-1 text-xs" aria-label={`${side} by source`}>
          {summary.bySource.map((group) => (
            <li key={group.source} aria-label={SOURCE_NAMES[group.source] ?? group.source}>
              <span className="font-medium">{SOURCE_NAMES[group.source] ?? group.source}</span>
              <span className="text-secondary">
                {" · "}
                {[
                  `${group.moves} ${group.moves === 1 ? "move" : "moves"}`,
                  ...FLAWS.map((flaw) => `${group.counts[flaw]} ${SYMBOLS[flaw]}`),
                  `ACPL ${group.acpl.toFixed(0)}`,
                  `mean move accuracy ${pct(group.meanAccuracy)}`,
                ].join(" · ")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
