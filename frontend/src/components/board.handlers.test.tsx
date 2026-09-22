import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { START_FEN } from "../types";
import { Board } from "./Board";

interface Captured {
  canDragPiece?: (args: {
    piece: { pieceType: string };
    square: string;
    isSparePiece: boolean;
  }) => boolean;
  onPieceDrop?: (args: {
    piece: { pieceType: string };
    sourceSquare: string;
    targetSquare: string | null;
  }) => boolean;
}

const captured: { options: Captured | null } = { options: null };

vi.mock("react-chessboard", () => ({
  Chessboard: ({ options }: { options: Captured }) => {
    captured.options = options;
    return <div data-testid="board" />;
  },
}));

const piece = (pieceType: string) => ({ piece: { pieceType }, square: "e2", isSparePiece: false });

describe("Board handlers", () => {
  it("lets the human drag only their own pieces on their turn", () => {
    const onMove = vi.fn();
    render(
      <Board
        fen={START_FEN}
        orientation="white"
        humanSide="white"
        lastMove={null}
        locked={false}
        onMove={onMove}
      />,
    );
    expect(captured.options?.canDragPiece?.(piece("wP"))).toBe(true);
    expect(captured.options?.canDragPiece?.(piece("bP"))).toBe(false);
  });

  it("locks the board while waiting or when it is not the human's turn", () => {
    render(
      <Board
        fen={START_FEN}
        orientation="white"
        humanSide="white"
        lastMove={null}
        locked={true}
        onMove={vi.fn()}
      />,
    );
    expect(captured.options?.canDragPiece?.(piece("wP"))).toBe(false);
    render(
      <Board
        fen={START_FEN}
        orientation="black"
        humanSide="black"
        lastMove={null}
        locked={false}
        onMove={vi.fn()}
      />,
    );
    expect(captured.options?.canDragPiece?.(piece("bP"))).toBe(false);
  });

  it("submits legal drops and rejects illegal or off-board ones", () => {
    const onMove = vi.fn();
    render(
      <Board
        fen={START_FEN}
        orientation="white"
        humanSide="white"
        lastMove={null}
        locked={false}
        onMove={onMove}
      />,
    );
    const drop = captured.options!.onPieceDrop!;
    expect(drop({ piece: { pieceType: "wP" }, sourceSquare: "e2", targetSquare: null })).toBe(
      false,
    );
    expect(drop({ piece: { pieceType: "wP" }, sourceSquare: "e2", targetSquare: "e5" })).toBe(
      false,
    );
    expect(onMove).not.toHaveBeenCalled();
    expect(drop({ piece: { pieceType: "wP" }, sourceSquare: "e2", targetSquare: "e4" })).toBe(true);
    expect(onMove).toHaveBeenCalledWith("e2e4", expect.stringContaining(" b KQkq - 0 1"));
  });
});
