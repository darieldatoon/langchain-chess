import { Button } from "@langchain/macaw-components/Button";
import { IconButton } from "@langchain/macaw-components/IconButton";
import { Text } from "@langchain/macaw-components/Text";
import { cn } from "@langchain/macaw-components/utils/cn";
import { CaretDoubleLeftIcon } from "@phosphor-icons/react/dist/ssr/CaretDoubleLeft";
import { CaretDoubleRightIcon } from "@phosphor-icons/react/dist/ssr/CaretDoubleRight";
import { CaretLeftIcon } from "@phosphor-icons/react/dist/ssr/CaretLeft";
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr/CaretRight";
import type { IconComponent } from "@langchain/macaw-components/utils/icon-types";
import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { REPEAT_DELAY_MS, REPEAT_EVERY_MS } from "../repeat";
import { TOUCH_TARGET } from "../touch";

interface StepProps {
  icon: IconComponent;
  label: string;
  disabled: boolean;
  onStep: () => void;
  className?: string;
}

/** A step button that repeats while held, like Lichess's. */
export function StepButton({ icon, label, disabled, onStep, className }: StepProps) {
  const latest = useRef(onStep);
  useLayoutEffect(() => {
    latest.current = onStep;
  });
  const timers = useRef<{
    delay?: ReturnType<typeof setTimeout>;
    every?: ReturnType<typeof setInterval>;
  }>({});
  const stop = () => {
    clearTimeout(timers.current.delay);
    clearInterval(timers.current.every);
    timers.current = {};
  };
  useEffect(() => {
    if (disabled) stop();
  }, [disabled]);
  useEffect(() => stop, []);
  return (
    <IconButton
      size="md"
      variant="outlined"
      color="secondary"
      icon={icon}
      label={label}
      disabled={disabled}
      className={cn(TOUCH_TARGET, className)}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        latest.current();
        stop();
        timers.current.delay = setTimeout(() => {
          timers.current.every = setInterval(() => latest.current(), REPEAT_EVERY_MS);
        }, REPEAT_DELAY_MS);
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      // The press already stepped: only a keyboard click (detail 0) steps here.
      onClick={(event) => {
        if (event.detail === 0) latest.current();
      }}
    />
  );
}

interface Props {
  /** The position shown: 0 is the start, `last` the latest. */
  index: number;
  last: number;
  onGo: (index: number) => void;
  /** The board menu, at the row's end. */
  menu?: ReactNode;
  /** Phones: only ‹ and ›; first and last are in the menu and on the keys. */
  compact?: boolean;
}

/** `|◀ ◀ ▶ ▶|` and the board menu. ▶| is outlined in brand while the reader browses. */
export function BoardControls({ index, last, onGo, menu, compact = false }: Props) {
  const atStart = index === 0;
  const atEnd = index >= last;
  return (
    <div className="flex items-center justify-between gap-space-2" aria-label="navigation">
      <div className="flex items-center gap-space-1">
        {!compact && (
          <StepButton
            icon={CaretDoubleLeftIcon}
            label="First move"
            disabled={atStart}
            onStep={() => onGo(0)}
          />
        )}
        <StepButton
          icon={CaretLeftIcon}
          label="Previous move"
          disabled={atStart}
          onStep={() => onGo(index - 1)}
        />
        <StepButton
          icon={CaretRightIcon}
          label="Next move"
          disabled={atEnd}
          onStep={() => onGo(index + 1)}
        />
        {!compact && (
          <StepButton
            icon={CaretDoubleRightIcon}
            label="Last move"
            disabled={atEnd}
            onStep={() => onGo(last)}
            className={atEnd ? undefined : "border-brand-strong"}
          />
        )}
      </div>
      {menu}
    </div>
  );
}

/**
 * Above the navigation while the cursor isn't on the latest move of a game in progress: why the
 * board is locked. A finished game has nothing live to go back to.
 */
export function BackToLive({
  index,
  last,
  over,
  onGo,
}: {
  index: number;
  last: number;
  over: boolean;
  onGo: (index: number) => void;
}) {
  if (over || index >= last) return null;
  return (
    <div role="status" className="flex items-center justify-between gap-space-2">
      <Text variant="sm" color="secondary" as="span">
        Viewing move {index}
      </Text>
      <Button
        variant="plain"
        color="primary"
        size="sm"
        className={TOUCH_TARGET}
        onClick={() => onGo(last)}
      >
        Back to live
      </Button>
    </div>
  );
}
