import { TooltipProvider } from "@radix-ui/react-tooltip";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { DEFAULT_DISPLAY_PREFS } from "../../src/prefs";
import { START_FEN } from "../../src/types";
import { Board } from "../../src/components/Board";

interface Captured {
  canDragPiece?: (args: {
    piece: { pieceType: string };
    square: string;
    isSparePiece: boolean;
  }) => boolean;
  onSquareClick?: (args: { piece: { pieceType: string } | null; square: string }) => void;
  onPieceDrag?: (args: { square: string }) => void;
  onPieceDragCancel?: () => void;
  onMouseOverSquare?: (args: { square: string }) => void;
  onMouseOutSquare?: () => void;
  allowDragging?: boolean;
  showNotation?: boolean;
  showAnimations?: boolean;
  animationDurationInMs?: number;
  squareStyles?: Record<string, { backgroundImage?: string; backgroundColor?: string }>;
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
        "Promote to knight",
        "Promote to rook",
        "Promote to bishop",
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

describe("Board feedback and preferences", () => {
  const board = (props: Partial<Parameters<typeof Board>[0]> = {}) => (
    <Board
      fen={START_FEN}
      orientation="white"
      humanSide="white"
      lastMove="e2e4"
      locked={false}
      onMove={vi.fn()}
      {...props}
    />
  );
  const styles = () => captured.options!.squareStyles!;
  const click = (square: string, pieceType?: string) =>
    act(() =>
      captured.options?.onSquareClick?.({ piece: pieceType ? { pieceType } : null, square }),
    );

  it("dots the legal targets of a selected piece, and fills the one under the pointer", () => {
    render(board());
    expect(styles().e2).toEqual({ backgroundColor: "var(--board-last-move)" });
    click("g1", "wN");
    expect(styles().g1.backgroundImage).toContain("--board-selected");
    expect(styles().f3.backgroundImage).toContain("--board-move-dot");
    expect(styles().h3.backgroundImage).toContain("--board-move-dot");
    act(() => captured.options?.onMouseOverSquare?.({ square: "f3" }));
    expect(styles().f3.backgroundImage).toContain("--board-hover");
    act(() => captured.options?.onMouseOutSquare?.());
    expect(styles().f3.backgroundImage).toContain("--board-move-dot");
  });

  it("dots while dragging, and rings an occupied target", () => {
    const fen = "rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2";
    render(board({ fen }));
    act(() => captured.options?.onPieceDrag?.({ square: "e4" }));
    expect(styles().d5.backgroundImage).toContain("--board-move-ring");
    expect(styles().e5.backgroundImage).toContain("--board-move-dot");
    act(() => captured.options?.onPieceDragCancel?.());
    expect(styles().d5).toBeUndefined();
  });

  it("shows no dots when legal moves are hidden, and glows a king in check", () => {
    const check = "rnb1kbnr/pppp1ppp/8/4p3/5PPq/8/PPPPP2P/RNBQKBNR w KQkq - 1 3";
    render(board({ fen: check, prefs: { ...DEFAULT_DISPLAY_PREFS, showLegalMoves: false } }));
    expect(styles().e1.backgroundImage).toContain("--board-check");
    click("e2", "wP");
    expect(Object.values(styles()).some((s) => s.backgroundImage?.includes("move-dot"))).toBe(
      false,
    );
  });

  it("takes coordinates, animation and how pieces move from the preferences", () => {
    const { rerender } = render(board());
    expect(captured.options).toMatchObject({
      showNotation: true,
      animationDurationInMs: 200,
      showAnimations: true,
      allowDragging: true,
    });
    rerender(
      board({
        prefs: {
          ...DEFAULT_DISPLAY_PREFS,
          coordinates: false,
          animation: "off",
          moveInput: "click",
        },
      }),
    );
    expect(captured.options).toMatchObject({
      showNotation: false,
      showAnimations: false,
      allowDragging: false,
    });
    expect(captured.options?.canDragPiece?.(piece("wP"))).toBe(false);
    rerender(board({ prefs: { ...DEFAULT_DISPLAY_PREFS, animation: "fast", moveInput: "drag" } }));
    expect(captured.options?.animationDurationInMs).toBe(120);
    click("e2", "wP");
    expect(styles().e2.backgroundImage).toBeUndefined();
  });

  it("fills no hovered square for a finger", () => {
    const spy = vi.spyOn(window, "matchMedia").mockImplementation(
      (query: string) =>
        ({
          matches: query.includes("coarse"),
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList,
    );
    render(board());
    click("g1", "wN");
    act(() => captured.options?.onMouseOverSquare?.({ square: "f3" }));
    expect(styles().f3.backgroundImage).toContain("--board-move-dot");
    spy.mockRestore();
  });

  it("shows a jump at once, and animates the move after it", () => {
    const { rerender } = render(board());
    expect(captured.options?.showAnimations).toBe(true);
    rerender(board({ fen: "4k3/8/8/8/8/8/8/4K3 w - - 0 1" }));
    expect(captured.options?.showAnimations).toBe(false);
    rerender(board({ fen: "4k3/8/8/8/8/8/8/3K4 b - - 1 1" }));
    expect(captured.options?.showAnimations).toBe(true);
  });

  it("turns animation off for reduced motion", () => {
    const spy = vi.spyOn(window, "matchMedia").mockImplementation(
      (query: string) =>
        ({
          matches: query.includes("reduce"),
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList,
    );
    render(board());
    expect(captured.options?.showAnimations).toBe(false);
    spy.mockRestore();
  });

  it("stacks a flipped picker up from the bottom edge", () => {
    render(board({ fen: PROMOTE, lastMove: null, orientation: "black" }));
    act(() => {
      captured.options!.onPieceDrop!({
        piece: { pieceType: "wP" },
        sourceSquare: "c7",
        targetSquare: "c8",
      });
    });
    const column = screen.getByRole("button", { name: "Promote to queen" }).parentElement!;
    expect(column).toHaveClass("bottom-0", "flex-col-reverse");
    expect(column.style.left).toContain("62.5cqw");
  });

  it("promotes straight to a queen when asked to", () => {
    const onMove = vi.fn();
    render(
      board({
        fen: PROMOTE,
        lastMove: null,
        onMove,
        prefs: { ...DEFAULT_DISPLAY_PREFS, autoQueen: true },
      }),
    );
    act(() => {
      captured.options!.onPieceDrop!({
        piece: { pieceType: "wP" },
        sourceSquare: "c7",
        targetSquare: "c8",
      });
    });
    expect(onMove).toHaveBeenCalledWith("c7c8q", expect.any(String));
    expect(screen.queryByRole("group", { name: "Promote to" })).toBeNull();
  });

  it("stacks the picker down the promotion file, cancelled by Esc", () => {
    render(board({ fen: PROMOTE, lastMove: null }));
    act(() => {
      captured.options!.onPieceDrop!({
        piece: { pieceType: "wP" },
        sourceSquare: "c7",
        targetSquare: "c8",
      });
    });
    const queen = screen.getByRole("button", { name: "Promote to queen" });
    // One column from the c8 edge down, at least 44px a choice, clamped inside the board.
    const column = queen.parentElement!;
    expect(column).toHaveClass("top-0", "flex-col");
    expect(column.style.left).toMatch(
      /^clamp\(0px, 25cqw, .*100cqw.*max\(12\.5cqw, 44px\)|^clamp\(0px, 25cqw, .*max\(12\.5cqw, 44px\).*100cqw/,
    );
    expect(queen.style.height).toBe("max(12.5cqw, 44px)");
    expect([...column.children].map((b) => b.getAttribute("aria-label"))).toEqual([
      "Promote to queen",
      "Promote to knight",
      "Promote to rook",
      "Promote to bishop",
    ]);
    expect(queen).toHaveFocus();
    fireEvent.keyDown(window, { key: "Enter" });
    expect(screen.getByRole("group", { name: "Promote to" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("group", { name: "Promote to" })).toBeNull();
  });

  it("steps through the moves on the wheel, a step per notch", () => {
    const onWheelStep = vi.fn();
    const { container, rerender } = render(board({ onWheelStep }));
    const wrapper = container.firstElementChild!;
    fireEvent.wheel(wrapper, { deltaY: 10 });
    expect(onWheelStep).not.toHaveBeenCalled();
    fireEvent.wheel(wrapper, { deltaY: 40 });
    fireEvent.wheel(wrapper, { deltaY: -100 });
    // Line-mode wheels count their lines; a step doesn't scroll the page too.
    const lines = new WheelEvent("wheel", { deltaY: 3, deltaMode: 1, cancelable: true });
    wrapper.dispatchEvent(lines);
    expect(lines.defaultPrevented).toBe(true);
    expect(onWheelStep.mock.calls).toEqual([[1], [-1], [1]]);
    rerender(board());
    fireEvent.wheel(container.firstElementChild!, { deltaY: 100 });
    expect(onWheelStep).toHaveBeenCalledTimes(3);
  });
});
