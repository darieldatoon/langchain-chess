import { TooltipProvider } from "@radix-ui/react-tooltip";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { START_FEN } from "../../src/types";
import { Board } from "../../src/components/Board";

interface Captured {
  canDragPiece?: (args: {
    piece: { pieceType: string };
    square: string;
    isSparePiece: boolean;
  }) => boolean;
  onSquareClick?: (args: { piece: { pieceType: string } | null; square: string }) => void;
  squareStyles?: Record<string, unknown>;
  arrows?: unknown[];
  onPieceDrop?: (args: {
    piece: { pieceType: string };
    sourceSquare: string;
    targetSquare: string | null;
  }) => boolean;
}

const captured: { options: Captured | null } = { options: null };

vi.mock("react-chessboard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-chessboard")>()),
  Chessboard: ({ options }: { options: Captured }) => {
    captured.options = options;
    return <div data-testid="board" />;
  },
}));

/** White to move; c8=Q stalemates Black, so only an underpromotion keeps the game going. */
const PROMOTE = "8/k1P5/2K5/8/8/8/8/8 w - - 0 1";
/** White to move with e2 already on e4: e2-e4 is no longer a move. */
const AFTER_E4_E5 = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2";

const piece = (pieceType: string) => ({ piece: { pieceType }, square: "e2", isSparePiece: false });

