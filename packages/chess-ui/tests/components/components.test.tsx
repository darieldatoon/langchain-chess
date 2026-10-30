import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { MoveEntry } from "../../src/format";
import { AFTER_E4 } from "../../src/testing";
import { renderWithProviders } from "../support/renderApp";
import { START_FEN } from "../../src/types";
import { Board } from "../../src/components/Board";
import { MoveBar } from "../../src/components/MoveBar";
import { MoveList, MoveStrip } from "../../src/components/MoveList";
import { PlayerStrip } from "../../src/components/PlayerStrip";

const e4: MoveEntry = { ply: 0, san: "e4", source: "external" };
const e5: MoveEntry = { ply: 1, san: "e5", source: "systemone" };
const nf3: MoveEntry = { ply: 2, san: "Nf3", source: "llm" };
const nc6: MoveEntry = { ply: 3, san: "Nc6", source: "forced" };

describe("MoveList", () => {
  it("puts a control beside a move's button, not inside it, in the list and the strip", () => {
    const aside = (ply: number) => (ply === 1 ? <button type="button">mark</button> : null);
    const { rerender } = render(
      <MoveList entries={[e4, e5]} startFen={START_FEN} onSelect={() => {}} aside={aside} />,
    );
    const mark = screen.getByRole("button", { name: "mark" });
    expect(screen.getByRole("button", { name: "e5" })).not.toContainElement(mark);
    rerender(<MoveList entries={[e4, e5]} startFen={START_FEN} aside={aside} />);
    expect(screen.getByRole("button", { name: "mark" })).toBeInTheDocument();
    rerender(
      <MoveStrip
        entries={[e4, e5]}
        startFen={START_FEN}
        selected={null}
        onSelect={() => {}}
        aside={aside}
      />,
    );
    expect(screen.getByRole("button", { name: "e5" })).not.toContainElement(
      screen.getByRole("button", { name: "mark" }),
    );
  });

  it("renders an empty hint and rows coloured by source", () => {
    const { rerender } = render(<MoveList entries={[]} startFen={START_FEN} />);
    expect(screen.getByText("No moves yet.")).toBeInTheDocument();
    rerender(
      <MoveList
        entries={[e4, e5, nf3, nc6, { ply: 4, san: "Bb5", source: "book" }]}
        startFen={START_FEN}
      />,
    );
    expect(screen.getByText("e4")).not.toHaveClass("bg-brand-subtle");
    expect(screen.getByText("e5")).toHaveClass("bg-brand-subtle");
    expect(screen.getByText("Nf3")).toHaveClass("bg-purple");
    expect(screen.getByText("Nc6")).toHaveClass("bg-surface-level-3");
    expect(screen.getByText("Bb5")).toHaveClass("bg-warning-subtle");
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("marks graded moves and, given onSelect, makes each move a button", () => {
    const onSelect = vi.fn();
    const graded: MoveEntry[] = [
      { ...e4, quality: "best" },
      { ...e5, quality: "inaccuracy" },
      { ...nf3, quality: "mistake" },
      { ...nc6, quality: "blunder" },
    ];
    const { rerender } = render(<MoveList entries={graded} startFen={START_FEN} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("?!")).toHaveClass("text-warning-secondary");
    expect(screen.getByText("?")).toHaveClass("text-warning-primary");
    expect(screen.getByText("??")).toHaveClass("text-error-primary");

    rerender(<MoveList entries={graded} startFen={START_FEN} selected={2} onSelect={onSelect} />);
    const nf3Button = screen.getByRole("button", { name: "Nf3?" });
    expect(nf3Button).toHaveAttribute("aria-current", "step");
    expect(screen.getByRole("button", { name: "e4" })).not.toHaveAttribute("aria-current");
    fireEvent.click(screen.getByRole("button", { name: "Nc6??" }));
    expect(onSelect).toHaveBeenCalledWith(3);
  });

  it("centres a move the reader went to, scrolling the list and not the page", () => {
    const entries: MoveEntry[] = [e4, e5, nf3, nc6];
    // The list spans 100-200, centred on 150; e4 is centred on 70, Nc6 on 200.
    const spy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect");
    spy.mockImplementation(function (this: HTMLElement) {
      if (this.getAttribute("aria-label") === "move list")
        return { top: 100, height: 100 } as DOMRect;
      const top = this.textContent === "e4" ? 60 : this.textContent === "Nc6" ? 190 : 110;
      return { top, height: 20 } as DOMRect;
    });
    const list = (selected: number | null) => (
      <MoveList entries={entries} startFen={START_FEN} selected={selected} onSelect={vi.fn()} />
    );
    const { rerender } = render(list(null));
    const el = screen.getByLabelText("move list");
    el.scrollTop = 50;
    rerender(list(null));
    expect(el.scrollTop).toBe(50);
    rerender(list(3));
    expect(el.scrollTop).toBe(100);
    rerender(list(0));
    expect(el.scrollTop).toBe(20);
    // A selection that isn't rendered as a move scrolls nothing.
    rerender(list(7));
    expect(el.scrollTop).toBe(20);
    spy.mockRestore();
  });

  it("opens a long game at its selected move", () => {
    const spy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect");
    spy.mockImplementation(function (this: HTMLElement) {
      if (this.getAttribute("aria-label") === "move list")
        return { top: 0, height: 100 } as DOMRect;
      return { top: this.textContent === "Nc6" ? 900 : 0, height: 20 } as DOMRect;
    });
    render(
      <MoveList
        entries={[e4, e5, nf3, nc6]}
        startFen={START_FEN}
        selected={3}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("move list").scrollTop).toBe(860);
    spy.mockRestore();
  });

  it("ends with the result, the score apart from the words", () => {
    render(
      <MoveList
        entries={[e4, e5]}
        startFen={START_FEN}
        outcome={{ kind: "checkmate", winner: "white" }}
        heading={<p>Heading</p>}
      />,
    );
    const result = screen.getByLabelText("result");
    expect(result).toHaveTextContent("1-0Checkmate · White wins");
    expect(screen.getByText("Heading")).toBeInTheDocument();
  });

  it("marks draw offers, before the first move too", () => {
    const offers = [
      { ply: 0, by: "white" as const, answer: "declined" as const },
      { ply: 2, by: "white" as const, answer: "declined" as const },
    ];
    render(<MoveList entries={[e4, e5]} startFen={START_FEN} drawOffers={offers} />);
    expect(screen.getAllByLabelText("draw offered")).toHaveLength(2);
    expect(screen.getByText("e5").parentElement).toHaveTextContent("e5½?");
    render(
      <MoveStrip
        entries={[e4, e5]}
        startFen={START_FEN}
        selected={1}
        onSelect={vi.fn()}
        drawOffers={offers}
      />,
    );
    expect(screen.getAllByLabelText("draw offered")).toHaveLength(4);
  });

  it("adds markers after moves and full-width notes under their rows", () => {
    render(
      <MoveList
        entries={[e4, e5, nf3]}
        startFen={START_FEN}
        after={(ply) => (ply === 1 ? <span>marker</span> : null)}
        note={(ply) => (ply === 0 ? <p>e4 note</p> : ply === 2 ? <p>Nf3 note</p> : null)}
      />,
    );
    expect(screen.getByText("e5").parentElement).toHaveTextContent("e5marker");
    expect(screen.getByText("e4 note").parentElement).toHaveClass("col-span-3");
    expect(screen.getByText("Nf3 note")).toBeInTheDocument();
  });

  it("numbers a black-to-move root from its fullmove number", () => {
    render(<MoveList entries={[{ ...e5, ply: 0 }]} startFen={AFTER_E4} />);
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("…")).toBeInTheDocument();
  });

  it("follows new moves while at the bottom and holds after a manual scroll up", () => {
    const { rerender } = render(<MoveList entries={[e4]} startFen={START_FEN} />);
    const list = screen.getByLabelText("move list");
    Object.defineProperty(list, "scrollHeight", { value: 400, configurable: true });
    Object.defineProperty(list, "clientHeight", { value: 100, configurable: true });
    rerender(<MoveList entries={[e4, e5]} startFen={START_FEN} />);
    expect(list.scrollTop).toBe(400);
    list.scrollTop = 10;
    fireEvent.scroll(list);
    rerender(<MoveList entries={[e4, e5, nf3]} startFen={START_FEN} />);
    expect(list.scrollTop).toBe(10);
    list.scrollTop = 300;
    fireEvent.scroll(list);
    rerender(<MoveList entries={[e4, e5, nf3, nc6]} startFen={START_FEN} />);
    expect(list.scrollTop).toBe(400);
  });
});

describe("MoveBar", () => {
  it("shows a move's SAN and probability, marked when it was played", () => {
    const { rerender } = render(
      <MoveBar move={{ uci: "e2e4", probability: 0.42 }} fen={START_FEN} />,
    );
    expect(screen.getByLabelText("e4 probability")).toBeInTheDocument();
    expect(screen.getByText("42%")).toBeInTheDocument();
    rerender(<MoveBar move={{ uci: "e2e4", probability: 0.42 }} fen={START_FEN} played />);
    expect(screen.getByLabelText("e4 (played) probability")).toBeInTheDocument();
  });

  it("makes the SAN a preview button when asked, hovering only with a hover handler", () => {
    const onPin = vi.fn();
    const onHover = vi.fn();
    const move = { uci: "e2e4", probability: 0.42 };
    const { rerender } = render(
      <MoveBar move={move} fen={START_FEN} onPin={onPin} onHover={onHover} pinned played />,
    );
    const e4 = screen.getByRole("button", { name: "Preview e4" });
    expect(e4).toHaveAttribute("aria-pressed", "true");
    expect(e4).toHaveClass("font-semibold");
    fireEvent.mouseEnter(e4);
    fireEvent.mouseLeave(e4);
    expect(onHover.mock.calls).toEqual([[true], [false]]);
    fireEvent.click(e4);
    expect(onPin).toHaveBeenCalledTimes(1);
    rerender(<MoveBar move={move} fen={START_FEN} onPin={onPin} />);
    fireEvent.mouseEnter(screen.getByRole("button", { name: "Preview e4" }));
    expect(onHover).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "Preview e4" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    // A move that isn't legal here has nothing to preview.
    rerender(<MoveBar move={{ uci: "a1a8", probability: 0.1 }} fen={START_FEN} onPin={onPin} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("a1a8")).toBeInTheDocument();
  });
});

describe("Board", () => {
  const pieceOn = (square: string) =>
    document.querySelector(`[data-square="${square}"] [data-piece]`)?.getAttribute("data-piece");
  const clickSquare = (square: string) =>
    fireEvent.click(document.querySelector(`[data-square="${square}"]`)!);

  /** The board as an app drives it: each move it reports becomes the next position. */
  function Played({ start, onMove }: { start: string; onMove: (uci: string) => void }) {
    const [fen, setFen] = useState(start);
    return (
      <Board
        fen={fen}
        orientation="white"
        humanSide="white"
        lastMove={null}
        locked={false}
        onMove={(uci, after) => {
          onMove(uci);
          setFen(after);
        }}
      />
    );
  }

  // jsdom lays nothing out; the move animation needs a square width.
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 40, 40),
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it("draws the position and plays a move by clicking two squares", async () => {
    const onMove = vi.fn();
    renderWithProviders(<Played start={START_FEN} onMove={onMove} />);
    expect(pieceOn("e1")).toBe("wK");
    expect(pieceOn("d8")).toBe("bQ");
    expect(pieceOn("e4")).toBeUndefined();
    clickSquare("e2");
    clickSquare("e4");
    expect(onMove).toHaveBeenCalledWith("e2e4");
    await waitFor(() => expect(pieceOn("e4")).toBe("wP"));
    expect(pieceOn("e2")).toBeUndefined();
  });

  it("promotes a pawn to the piece chosen", async () => {
    const onMove = vi.fn();
    renderWithProviders(<Played start="8/k1P5/2K5/8/8/8/8/8 w - - 0 1" onMove={onMove} />);
    clickSquare("c7");
    clickSquare("c8");
    expect(onMove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Promote to rook" }));
    expect(onMove).toHaveBeenCalledWith("c7c8r");
    await waitFor(() => expect(pieceOn("c8")).toBe("wR"));
  });
});

describe("MoveStrip", () => {
  it("lays the moves out in one line of buttons and follows new ones at its end", () => {
    const onSelect = vi.fn();
    const strip = (entries: MoveEntry[], selected: number | null) => (
      <MoveStrip entries={entries} startFen={START_FEN} selected={selected} onSelect={onSelect} />
    );
    const { rerender } = render(strip([], null));
    expect(screen.getByText("No moves yet.")).toBeInTheDocument();
    rerender(strip([e4, e5], 1));
    const list = screen.getByLabelText("move list");
    Object.defineProperty(list, "scrollWidth", { value: 500, configurable: true });
    Object.defineProperty(list, "clientWidth", { value: 100, configurable: true });
    rerender(strip([e4, e5, nf3], 2));
    expect(list.scrollLeft).toBe(500);
    expect(screen.getByRole("button", { name: "Nf3" })).toHaveAttribute("aria-current", "step");
    fireEvent.click(screen.getByRole("button", { name: "e4" }));
    expect(onSelect).toHaveBeenCalledWith(0);
    list.scrollLeft = 0;
    fireEvent.scroll(list);
    rerender(strip([e4, e5, nf3, nc6], 3));
    expect(list.scrollLeft).toBe(0);
  });

  it("keeps a move the reader went to in view, sideways", () => {
    const spy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect");
    spy.mockImplementation(function (this: HTMLElement) {
      if (this.getAttribute("aria-label") === "move list")
        return { left: 0, width: 100 } as DOMRect;
      return { left: this.textContent === "e4" ? 200 : 30, width: 40 } as DOMRect;
    });
    const strip = (selected: number) => (
      <MoveStrip entries={[e4, e5]} startFen={AFTER_E4} selected={selected} onSelect={vi.fn()} />
    );
    const { rerender } = render(strip(1));
    rerender(strip(0));
    expect(screen.getByLabelText("move list").scrollLeft).toBe(170);
    expect(screen.getByText("1\u2026")).toBeInTheDocument();
    spy.mockRestore();
  });
});

describe("PlayerStrip", () => {
  it("names the side, and shows what it is up and by how much", () => {
    const fen = "4k3/8/8/8/8/8/PP6/R3K3 w - - 0 1";
    const { rerender } = render(
      <PlayerStrip
        side="white"
        name="You"
        fen={fen}
        showMaterial
        status={<span>Your turn</span>}
      />,
    );
    const strip = screen.getByLabelText("white player");
    expect(strip).toHaveTextContent("You");
    expect(strip).toHaveTextContent("+7");
    expect(strip).toHaveTextContent("Your turn");
    expect(strip.querySelector("[data-role=r]")?.children).toHaveLength(1);
    expect(strip.querySelector("[data-role=p]")?.children).toHaveLength(2);
    expect(strip.querySelector(".material-black")).toBeNull();
    rerender(<PlayerStrip side="black" name="Jev" fen={fen} showMaterial />);
    expect(screen.getByLabelText("black player")).not.toHaveTextContent("+");
    rerender(
      <PlayerStrip side="black" name="Jev" fen="r3k3/8/8/8/8/8/8/4K3 w - - 0 1" showMaterial />,
    );
    const black = screen.getByLabelText("black player");
    expect(black.querySelector("[data-role=r] > span")).toHaveClass("material-black");
    rerender(<PlayerStrip side="white" name="You" fen={fen} showMaterial={false} />);
    expect(screen.queryByLabelText("material")).not.toBeInTheDocument();
  });
});
