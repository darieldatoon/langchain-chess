import { cn } from "@langchain/macaw-components/utils/cn";
import { Chessboard, defaultPieces, type Arrow } from "react-chessboard";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  checkedKing,
  destinations,
  MOVE_SQUARES,
  promotionSquares,
  squareHighlights,
  squaresChanged,
} from "../boardFeedback";
import { isOwnPiece, isPromotion, sideToMove, tryMove, type Promotion } from "../chess";
import { useCoarsePointer, useReducedMotion } from "../layout/useContainerLayout";
import { ANIMATION_MS, DEFAULT_DISPLAY_PREFS, type DisplayPrefs } from "../prefs";
import type { Side } from "../types";

export type BoardPrefs = Pick<
  DisplayPrefs,
  "showLegalMoves" | "coordinates" | "animation" | "moveInput" | "autoQueen"
>;

interface Props {
  fen: string;
  orientation: Side;
  humanSide: Side;
  lastMove: string | null;
  locked: boolean;
  /** Absent for a board that only shows a position. */
  onMove?: (uci: string, fenAfter: string) => void;
  arrows?: readonly Arrow[];
  prefs?: BoardPrefs;
  /** Scrolling over the board steps through the moves; absent when it shouldn't. */
  onWheelStep?: (step: -1 | 1) => void;
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

/** Trackpads send many small wheel events; one step per this much scrolling. */
export const WHEEL_STEP_PX = 40;
/** Pixels per wheel delta unit, by `deltaMode`: pixels, lines, pages. */
const WHEEL_UNITS = [1, 16, 400];
/** A promotion choice: a square, but never under a 44px tap. */
const SLOT = "max(12.5cqw, 44px)";

// react-chessboard takes style objects, so board colours are CSS variables defined per theme
// in src/styles.css from semantic tokens.
const light = { backgroundColor: "var(--board-light)" };
const dark = { backgroundColor: "var(--board-dark)" };

export function Board({
  fen,
  orientation,
  humanSide,
  lastMove,
  locked,
  onMove,
  arrows,
  prefs = DEFAULT_DISPLAY_PREFS,
  onWheelStep,
}: Props) {
  const canMove = onMove !== undefined && !locked && sideToMove(fen) === humanSide;
  const coarse = useCoarsePointer();
  const reduced = useReducedMotion();
  // Click-to-move: the first click selects one of the human's pieces, the second moves it.
  const [selected, setSelected] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [promoting, setPromoting] = useState<Promoting | null>(null);
  // A new position or a locked board drops a half-made promotion rather than playing it late.
  if (promoting && (promoting.fen !== fen || !canMove)) setPromoting(null);
  if (selected && !canMove) setSelected(null);

  const from = dragging ?? selected;
  const targets = useMemo(
    () => (from && prefs.showLegalMoves ? destinations(fen, from) : []),
    [fen, from, prefs.showLegalMoves],
  );
  const squareStyles = useMemo(
    () =>
      squareHighlights({
        lastMove,
        selected,
        targets,
        fen,
        hover: coarse ? null : hover,
        check: checkedKing(fen),
      }),
    [lastMove, selected, targets, fen, hover, coarse],
  );

  // react-chessboard ends a drag with the handler from the render the drag began in, so moves
  // read the board as it is now; a drag must not land after the board locked, moved on or left.
  const now = useRef({ fen, canMove, onMove, autoQueen: prefs.autoQueen });
  useLayoutEffect(() => {
    now.current = { fen, canMove, onMove, autoQueen: prefs.autoQueen };
    // Runs before each update too, but only an unmount leaves it in place.
    return () => {
      now.current = { ...now.current, canMove: false };
    };
  });

  useEffect(() => {
    if (!promoting) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPromoting(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [promoting]);

  const frame = useRef<HTMLDivElement>(null);
  const onWheel = useRef(onWheelStep);
  useLayoutEffect(() => {
    onWheel.current = onWheelStep;
  });
  const stepping = onWheelStep !== undefined;
  // Native and not passive, so a step doesn't also scroll the page: React's wheel listener is
  // passive and can't prevent it.
  useEffect(() => {
    const el = frame.current;
    if (!stepping || !el) return;
    let travelled = 0;
    const listener = (event: WheelEvent) => {
      event.preventDefault();
      travelled += event.deltaY * WHEEL_UNITS[event.deltaMode];
      if (Math.abs(travelled) < WHEEL_STEP_PX) return;
      onWheel.current?.(travelled > 0 ? 1 : -1);
      travelled = 0;
    };
    el.addEventListener("wheel", listener, { passive: false });
    return () => el.removeEventListener("wheel", listener);
  }, [stepping]);

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
    if (board.autoQueen) return submit(from, to, "q");
    setPromoting({ fen: board.fen, from, to });
    return true;
  };

  const slots = promoting && promotionSquares(promoting.to, orientation);
  // A jump (a game loading, a leap through history) appears at once: animating it would slide
  // every piece, and taps land on pieces still moving.
  const [shown, setShown] = useState({ fen, jump: false });
  if (shown.fen !== fen) setShown({ fen, jump: squaresChanged(shown.fen, fen) > MOVE_SQUARES });
  // React renders again at once with the new state, before this render is used.
  const jump = shown.jump;
  const clicks = prefs.moveInput !== "drag";
  const drags = prefs.moveInput !== "click";
  const colour = humanSide === "white" ? "w" : "b";

  return (
    // A size container: the promotion picker sizes itself from the board's width.
    <div ref={frame} className="relative" style={{ containerType: "inline-size" }}>
      <Chessboard
        options={{
          id: "chess-board",
          position: fen,
          boardOrientation: orientation,
          allowDragging: canMove && drags,
          showNotation: prefs.coordinates,
          animationDurationInMs: ANIMATION_MS[prefs.animation],
          showAnimations: prefs.animation !== "off" && !reduced && !jump,
          lightSquareStyle: light,
          darkSquareStyle: dark,
          dropSquareStyle: { boxShadow: "inset 0 0 0 3px var(--board-drop)" },
          darkSquareNotationStyle: { color: "var(--board-notation-on-dark)", fontSize: "11px" },
          lightSquareNotationStyle: { color: "var(--board-notation-on-light)", fontSize: "11px" },
          boardStyle: { borderRadius: "var(--radius-md, 6px)", overflow: "hidden" },
          squareStyles,
          ...(arrows && { arrows: [...arrows] }),
          canDragPiece: ({ piece }) => canMove && drags && isOwnPiece(piece.pieceType, humanSide),
          onPieceDrag: ({ square }) => setDragging(square),
          onPieceDragCancel: () => setDragging(null),
          onPieceDrop: ({ sourceSquare, targetSquare }) => {
            setDragging(null);
            setSelected(null);
            return targetSquare ? move(sourceSquare, targetSquare) : false;
          },
          onMouseOverSquare: ({ square }) => setHover(square),
          onMouseOutSquare: () => setHover(null),
          onSquareClick: ({ piece, square }) => {
            if (!canMove || !clicks) return setSelected(null);
            if (selected && move(selected, square)) return setSelected(null);
            setSelected(piece && isOwnPiece(piece.pieceType, humanSide) ? square : null);
          },
        }}
      />
      {slots && (
        <div className="absolute inset-0 z-10" role="group" aria-label="Promote to">
          <button
            type="button"
            aria-label="Cancel promotion"
            className="absolute inset-0 size-full cursor-default bg-overlay"
            onClick={() => setPromoting(null)}
          />
          {/* One column down from the promotion edge, kept inside the board however small. */}
          <div
            className={cn(
              "absolute flex",
              slots[0].row === 0 ? "top-0 flex-col" : "bottom-0 flex-col-reverse",
            )}
            style={{
              width: SLOT,
              left: `clamp(0px, ${slots[0].column * 12.5}cqw, calc(100cqw - ${SLOT}))`,
            }}
          >
            {slots.map(({ piece }, i) => (
              <button
                key={piece}
                type="button"
                aria-label={`Promote to ${PIECE_NAMES[piece]}`}
                // Focus lands on the queen, so Enter promotes to it.
                autoFocus={i === 0}
                className="flex items-center justify-center rounded-full bg-surface-level-1 shadow-lg hover:bg-surface-level-2-hover"
                style={{ width: SLOT, height: SLOT }}
                onClick={() => {
                  setPromoting(null);
                  submit(promoting.from, promoting.to, piece);
                }}
              >
                <span className="block size-[80%]">
                  {defaultPieces[`${colour}${piece.toUpperCase()}`]()}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
