import { Chessboard } from "react-chessboard";
import { useMemo } from "react";
import { isOwnPiece, sideToMove, tryMove } from "../chess";
import { lastMoveStyles } from "../format";
import type { Side } from "../types";

interface Props {
  fen: string;
  orientation: Side;
  humanSide: Side;
  lastMove: string | null;
  locked: boolean;
  onMove: (uci: string, fenAfter: string) => void;
}

// react-chessboard takes style objects, so the board is the one place semantic tokens are read
// as CSS variables instead of Tailwind classes. Dark squares are the brand blue toned down over
// the card surface so the table stays calm in both themes; light squares are the card surface.
const light = { backgroundColor: "var(--bg-surface-level-3)" };
const dark = {
  backgroundColor: "color-mix(in srgb, var(--bg-brand) 55%, var(--bg-surface-level-3))",
};

export function Board({ fen, orientation, humanSide, lastMove, locked, onMove }: Props) {
  const canMove = !locked && sideToMove(fen) === humanSide;
  const squareStyles = useMemo(() => lastMoveStyles(lastMove), [lastMove]);

  return (
    <Chessboard
      options={{
        id: "jev-board",
        position: fen,
        boardOrientation: orientation,
        allowDragging: canMove,
        animationDurationInMs: 180,
        lightSquareStyle: light,
        darkSquareStyle: dark,
        dropSquareStyle: { boxShadow: "inset 0 0 0 3px var(--border-focus)" },
        darkSquareNotationStyle: { color: "var(--bg-surface-level-3)", fontSize: "11px" },
        lightSquareNotationStyle: { color: "var(--text-tertiary)", fontSize: "11px" },
        boardStyle: { borderRadius: "var(--radius-md, 6px)", overflow: "hidden" },
        squareStyles,
        canDragPiece: ({ piece }) => canMove && isOwnPiece(piece.pieceType, humanSide),
        onPieceDrop: ({ sourceSquare, targetSquare }) => {
          if (!targetSquare) return false;
          const attempt = tryMove(fen, sourceSquare, targetSquare);
          if (!attempt) return false;
          onMove(attempt.uci, attempt.fen);
          return true;
        },
      }}
    />
  );
}
