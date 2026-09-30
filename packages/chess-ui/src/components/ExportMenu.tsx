import { DropdownMenuItem, DropdownMenuSeparator } from "@langchain/macaw-components/DropdownMenu";
import { TOUCH_TARGET } from "../touch";
import { MenuGroup } from "./BoardMenu";

interface Props {
  onCopyFen: () => void;
  onCopyPgn: () => void;
  /** Web only: the review app's sandbox can't save files. */
  onDownloadPgn?: () => void;
  onLichess: () => void;
}

/** The board menu's Export group. */
export function ExportMenu({ onCopyFen, onCopyPgn, onDownloadPgn, onLichess }: Props) {
  return (
    <>
      <DropdownMenuSeparator />
      <MenuGroup label="Export">
        <DropdownMenuItem className={TOUCH_TARGET} onSelect={onCopyFen}>
          Copy FEN
        </DropdownMenuItem>
        <DropdownMenuItem className={TOUCH_TARGET} onSelect={onCopyPgn}>
          Copy PGN
        </DropdownMenuItem>
        {onDownloadPgn && (
          <DropdownMenuItem className={TOUCH_TARGET} onSelect={onDownloadPgn}>
            Download PGN
          </DropdownMenuItem>
        )}
        <DropdownMenuItem className={TOUCH_TARGET} onSelect={onLichess}>
          Analyze on Lichess
        </DropdownMenuItem>
      </MenuGroup>
    </>
  );
}
