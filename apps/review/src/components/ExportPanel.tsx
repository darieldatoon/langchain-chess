import { Button } from "@langchain/macaw-components/Button";
import { Text } from "@langchain/macaw-components/Text";
import { TOUCH_TARGET } from "@langchain-chess/chess-ui";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/ssr/ArrowSquareOut";
import type { FocusEvent } from "react";

interface Props {
  fen: string;
  pgn: string;
  onCopyFen: () => void;
  onCopyPgn: () => void;
  onLichess: () => void;
}

const FIELD =
  "w-full rounded-md border border-default bg-surface-level-2 p-space-2 font-mono text-xs text-primary";
const selectAll = (event: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) =>
  event.currentTarget.select();

/** The position and the game, to copy or to select by hand when the browser won't copy. */
export function ExportPanel({ fen, pgn, onCopyFen, onCopyPgn, onLichess }: Props) {
  const button = (label: string, onClick: () => void) => (
    <Button
      variant="outlined"
      color="secondary"
      size="sm"
      className={TOUCH_TARGET}
      onClick={onClick}
    >
      {label}
    </Button>
  );
  return (
    <div className="flex flex-col gap-space-3">
      <label className="flex flex-col gap-space-1">
        <Text variant="xs" color="secondary" as="span">
          FEN
        </Text>
        {/* Native: Macaw's fields have no read-only mode. */}
        <input readOnly value={fen} className={FIELD} onFocus={selectAll} />
      </label>
      <label className="flex flex-col gap-space-1">
        <Text variant="xs" color="secondary" as="span">
          PGN
        </Text>
        <textarea readOnly value={pgn} rows={8} className={FIELD} onFocus={selectAll} />
      </label>
      <div className="flex flex-wrap gap-space-2">
        {button("Copy FEN", onCopyFen)}
        {button("Copy PGN", onCopyPgn)}
        <Button
          variant="outlined"
          color="secondary"
          size="sm"
          className={TOUCH_TARGET}
          rightDecorator={ArrowSquareOutIcon}
          onClick={onLichess}
        >
          Analyze on Lichess
        </Button>
      </div>
    </div>
  );
}
