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

// react-chessboard takes style objects, so board colours are CSS variables defined per theme
// in src/index.css from semantic tokens.
const light = { backgroundColor: "var(--board-light)" };
const dark = { backgroundColor: "var(--board-dark)" };

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
        dropSquareStyle: { boxShadow: "inset 0 0 0 3px var(--board-drop)" },
        darkSquareNotationStyle: { color: "var(--board-notation-on-dark)", fontSize: "11px" },
        lightSquareNotationStyle: { color: "var(--board-notation-on-light)", fontSize: "11px" },
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