describe("Board handlers", () => {
  it("draws the arrows it is given, and none of its own otherwise", () => {
    const arrow = { startSquare: "e2", endSquare: "e4", color: "green" };
    const { rerender } = render(
      <Board fen={START_FEN} orientation="white" humanSide="white" lastMove={null} locked />,
    );
    expect(captured.options?.arrows).toBeUndefined();
    rerender(
      <Board
        fen={START_FEN}
        orientation="white"
        humanSide="white"
        lastMove={null}
        locked
        arrows={[arrow]}
      />,
    );
    expect(captured.options?.arrows).toEqual([arrow]);
  });

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

  it("ignores a drag that ends after the board locked or the position moved on", () => {
    const onMove = vi.fn();
    const board = (fen: string, locked: boolean) => (
      <Board
        fen={fen}
        orientation="white"
        humanSide="white"
        lastMove={null}
        locked={locked}
        onMove={onMove}
      />
    );
    const { rerender } = render(board(START_FEN, false));
    // react-chessboard ends a drag with the handler from the render the drag began in.
    const dropFromDragStart = captured.options!.onPieceDrop!;
    const drop = () =>
      dropFromDragStart({ piece: { pieceType: "wP" }, sourceSquare: "e2", targetSquare: "e4" });
    rerender(board(START_FEN, true));
    expect(drop()).toBe(false);
    rerender(board(AFTER_E4_E5, false));
    expect(drop()).toBe(false);
    expect(onMove).not.toHaveBeenCalled();
  });

  it("ignores a drag that ends after the board unmounted", () => {
    const onMove = vi.fn();
    const { unmount } = render(
      <Board
        fen={START_FEN}
        orientation="white"
        humanSide="white"
        lastMove={null}
        locked={false}
        onMove={onMove}
      />,
    );
    const dropFromDragStart = captured.options!.onPieceDrop!;
    unmount();
    expect(
      dropFromDragStart({ piece: { pieceType: "wP" }, sourceSquare: "e2", targetSquare: "e4" }),
    ).toBe(false);
    expect(onMove).not.toHaveBeenCalled();
  });

  it("moves by clicking a piece and then its target", () => {
    const onMove = vi.fn();
    const board = (locked = false) => (
      <Board
        fen={START_FEN}
        orientation="white"
        humanSide="white"
        lastMove={null}
        locked={locked}
        onMove={onMove}
      />
    );
    const { rerender } = render(board());
    const click = (square: string, pieceType?: string) =>
      act(() =>
        captured.options?.onSquareClick?.({ piece: pieceType ? { pieceType } : null, square }),
      );
    click("e7", "bP"); // not the human's piece: nothing selected
    click("e4");
    expect(onMove).not.toHaveBeenCalled();
    click("e2", "wP");
    expect(captured.options?.squareStyles).toHaveProperty("e2");
    click("e5"); // illegal target: the selection clears
    expect(captured.options?.squareStyles).not.toHaveProperty("e2");
    click("e2", "wP");
    click("e4");
    expect(onMove).toHaveBeenCalledWith("e2e4", expect.stringContaining("4P3"));
    click("g1", "wN");
    rerender(board(true));
    click("f3");
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(captured.options?.squareStyles).not.toHaveProperty("g1");
  });

  describe("promotion", () => {
    // The picker's cancel button is a Macaw IconButton, whose tooltip needs a provider.
    const board = (fen = PROMOTE, onMove = vi.fn(), locked = false) => (
      <TooltipProvider>
        <Board
          fen={fen}
          orientation="white"
          humanSide="white"
          lastMove={null}
          locked={locked}
          onMove={onMove}
        />
      </TooltipProvider>
    );
    const drop = (from: string, to: string) => {
      let accepted = false;
      act(() => {
        accepted = captured.options!.onPieceDrop!({
          piece: { pieceType: "wP" },
          sourceSquare: from,
          targetSquare: to,
        });
      });
      return accepted;
    };
    const click = (square: string, pieceType?: string) =>
      act(() =>
        captured.options?.onSquareClick?.({ piece: pieceType ? { pieceType } : null, square }),
      );

    it("asks for the piece when a drop promotes, and plays the one chosen", () => {
      const onMove = vi.fn();
      render(board(PROMOTE, onMove));
      expect(screen.queryByRole("group", { name: "Promote to" })).toBeNull();
      expect(drop("c7", "c8")).toBe(true);
      expect(onMove).not.toHaveBeenCalled();
      const pieces = screen.getAllByRole("button", { name: /^Promote to/ });
      expect(pieces.map((b) => b.getAttribute("aria-label"))).toEqual([
        "Promote to queen",
        "Promote to rook",
        "Promote to bishop",
        "Promote to knight",
      ]);
      fireEvent.click(screen.getByRole("button", { name: "Promote to rook" }));
      expect(onMove).toHaveBeenCalledWith("c7c8r", "2R5/k7/2K5/8/8/8/8/8 b - - 0 1");
      expect(screen.queryByRole("group", { name: "Promote to" })).toBeNull();
    });

    it("asks for the piece when a click promotes, and can be cancelled", () => {
      const onMove = vi.fn();
      render(board(PROMOTE, onMove));
      click("c7", "wP");
      click("c8");
      expect(captured.options?.squareStyles).not.toHaveProperty("c7");
      fireEvent.click(screen.getByRole("button", { name: "Cancel promotion" }));
      expect(screen.queryByRole("group", { name: "Promote to" })).toBeNull();
      expect(onMove).not.toHaveBeenCalled();
      click("c7", "wP");
      click("c8");
      fireEvent.click(screen.getByRole("button", { name: "Promote to knight" }));
      expect(onMove).toHaveBeenCalledWith("c7c8n", expect.stringContaining("2N5"));
    });

    it("shows Black's pieces to a Black promoter", () => {
      render(
        <TooltipProvider>
          <Board
            fen="8/8/8/8/8/2k5/2p5/K7 b - - 0 1"
            orientation="black"
            humanSide="black"
            lastMove={null}
            locked={false}
            onMove={vi.fn()}
          />
        </TooltipProvider>,
      );
      drop("c2", "c1");
      expect(screen.getByRole("group", { name: "Promote to" })).toBeInTheDocument();
    });

    it("drops a pending choice when the position changes or the board locks", () => {
      const onMove = vi.fn();
      const { rerender } = render(board(PROMOTE, onMove));
      drop("c7", "c8");
      rerender(board(PROMOTE, onMove, true));
      expect(screen.queryByRole("group", { name: "Promote to" })).toBeNull();
      rerender(board(PROMOTE, onMove));
      expect(screen.queryByRole("group", { name: "Promote to" })).toBeNull();
      drop("c7", "c8");
      rerender(board("8/k1P5/2K5/8/8/8/8/7B w - - 0 1", onMove));
      expect(screen.queryByRole("group", { name: "Promote to" })).toBeNull();
      expect(onMove).not.toHaveBeenCalled();
    });
  });
});
