import { Chessboard, type Arrow } from "react-chessboard";
import { useMemo, useState } from "react";
import { isOwnPiece, sideToMove, tryMove } from "../chess";
import { lastMoveStyles } from "../format";
import type { Side } from "../types";

interface Props {
  fen: string;
  orientation: Side;
  humanSide: Side;
  lastMove: string | null;
  locked: boolean;
  /** Absent for a board that only shows a position. */
  onMove?: (uci: string, fenAfter: string) => void;
  arrows?: readonly Arrow[];
}

// react-chessboard takes style objects, so board colours are CSS variables defined per theme
// in src/styles.css from semantic tokens.
const light = { backgroundColor: "var(--board-light)" };
const dark = { backgroundColor: "var(--board-dark)" };

export function Board({ fen, orientation, humanSide, lastMove, locked, onMove, arrows }: Props) {
  const canMove = onMove !== undefined && !locked && sideToMove(fen) === humanSide;
  // Click-to-move: the first click selects one of the human's pieces, the second moves it.
  const [selected, setSelected] = useState<string | null>(null);
  const squareStyles = useMemo(() => {
    const styles = lastMoveStyles(lastMove);
    return selected
      ? { ...styles, [selected]: { boxShadow: "inset 0 0 0 3px var(--board-drop)" } }
      : styles;
  }, [lastMove, selected]);

  const move = (from: string, to: string): boolean => {
    const attempt = tryMove(fen, from, to);
    if (!attempt) return false;
    onMove?.(attempt.uci, attempt.fen);
    return true;
  };

  return (
    <Chessboard
      options={{
        id: "chess-board",
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
        ...(arrows && { arrows: [...arrows] }),
        canDragPiece: ({ piece }) => canMove && isOwnPiece(piece.pieceType, humanSide),
        onPieceDrop: ({ sourceSquare, targetSquare }) => {
          setSelected(null);
          return targetSquare ? move(sourceSquare, targetSquare) : false;
        },
        onSquareClick: ({ piece, square }) => {
          if (!canMove) return setSelected(null);
          if (selected && move(selected, square)) return setSelected(null);
          setSelected(piece && isOwnPiece(piece.pieceType, humanSide) ? square : null);
        },
      }}
    />
  );
}
