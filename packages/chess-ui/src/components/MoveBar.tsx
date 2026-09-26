import { ProgressBar } from "@langchain/macaw-components/ProgressBar";
import { Text } from "@langchain/macaw-components/Text";
import { sanAt } from "../chess";
import { percent } from "../format";
import type { RankedMove } from "../types";

interface Props {
  move: RankedMove;
  /** The position the move is played from, for its SAN. */
  fen: string;
  played?: boolean;
}

/** One of System 1's moves: its SAN, a probability bar and the percentage. */
export function MoveBar({ move, fen, played = false }: Props) {
  const san = sanAt(fen, move.uci);
  return (
    <div className="grid grid-cols-[6ch_1fr_5ch] items-center gap-space-2">
      <Text variant="sm" as="span" weight={played ? "semibold" : undefined} className="font-mono">
        {san}
      </Text>
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
