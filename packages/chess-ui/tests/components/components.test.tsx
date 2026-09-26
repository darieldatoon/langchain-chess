import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { MoveEntry } from "../../src/format";
import { AFTER_E4, call, E4_E5, ply, systemOne, turn } from "../../src/testing";
import { renderWithProviders } from "../support/renderApp";
import { START_FEN, type Ply, type Reply, type SystemOneMeta } from "../../src/types";
import { Board } from "../../src/components/Board";
import { MoveBar } from "../../src/components/MoveBar";
import { MoveList } from "../../src/components/MoveList";
import { PlyDetails } from "../../src/components/PlyDetails";

const e4: MoveEntry = { ply: 0, san: "e4", source: "external" };
const e5: MoveEntry = { ply: 1, san: "e5", source: "systemone" };
const nf3: MoveEntry = { ply: 2, san: "Nf3", source: "llm" };
const nc6: MoveEntry = { ply: 3, san: "Nc6", source: "forced" };

describe("MoveList", () => {
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
    expect(screen.getByText("3.")).toBeInTheDocument();
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

  it("scrolls the list, not the page, to keep the selected move in view", () => {
    const entries: MoveEntry[] = [e4, e5, nf3, nc6];
    // The list spans 100-200; e4 sits 40 above it, Nc6 10 below, the rest inside.
    const spy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect");
    spy.mockImplementation(function (this: HTMLElement) {
      if (this.getAttribute("aria-label") === "move list")
        return { top: 100, bottom: 200 } as DOMRect;
      const top = this.textContent === "e4" ? 60 : this.textContent === "Nc6" ? 190 : 110;
      return { top, bottom: top + 20 } as DOMRect;
    });
    const list = (selected: number | null) => (
      <MoveList entries={entries} startFen={START_FEN} selected={selected} onSelect={vi.fn()} />
    );
    const { rerender } = render(list(null));
    const el = screen.getByLabelText("move list");
    el.scrollTop = 50;
    rerender(list(1));
    expect(el.scrollTop).toBe(50);
    rerender(list(3));
    expect(el.scrollTop).toBe(60);
    rerender(list(0));
    expect(el.scrollTop).toBe(20);
    spy.mockRestore();
  });

  it("numbers a black-to-move root from its fullmove number", () => {
    render(<MoveList entries={[{ ...e5, ply: 0 }]} startFen={AFTER_E4} />);
    expect(screen.getByText("1.")).toBeInTheDocument();
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

const s1Reply = E4_E5.plies[1];

function reply(
  overrides: Partial<Ply> = {},
  meta?: SystemOneMeta,
  extra: Partial<Reply> = {},
): Reply {
  return {
    ply: {
      ...s1Reply,
      ...overrides,
      ...(meta ? { meta: { SystemOneMiddleware: { ...meta } } } : {}),
    },
    turn: E4_E5.turns[0],
    fenBefore: AFTER_E4,
    ...extra,
  };
}

function details(r: Reply | null) {
  return renderWithProviders(<PlyDetails reply={r} />);
}

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
});

describe("PlyDetails", () => {
  it("takes a title", () => {
    renderWithProviders(<PlyDetails reply={null} title="Move 3" />);
    expect(screen.getByRole("heading", { name: "Move 3" })).toBeInTheDocument();
  });

  it("shows a hint without a reply", () => {
    details(null);
    expect(screen.getByText(/Make a move/)).toBeInTheDocument();
  });

  it("streams the opponent's reasoning while it thinks, in place of the last reply", async () => {
    renderWithProviders(<PlyDetails reply={reply()} live="Weighing **Nf6**" />);
    expect(screen.getByLabelText("thinking")).toHaveTextContent("Reasoning");
    expect(await screen.findByText("Nf6", { selector: ".markdown strong" })).toBeInTheDocument();
    expect(screen.queryByLabelText("last reply")).not.toBeInTheDocument();
  });

  it("shows a System 1 move: source, model, cost, and its top moves with the played one marked", () => {
    details(reply());
    expect(screen.getByText("System 1 played")).toBeInTheDocument();
    expect(screen.getByText("semif-qwen3.5-4b")).toBeInTheDocument();
    expect(screen.getByText("240 ms")).toBeInTheDocument();
    expect(screen.getByText("$0.0001")).toBeInTheDocument();
    expect(screen.getByText("System 1's top moves")).toBeInTheDocument();
    expect(screen.getByLabelText("e5 (played) probability")).toHaveAttribute("aria-valuenow", "95");
    expect(screen.getByLabelText("c5 probability")).toHaveAttribute("aria-valuenow", "3");
    expect(screen.queryByText(/Gate/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reasoning/ })).not.toBeInTheDocument();
  });

  it("shows an LLM move with turn cost, System 1's top moves, and the reasoning open", async () => {
    const meta = systemOne({
      status: "shortlist",
      shortlist: [{ uci: "b8c6", probability: 0.55 }],
      top: [
        { uci: "b8c6", probability: 0.55 },
        { uci: "g8f6", probability: 0.3 },
      ],
      followed: true,
      played_move_result: [{ round: 2, heat: null, rank: 1, probability: 0.55, bye: false }],
    });
    const calls = [
      call({ kind: "systemone", cost_usd: 0.001 }),
      call({ cost_usd: 0.2, reasoning_tokens: 900 }),
      call({ cost_usd: null }),
    ];
    details(
      reply(
        {
          ply: 3,
          uci: "b8c6",
          san: "Nc6",
          source: "llm",
          model: "anthropic:claude-opus-5",
          latency_ms: 8200,
          analysis: "## Plan\n\nDevelop the knight.\n\nMOVE: **Nc6**",
        },
        meta,
        {
          turn: turn({ calls, illegal_attempts: 1 }),
          fenBefore: "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2",
        },
      ),
    );
    expect(screen.getByText("LLM chose")).toBeInTheDocument();
    expect(screen.getByLabelText("$0.201+ (incomplete estimate)")).toBeInTheDocument();
    expect(screen.getByText("900")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByLabelText("Nc6 (played) probability")).toHaveAttribute(
      "aria-valuenow",
      "55",
    );
    expect(screen.getByLabelText("Nf6 probability")).toHaveAttribute("aria-valuenow", "30");
    expect(await screen.findByRole("heading", { level: 2, name: "Plan" })).toBeInTheDocument();
    expect(screen.getByText("Nc6", { selector: ".markdown strong" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide reasoning" }));
    expect(screen.queryByRole("heading", { level: 2, name: "Plan" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show reasoning" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Plan" })).toBeInTheDocument();
  });

  it("adds the played move below the top moves when it reached the final", () => {
    const top = [{ uci: "g8f6", probability: 0.6 }];
    const final = { round: 1, heat: null, rank: 4, probability: 0.05, bye: false };
    details(reply({ uci: "b8c6", san: "Nc6" }, systemOne({ top, played_move_result: [final] })));
    expect(screen.getByLabelText("system 1 moves")).toHaveTextContent("…");
    expect(screen.getByLabelText("Nc6 (played) probability")).toHaveAttribute("aria-valuenow", "5");
  });

  it("leaves out a played move that went out in a heat, got a bye, or was never ranked", () => {
    const top = [{ uci: "g8f6", probability: 0.6 }];
    const heat = { round: 1, heat: 2, rank: 5, probability: 0.02, bye: false };
    const bye = { round: 1, heat: null, rank: 1, probability: 1, bye: true };
    for (const result of [[heat], [bye], null]) {
      details(reply({ uci: "b8c6", san: "Nc6" }, systemOne({ top, played_move_result: result })));
    }
    expect(screen.queryByText("…")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Nc6/)).not.toBeInTheDocument();
  });

  it("falls back to the shortlist for older games, and shows nothing without either", () => {
    const shortlist = [{ uci: "g8f6", probability: 0.6 }];
    details(reply({}, systemOne({ top: undefined, shortlist })));
    expect(screen.getByLabelText("Nf6 probability")).toBeInTheDocument();
    details(reply({}, systemOne({ top: undefined, played_move_result: null })));
    expect(screen.getAllByLabelText("system 1 moves")).toHaveLength(1);
  });

  it("shows why System 1 was skipped", () => {
    details(reply({ source: "llm" }, systemOne({ status: "skipped", error: "timeout" })));
    expect(screen.getByText("System 1 skipped: timeout")).toBeInTheDocument();
    details(reply({ source: "llm" }, systemOne({ status: "skipped", error: null })));
    expect(screen.getByText(/no reason given/)).toBeInTheDocument();
  });

  it("shows forced and unknown sources, and a dash without a turn or model", () => {
    details(reply({ source: "forced", meta: {} }, undefined, { turn: null }));
    expect(screen.getByText("Forced move")).toBeInTheDocument();
    expect(screen.getAllByText("—")).toHaveLength(1);
    details(reply({ source: "book", model: null, meta: {} }, undefined, { turn: turn() }));
    expect(screen.getByText("book")).toBeInTheDocument();
    expect(screen.getAllByText("—")).toHaveLength(3);
    expect(ply().source).toBe("external");
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
