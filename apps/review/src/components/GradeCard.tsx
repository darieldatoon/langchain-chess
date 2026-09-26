import { Badge } from "@langchain/macaw-components/Badge";
import { Card } from "@langchain/macaw-components/Card";
import { Text } from "@langchain/macaw-components/Text";
import { replay, sanAt } from "@langchain-chess/chess-ui";
import { evalText, QUALITY_COLORS, QUALITY_LABELS, type Eval, type PlyGrade } from "../review";

const PV_PLIES = 6;

interface Props {
  grade: PlyGrade;
  san: string;
  fenBefore: string;
  before: Eval;
  after: Eval;
  engine: string;
}

export function GradeCard({ grade, san, fenBefore, before, after, engine }: Props) {
  const best =
    grade.best_move && grade.quality !== "best" ? sanAt(fenBefore, grade.best_move) : null;
  return (
    <Card intent="neutral" className="flex flex-col gap-space-3" aria-label="engine grade">
      <div className="flex items-center justify-between gap-space-2">
        <Text variant="h4" as="h2" color="secondary">
          Engine
        </Text>
        <Text variant="xs" color="tertiary">
          {engine}
        </Text>
      </div>
      <div className="flex items-center gap-space-2">
        <Badge color={QUALITY_COLORS[grade.quality]} size="sm">
          {QUALITY_LABELS[grade.quality]}
        </Badge>
        <Text variant="md" weight="semibold" as="span" className="font-mono">
          {san}
        </Text>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-space-4 gap-y-space-1">
        <Fact label="Evaluation" value={`${evalText(before)} → ${evalText(after)}`} />
        <Fact label="Winning Chances Lost" value={`${grade.win_pct_loss.toFixed(1)}%`} />
        <Fact label="Centipawn Loss" value={String(grade.cp_loss)} />
        <Fact label="Move Accuracy" value={`${grade.accuracy.toFixed(0)}%`} />
        {best && <Fact label="Best Move" value={best} />}
      </dl>
      {grade.lines.length > 0 && (
        <div className="flex flex-col gap-space-1" aria-label="engine lines">
          <Text variant="xs" color="tertiary">
            Engine lines before the move
          </Text>
          {grade.lines.map((line, i) => (
            <div key={i} className="grid grid-cols-[6ch_1fr] gap-space-2 font-mono text-xs">
              <span className="text-secondary">{evalText(line.eval)}</span>
              <span className="truncate text-primary">
                {replay(fenBefore, line.pv.slice(0, PV_PLIES)).sans.join(" ")}
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
