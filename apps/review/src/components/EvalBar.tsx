import { Text } from "@langchain/macaw-components/Text";
import { evalText, whiteWinPercent, type Eval } from "../review";

// Coloured like the board's squares (packages/chess-ui/src/styles.css), so it reads with it.
const WHITE = { backgroundColor: "var(--board-light)" };
const BLACK = { backgroundColor: "var(--board-dark)" };

/** White's winning chances as a vertical bar, White at the bottom unless the board is flipped. */
export function EvalBar({ value, flipped }: { value: Eval; flipped: boolean }) {
  const white = whiteWinPercent(value);
  return (
    <div
      className="flex w-space-5 shrink-0 flex-col items-center gap-space-1"
      aria-label={`evaluation ${evalText(value)}`}
    >
      <div
        className={`flex w-full flex-1 overflow-hidden rounded-sm ${flipped ? "flex-col" : "flex-col-reverse"}`}
      >
        <div style={{ ...WHITE, height: `${white}%` }} data-testid="eval-white" />
        <div style={{ ...BLACK, height: `${100 - white}%` }} />
      </div>
      <Text variant="xs" color="secondary" className="font-mono">
        {evalText(value)}
      </Text>
    </div>
  );
}
