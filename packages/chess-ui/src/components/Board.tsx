import { Button } from "@langchain/macaw-components/Button";
import { IconButton } from "@langchain/macaw-components/IconButton";
import { XIcon } from "@phosphor-icons/react/dist/ssr/X";
import { Chessboard, defaultPieces, type Arrow } from "react-chessboard";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { isOwnPiece, isPromotion, PROMOTIONS, sideToMove, tryMove, type Promotion } from "../chess";
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

/** A promotion waiting for its piece, tied to the position it was started in. */
interface Promoting {
  fen: string;
  from: string;
  to: string;
}

const PIECE_NAMES: Record<Promotion, string> = {
  q: "queen",
  r: "rook",
  b: "bishop",
  n: "knight",
};

// react-chessboard takes style objects, so board colours are CSS variables defined per theme
// in src/styles.css from semantic tokens.
const light = { backgroundColor: "var(--board-light)" };
const dark = { backgroundColor: "var(--board-dark)" };

export function Board({ fen, orientation, humanSide, lastMove, locked, onMove, arrows }: Props) {
  const canMove = onMove !== undefined && !locked && sideToMove(fen) === humanSide;
  // Click-to-move: the first click selects one of the human's pieces, the second moves it.
  const [selected, setSelected] = useState<string | null>(null);
  const [promoting, setPromoting] = useState<Promoting | null>(null);
  // A new position or a locked board drops a half-made promotion rather than playing it late.
  if (promoting && (promoting.fen !== fen || !canMove)) setPromoting(null);
  const squareStyles = useMemo(() => {
    const styles = lastMoveStyles(lastMove);
    return selected
      ? { ...styles, [selected]: { boxShadow: "inset 0 0 0 3px var(--board-drop)" } }
      : styles;
  }, [lastMove, selected]);

  // react-chessboard ends a drag with the handler from the render the drag began in, so moves
  // read the board as it is now; a drag must not land after the board locked, moved on or left.
  const now = useRef({ fen, canMove, onMove });
  useLayoutEffect(() => {
    now.current = { fen, canMove, onMove };
    // Runs before each update too, but only an unmount leaves it in place.
    return () => {
      now.current = { ...now.current, canMove: false };
    };
  });

  const submit = (from: string, to: string, promotion?: Promotion): boolean => {
    const board = now.current;
    const attempt = board.canMove ? tryMove(board.fen, from, to, promotion) : null;
    if (!attempt) return false;
    board.onMove?.(attempt.uci, attempt.fen);
    return true;
  };

  /** Plays a move, or asks for the piece first when it promotes; true once it is handled. */
  const move = (from: string, to: string): boolean => {
    const board = now.current;
    if (!board.canMove || !isPromotion(board.fen, from, to)) return submit(from, to);
    setPromoting({ fen: board.fen, from, to });
    return true;
  };

  return (
    <div className="relative">
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
      {promoting && (
        <div className="absolute inset-0 z-10 flex items-center justify-center">
          <div
            role="group"
            aria-label="Promote to"
            className="flex items-center gap-space-1 rounded-md border border-default bg-surface-level-1 p-space-2 shadow-lg"
          >
            {PROMOTIONS.map((piece) => (
              <Button
                key={piece}
                variant="plain"
                color="secondary"
                aria-label={`Promote to ${PIECE_NAMES[piece]}`}
                onClick={() => {
                  setPromoting(null);
                  submit(promoting.from, promoting.to, piece);
                }}
              >
                <span className="block size-7">
                  {defaultPieces[`${humanSide === "white" ? "w" : "b"}${piece.toUpperCase()}`]()}
                </span>
              </Button>
            ))}
            <IconButton
              size="sm"
              variant="plain"
              color="secondary"
              icon={XIcon}
              label="Cancel promotion"
              onClick={() => setPromoting(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
