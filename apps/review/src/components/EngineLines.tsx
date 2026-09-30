import { Card } from "@langchain/macaw-components/Card";
import { Text } from "@langchain/macaw-components/Text";
import { cn } from "@langchain/macaw-components/utils/cn";
import { ACTIVE_MOVE } from "@langchain-chess/chess-ui";
import { evalText, type EngineLine } from "../review";
import { LINE_PLIES, lineNumber, previewFens, SAN_BUTTON, type Line, type Preview } from "../tools";

/** A preview before it is tied to a cursor. */
export type LinePick = Pick<Preview, "id" | "line" | "at">;

interface Props {
  /** "Before 3… Nf6". */
  title: string;
  /** The position the lines start from. */
  base: string;
  lines: readonly EngineLine[];
  /** Rows to keep, so the column below holds still from move to move. */
  rows: number;
  pinned: Preview | null;
  onPin: (pick: LinePick) => void;
  /** Fine pointers only: null when the pointer leaves. */
  onHover?: (pick: LinePick | null) => void;
}

export function EngineLines({ title, base, lines, rows, pinned, onPin, onHover }: Props) {
  const shown = Array.from({ length: Math.max(rows, lines.length) }, (_, i) => lines[i] ?? null);
  return (
    <Card intent="neutral" className="flex flex-col gap-space-1" aria-label="engine lines">
      <Text variant="xs" color="tertiary" as="h2">
        {title}
      </Text>
      {shown.map((engineLine, rank) => (
        <div
          key={rank}
          className="grid min-h-5 grid-cols-[6ch_1fr] items-baseline gap-space-2 text-xs"
        >
          <span className="font-mono text-secondary">
            {engineLine ? evalText(engineLine.eval) : ""}
          </span>
          {engineLine && (
            <LineMoves
              id={`engine-${rank}`}
              line={previewFens(base, engineLine.pv.slice(0, LINE_PLIES))}
              pinned={pinned}
              onPin={onPin}
              onHover={onHover}
            />
          )}
        </div>
      ))}
    </Card>
  );
}

function LineMoves({
  id,
  line,
  pinned,
  onPin,
  onHover,
}: {
  id: string;
  line: Line;
  pinned: Preview | null;
  onPin: Props["onPin"];
  onHover: Props["onHover"];
}) {
  return (
    <span className="flex flex-wrap items-baseline">
      {line.sans.map((san, at) => {
        const number = lineNumber(line.base, at);
        return (
          <span key={at} className="flex items-baseline">
            {number && <span className="pl-space-1 font-mono text-tertiary">{number}</span>}
            <button
              type="button"
              className={cn(
                SAN_BUTTON,
                "text-primary",
                pinned?.id === id && pinned.at === at && ACTIVE_MOVE,
              )}
              onClick={() => onPin({ id, line, at })}
              onMouseEnter={onHover && (() => onHover({ id, line, at }))}
              onMouseLeave={onHover && (() => onHover(null))}
            >
              {san}
            </button>
          </span>
        );
      })}
    </span>
  );
}
