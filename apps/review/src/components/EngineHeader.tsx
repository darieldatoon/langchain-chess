import { Badge } from "@langchain/macaw-components/Badge";
import { Card } from "@langchain/macaw-components/Card";
import { Text } from "@langchain/macaw-components/Text";
import {
  evalText,
  QUALITY_COLORS,
  QUALITY_LABELS,
  type GameReview,
  type PlyGrade,
} from "../review";
import { searchLimit } from "../tools";

interface Props {
  review: GameReview;
  /** The position shown: 0 is the start. */
  index: number;
  /** The move that reached it; undefined at the start. */
  grade: PlyGrade | undefined;
  san: string | undefined;
}

/** The engine, the viewed position's evaluation, and one line of the viewed move's facts. */
export function EngineHeader({ review, index, grade, san }: Props) {
  const source = [review.engine, searchLimit(review.settings), "Graded analysis"]
    .filter(Boolean)
    .join(" · ");
  const facts = grade
    ? [
        `${evalText(review.evals[index - 1])} → ${evalText(review.evals[index])}`,
        `${grade.win_pct_loss.toFixed(1)}% chances lost`,
        `${grade.cp_loss} cp lost`,
        `${grade.accuracy.toFixed(0)}% accuracy`,
      ].join(" · ")
    : "Start position.";
  return (
    <Card intent="neutral" className="flex flex-col gap-space-1" aria-label="engine">
      <Text variant="xs" color="tertiary">
        {source}
      </Text>
      <div className="flex items-center gap-space-3">
        <Text variant="h2" as="p" className="font-mono" aria-label="evaluation">
          {evalText(review.evals[index])}
        </Text>
        {grade && san && (
          <Badge color={QUALITY_COLORS[grade.quality]} size="sm">
            {`${QUALITY_LABELS[grade.quality]}: ${san}`}
          </Badge>
        )}
      </div>
      <Text variant="xs" color="secondary" aria-label="move facts">
        {facts}
      </Text>
    </Card>
  );
}
