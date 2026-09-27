import { Text } from "@langchain/macaw-components/Text";
import { cn } from "@langchain/macaw-components/utils/cn";
import { clockText, type Side } from "@langchain-chess/chess-ui";
import { LOW_MS, remaining, type Clock } from "../clock";
import { useNow, type Now } from "../useClock";

interface Props {
  clock: Clock;
  side: Side;
  label: string;
  now: Now;
  /** The game ended on this side's time. */
  flagged: boolean;
}

/** One side's clock; only a running one ticks. */
export function GameClock({ clock, side, label, now, flagged }: Props) {
  const running = clock.running?.side === side;
  const time = useNow(running, now);
  const ms = flagged ? 0 : remaining(clock, side, time);
  const low = flagged || ms < LOW_MS;
  return (
    <div
      role="timer"
      aria-label={`${label} clock`}
      data-state={flagged ? "flagged" : running ? "running" : "stopped"}
      className={cn(
        "flex items-center justify-between gap-space-3 rounded-md px-space-3 py-space-1",
        running ? "bg-surface-level-3" : "bg-surface-level-2",
      )}
    >
      <Text variant="sm" color={flagged ? "error" : "secondary"} as="span">
        {flagged ? `${label} · out of time` : label}
      </Text>
      <Text
        variant="h3"
        as="span"
        weight={running ? "semibold" : "normal"}
        color={low ? "error" : running ? "primary" : "secondary"}
        className="font-mono tabular-nums"
      >
        {clockText(ms)}
      </Text>
    </div>
  );
}
