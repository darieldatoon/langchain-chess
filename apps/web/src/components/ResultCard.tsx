import { Button } from "@langchain/macaw-components/Button";
import { Card } from "@langchain/macaw-components/Card";
import { Text } from "@langchain/macaw-components/Text";
import { outcomeLine, resultHeadline } from "../format";
import type { Outcome, Side } from "../types";

interface Props {
  outcome: Outcome;
  humanSide: Side;
  onRematch: () => void;
  onNewGame: () => void;
}

export function ResultCard({ outcome, humanSide, onRematch, onNewGame }: Props) {
  return (
    <Card
      intent="info"
      aria-label="result"
      className="flex flex-wrap items-center justify-between gap-space-3"
    >
      <div className="flex flex-col gap-space-1">
        <Text variant="h4" as="h2">
          {resultHeadline(outcome, humanSide)}
        </Text>
        <Text variant="sm" color="secondary">
          {outcomeLine(outcome)}
        </Text>
      </div>
      <div className="flex gap-space-2">
        <Button variant="outlined" color="secondary" size="md" onClick={onNewGame}>
          New game
        </Button>
        <Button color="primary" size="md" onClick={onRematch}>
          Rematch
        </Button>
      </div>
    </Card>
  );
}
