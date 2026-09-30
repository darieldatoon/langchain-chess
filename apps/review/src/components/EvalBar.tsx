import { Text } from "@langchain/macaw-components/Text";
import { evalText, whiteWinPercent, type Eval } from "../review";

// Coloured like the board's squares (packages/chess-ui/src/styles.css), so it reads with it.
const WHITE = { backgroundColor: "var(--board-light)" };
const BLACK = { backgroundColor: "var(--board-dark)" };

/**
 * White's winning chances as a vertical bar as tall as the board, White at the bottom unless the
 * board is flipped. The label hangs under it, so the bar keeps the board's height.
 */
export function EvalBar({ value, flipped }: { value: Eval; flipped: boolean }) {
  const white = whiteWinPercent(value);
  return (
    <div
      className="relative flex h-full w-full flex-col items-center"
      aria-label={`evaluation ${evalText(value)}`}
    >
      <div
        className={`flex h-full w-5 overflow-hidden rounded-sm ${flipped ? "flex-col" : "flex-col-reverse"}`}
      >
        <div style={{ ...WHITE, height: `${white}%` }} data-testid="eval-white" />
        <div style={{ ...BLACK, height: `${100 - white}%` }} />
      </div>
      <Text variant="xs" color="secondary" className="absolute top-full mt-space-1 font-mono">
        {evalText(value)}
      </Text>
    </div>
  );
}
