import { ProgressBar } from "@langchain/macaw-components/ProgressBar";
import { Text } from "@langchain/macaw-components/Text";
import { cn } from "@langchain/macaw-components/utils/cn";
import { sanAt } from "../chess";
import { percent } from "../format";
import type { RankedMove } from "../types";

interface Props {
  move: RankedMove;
  /** The position the move is played from, for its SAN. */
  fen: string;
  played?: boolean;
  /** With it, the SAN is a button that pins a preview of the move. */
  onPin?: () => void;
  /** Hovering the SAN previews it until the pointer leaves: `false` on leave. */
  onHover?: (over: boolean) => void;
  /** This move's preview is pinned. */
  pinned?: boolean;
}

/** One of System 1's moves: its SAN, a probability bar and the percentage. */
export function MoveBar({ move, fen, played = false, onPin, onHover, pinned = false }: Props) {
  const san = sanAt(fen, move.uci);
  // `sanAt` gives the UCI back for a move that isn't legal here: there is nothing to preview.
  const playable = san !== move.uci;
  return (
    <div className="grid grid-cols-[6ch_1fr_5ch] items-center gap-space-2">
      {onPin && playable ? (
        <button
          type="button"
          aria-label={`Preview ${san}`}
          aria-pressed={pinned}
          className={cn(
            "rounded-xs text-left font-mono text-sm hover:bg-surface-level-2-hover [@media(pointer:coarse)]:min-h-11",
            played && "font-semibold",
            pinned && "bg-brand text-brand-on-fill hover:bg-brand-hover",
          )}
          onClick={onPin}
          onMouseEnter={onHover && (() => onHover(true))}
          onMouseLeave={onHover && (() => onHover(false))}
        >
          {san}
        </button>
      ) : (
        <Text variant="sm" as="span" weight={played ? "semibold" : undefined} className="font-mono">
          {san}
        </Text>
      )}
      <ProgressBar
        value={Math.round(move.probability * 100)}
        size="sm"
        color={played ? "success" : "brand"}
        aria-label={`${san} ${played ? "(played) " : ""}probability`}
      />
      <Text variant="sm" color="tertiary" as="span" className="text-right font-mono">
        {percent(move.probability)}
      </Text>
    </div>
  );
}
