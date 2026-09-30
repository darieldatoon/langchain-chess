import { Text } from "@langchain/macaw-components/Text";
import { cn } from "@langchain/macaw-components/utils/cn";
import { defaultPieces } from "react-chessboard";
import type { ReactNode } from "react";
import { materialDiff, materialScore, ROLES } from "../material";
import type { Side } from "../types";

interface Props {
  side: Side;
  name: string;
  /** The position on the board, so material follows the viewed ply. */
  fen: string;
  showMaterial: boolean;
  /** Right-aligned: whose turn it is, a Start or Retry button, or the result. */
  status?: ReactNode;
  className?: string;
}

/** One line attached to the board's edge: who plays this side, and what they are up. */
export function PlayerStrip({ side, name, fen, showMaterial, status, className }: Props) {
  const extra = materialDiff(fen)[side];
  const lead = materialScore(fen) * (side === "white" ? 1 : -1);
  const colour = side === "white" ? "w" : "b";
  return (
    <div
      aria-label={`${side} player`}
      className={cn("flex h-full min-w-0 items-center gap-space-2 px-space-1", className)}
    >
      <span
        aria-hidden
        className="size-3 shrink-0 rounded-full border border-strong"
        style={{ backgroundColor: side === "white" ? "var(--board-light)" : "var(--board-dark)" }}
      />
      <Text variant="sm" weight="medium" as="span" className="min-w-0 truncate" title={name}>
        {name}
      </Text>
      {showMaterial && (
        <span aria-label="material" className="flex shrink-0 items-center gap-space-1">
          {ROLES.flatMap((role) =>
            extra[role] > 0
              ? [
                  <span key={role} className="flex items-center" data-role={role}>
                    {Array.from({ length: extra[role] }, (_, i) => (
                      <span key={i} aria-hidden className={cn("block size-4", i > 0 && "-ml-2")}>
                        {defaultPieces[`${colour}${role.toUpperCase()}`]()}
                      </span>
                    ))}
                  </span>,
                ]
              : [],
          )}
          {lead > 0 && (
            <Text variant="xs" color="secondary" as="span" className="font-mono">
              +{lead}
            </Text>
          )}
        </span>
      )}
      <span className="ml-auto flex shrink-0 items-center gap-space-2">{status}</span>
    </div>
  );
}
