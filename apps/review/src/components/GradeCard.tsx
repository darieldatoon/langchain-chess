import { Badge } from "@langchain/macaw-components/Badge";
import { Card } from "@langchain/macaw-components/Card";
import { Text } from "@langchain/macaw-components/Text";
import { replay, sanAt } from "@langchain-chess/chess-ui";
import {
  evalText,
  QUALITY_COLORS,
  QUALITY_LABELS,
  type EngineLine,
  type Eval,
  type PlyGrade,
} from "../review";

const PV_PLIES = 6;
const DASH = "—";

export interface GradedMove {
  grade: PlyGrade;
  san: string;
  fenBefore: string;
  before: Eval;
  after: Eval;
}

interface Props {
  /** Null at the start position, before any move. */
  move: GradedMove | null;
  engine: string;
  /** The engine lines to leave room for, so the card keeps its height from move to move. */
  lineCount: number;
}

// Every row renders on every move, blank when it has nothing to show: the eval graph sits
// below this card, and a card that changed height would move it under the reader.
export function GradeCard({ move, engine, lineCount }: Props) {
  const grade = move?.grade;
  const best =
    move && grade?.best_move && grade.quality !== "best"
      ? sanAt(move.fenBefore, grade.best_move)
      : DASH;
  const lines: (EngineLine | null)[] = Array.from(
    { length: Math.max(lineCount, grade?.lines.length ?? 0) },
    (_, i) => grade?.lines[i] ?? null,
  );
  return (
    <Card intent="neutral" className="flex flex-col gap-space-3" aria-label="engine grade">
      <div className="flex items-center justify-between gap-space-2">
        <div className="flex items-center gap-space-2">
          <Text variant="h4" as="h2" color="secondary">
            Engine
          </Text>
          {move && grade ? (
            <Badge color={QUALITY_COLORS[grade.quality]} size="sm">
              {`${QUALITY_LABELS[grade.quality]}: ${move.san}`}
            </Badge>
          ) : (
            <Badge color="plain" size="sm">
              Start position
            </Badge>
          )}
        </div>
        <Text variant="xs" color="tertiary">
          {engine}
        </Text>
      </div>
      <dl className="grid grid-cols-[auto_1fr_auto_1fr] gap-x-space-4 gap-y-space-1">
        <Fact
          label="Evaluation"
          value={move ? `${evalText(move.before)} → ${evalText(move.after)}` : DASH}
        />
        <Fact label="Best Move" value={best} />
        <Fact
          label="Winning Chances Lost"
          value={grade ? `${grade.win_pct_loss.toFixed(1)}%` : DASH}
        />
        <Fact label="Centipawn Loss" value={grade ? String(grade.cp_loss) : DASH} />
        <Fact label="Move Accuracy" value={grade ? `${grade.accuracy.toFixed(0)}%` : DASH} />
      </dl>
      {lines.length > 0 && (
        <div className="flex flex-col gap-space-1" aria-label="engine lines">
          <Text variant="xs" color="tertiary">
            Engine lines before the move
          </Text>
          {lines.map((line, i) => (
            <div key={i} className="grid h-5 grid-cols-[6ch_1fr] gap-space-2 font-mono text-xs">
              <span className="text-secondary">{line ? evalText(line.eval) : ""}</span>
              <span className="truncate text-primary">
                {line && move
                  ? replay(move.fenBefore, line.pv.slice(0, PV_PLIES)).sans.join(" ")
                  : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <>
      <Text variant="sm" color="secondary" as="span">
        {label}
      </Text>
      <Text variant="sm" as="span" className="font-mono">
        {value}
      </Text>
    </>
  );
}
