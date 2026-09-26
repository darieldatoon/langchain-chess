import { IconButton } from "@langchain/macaw-components/IconButton";
import { ArrowsDownUpIcon } from "@phosphor-icons/react/dist/ssr/ArrowsDownUp";
import { CaretDoubleLeftIcon } from "@phosphor-icons/react/dist/ssr/CaretDoubleLeft";
import { CaretDoubleRightIcon } from "@phosphor-icons/react/dist/ssr/CaretDoubleRight";
import { CaretLeftIcon } from "@phosphor-icons/react/dist/ssr/CaretLeft";
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr/CaretRight";
import type { ReactNode } from "react";

interface Props {
  /** The position shown: 0 is the start, `last` the latest. */
  index: number;
  last: number;
  onGo: (index: number) => void;
  onFlip: () => void;
  /** Sits between the move buttons and the flip button. */
  children?: ReactNode;
}

export function BoardControls({ index, last, onGo, onFlip, children }: Props) {
  const step = { size: "sm", variant: "outlined", color: "secondary" } as const;
  return (
    <div className="flex items-center justify-between gap-space-2">
      <div className="flex items-center gap-space-1">
        <IconButton
          {...step}
          icon={CaretDoubleLeftIcon}
          label="First move"
          onClick={() => onGo(0)}
          disabled={index === 0}
        />
        <IconButton
          {...step}
          icon={CaretLeftIcon}
          label="Previous move"
          onClick={() => onGo(index - 1)}
          disabled={index === 0}
        />
        <IconButton
          {...step}
          icon={CaretRightIcon}
          label="Next move"
          onClick={() => onGo(index + 1)}
          disabled={index >= last}
        />
        <IconButton
          {...step}
          icon={CaretDoubleRightIcon}
          label="Last move"
          onClick={() => onGo(last)}
          disabled={index >= last}
        />
      </div>
      {children}
      <IconButton
        icon={ArrowsDownUpIcon}
        label="Flip board"
        size="sm"
        variant="plain"
        color="secondary"
        onClick={onFlip}
      />
    </div>
  );
}
