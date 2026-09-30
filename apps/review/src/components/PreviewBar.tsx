import { Button } from "@langchain/macaw-components/Button";
import { IconButton } from "@langchain/macaw-components/IconButton";
import { Text } from "@langchain/macaw-components/Text";
import { cn } from "@langchain/macaw-components/utils/cn";
import { ACTIVE_MOVE, TOUCH_TARGET } from "@langchain-chess/chess-ui";
import { CaretLeftIcon } from "@phosphor-icons/react/dist/ssr/CaretLeft";
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr/CaretRight";
import { lineNumber, SAN_BUTTON, type Preview } from "../tools";

interface Props {
  preview: Preview;
  onStep: (at: number) => void;
  onLeave: () => void;
}

/** A pinned preview's line, the move shown marked, and the way back to the game. */
export function PreviewBar({ preview: { line, at }, onStep, onLeave }: Props) {
  const last = line.fens.length - 1;
  return (
    <div
      role="group"
      aria-label="preview"
      className="flex flex-col gap-space-1 rounded-md border border-brand-strong p-space-2"
    >
      <div className="flex flex-wrap items-center gap-space-1">
        <Text variant="sm" weight="semibold" as="span" className="mr-auto">
          Preview
        </Text>
        <IconButton
          icon={CaretLeftIcon}
          label="Previous preview move"
          size="sm"
          variant="plain"
          color="secondary"
          className={TOUCH_TARGET}
          disabled={at <= 0}
          onClick={() => onStep(at - 1)}
        />
        <IconButton
          icon={CaretRightIcon}
          label="Next preview move"
          size="sm"
          variant="plain"
          color="secondary"
          className={TOUCH_TARGET}
          disabled={at >= last}
          onClick={() => onStep(at + 1)}
        />
        <Button
          variant="plain"
          color="primary"
          size="sm"
          className={TOUCH_TARGET}
          onClick={onLeave}
        >
          Back to game
        </Button>
      </div>
      <span className="flex flex-wrap items-baseline text-xs" aria-label="preview line">
        {line.sans.map((san, i) => {
          const number = lineNumber(line.base, i);
          return (
            <span key={i} className="flex items-baseline">
              {number && <span className="pl-space-1 font-mono text-tertiary">{number}</span>}
              <button
                type="button"
                aria-current={i === at ? "step" : undefined}
                className={cn(SAN_BUTTON, i === at && ACTIVE_MOVE)}
                onClick={() => onStep(i)}
              >
                {san}
              </button>
            </span>
          );
        })}
      </span>
    </div>
  );
}
