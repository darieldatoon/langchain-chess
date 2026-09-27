import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { MoveEntry } from "../../src/format";
import { AFTER_E4, call, E4_E5, ply, systemOne, turn } from "../../src/testing";
import { renderWithProviders } from "../support/renderApp";
import {
  DEFAULT_PLY_VIEW,
  START_FEN,
  type Ply,
  type PlyView,
  type Reply,
  type ReplyState,
  type SystemOneMeta,
} from "../../src/types";
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

/** The card as an app drives it: the app holds the view. */
function Details({ reply, initial = DEFAULT_PLY_VIEW }: { reply: ReplyState; initial?: PlyView }) {
  const [view, setView] = useState(initial);
  return <PlyDetails reply={reply} view={view} onViewChange={setView} />;
}

function details(r: Reply | null, initial?: PlyView) {
  const state: ReplyState = r ? { status: "played", reply: r } : { status: "none" };
  return renderWithProviders(<Details reply={state} initial={initial} />);
}

function thinking(reasoning: string | null, initial?: PlyView) {
  return renderWithProviders(
    <Details reply={{ status: "thinking", reasoning }} initial={initial} />,
  );
}

/** A fact row's value, found by its label. */
const fact = (label: string, root: HTMLElement = document.body) =>
  within(root).getByText(label).nextElementSibling?.textContent;

const FACTS = ["Model", "Latency", "Cost", "Reasoning Tokens", "Illegal Attempts"];

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
    renderWithProviders(
      <PlyDetails
        reply={{ status: "none" }}
        view={DEFAULT_PLY_VIEW}
        onViewChange={() => {}}
        title="Move 3"
      />,
    );
    expect(screen.getByRole("heading", { name: "Move 3" })).toBeInTheDocument();
  });

  it("shows a hint without a reply", () => {
    details(null);
    expect(screen.getByText(/Make a move/)).toBeInTheDocument();
  });

  it("keeps its shape while the opponent thinks, streaming the reasoning into its section", async () => {
    thinking("Weighing **Nf6**");
    const card = screen.getByLabelText("last reply");
    expect(card).toHaveAttribute("aria-busy", "true");
    for (const label of FACTS) expect(fact(label)).toBe("");
    // The move, the five facts, and the top moves.
    expect(within(card).getAllByRole("img", { name: "loading" })).toHaveLength(7);
    expect(screen.getByRole("button", { name: "Hide top moves" })).toBeInTheDocument();
    expect(await screen.findByText("Nf6", { selector: ".markdown strong" })).toBeInTheDocument();
  });

  it("spins in the reasoning section before the first token", () => {
    thinking(null);
    expect(screen.getAllByRole("img", { name: "loading" })).toHaveLength(8);
    expect(screen.queryByText(/No reasoning/)).not.toBeInTheDocument();
  });

  it("keeps hidden sections hidden while it thinks, with a spinner on their toggles", () => {
    thinking("Weighing Nf6", { reasoning: false, topMoves: false });
    expect(screen.queryByText("Weighing Nf6")).not.toBeInTheDocument();
    for (const name of ["Show reasoning", "Show top moves"]) {
      const toggle = screen.getByRole("button", { name });
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(toggle.querySelector(".animate-spin")).not.toBeNull();
    }
    fireEvent.click(screen.getByRole("button", { name: "Show reasoning" }));
    expect(screen.getByText("Weighing Nf6")).toBeInTheDocument();
  });

  it("leaves the view to the app: toggling reports the new view and changes nothing itself", () => {
    const onViewChange = vi.fn();
    renderWithProviders(
      <PlyDetails
        reply={{ status: "played", reply: reply() }}
        view={{ reasoning: true, topMoves: false }}
        onViewChange={onViewChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Show top moves" }));
    expect(onViewChange).toHaveBeenLastCalledWith({ reasoning: true, topMoves: true });
    fireEvent.click(screen.getByRole("button", { name: "Hide reasoning" }));
    expect(onViewChange).toHaveBeenLastCalledWith({ reasoning: false, topMoves: false });
    expect(screen.getByRole("button", { name: "Show top moves" })).toBeInTheDocument();
    expect(screen.queryByLabelText("system 1 moves")).not.toBeInTheDocument();
    // A move played never spins its toggles.
    expect(document.querySelector(".animate-spin")).toBeNull();
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
    expect(fact("Reasoning Tokens")).toBe("0");
    expect(fact("Illegal Attempts")).toBe("0");
    expect(screen.getByLabelText("last reply")).toHaveAttribute("aria-busy", "false");
    expect(screen.getByText("No reasoning for this move.")).toBeInTheDocument();
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
    expect(fact("Reasoning Tokens")).toBe("900");
    expect(fact("Illegal Attempts")).toBe("1");
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

  it("has a Clock row only in a timed game, in every state, showing the mover's time", () => {
    details(reply({ clock_ms: 8_450 }));
    expect(screen.queryByText("Clock")).not.toBeInTheDocument();
    cleanup();

    const timed = (state: ReplyState) =>
      renderWithProviders(
        <PlyDetails reply={state} view={DEFAULT_PLY_VIEW} onViewChange={() => {}} timed />,
      );
    timed({ status: "played", reply: reply({ clock_ms: 8_450 }) });
    expect(fact("Clock")).toBe("00:08.4");
    cleanup();
    timed({ status: "played", reply: reply({ clock_ms: null }) });
    expect(fact("Clock")).toBe("—");
    cleanup();
    timed({ status: "thinking", reasoning: null });
    expect(fact("Clock")).toBe("");
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

  it("falls back to the shortlist for older games, and says so without either", () => {
    const shortlist = [{ uci: "g8f6", probability: 0.6 }];
    details(reply({}, systemOne({ top: undefined, shortlist })));
    expect(screen.getByLabelText("Nf6 probability")).toBeInTheDocument();
    details(reply({}, systemOne({ top: undefined, played_move_result: null })));
    expect(screen.getAllByLabelText("system 1 moves")).toHaveLength(1);
    expect(screen.getByText("No System 1 moves.")).toBeInTheDocument();
  });

  it("shows why System 1 was skipped", () => {
    details(reply({ source: "llm" }, systemOne({ status: "skipped", error: "timeout" })));
    expect(screen.getByText("System 1 skipped: timeout")).toBeInTheDocument();
    details(reply({ source: "llm" }, systemOne({ status: "skipped", error: null })));
    expect(screen.getByText(/no reason given/)).toBeInTheDocument();
  });

  it("shows forced and unknown sources, and a dash without a turn or model", () => {
    const forced = details(reply({ source: "forced", meta: {} }, undefined, { turn: null }));
    expect(screen.getByText("Forced move")).toBeInTheDocument();
    expect(FACTS.map((label) => fact(label, forced.container))).toEqual([
      "semif-qwen3.5-4b",
      "240 ms",
      "—",
      "—",
      "—",
    ]);
    expect(screen.getByText("No System 1 moves.")).toBeInTheDocument();
    const book = details(
      reply({ source: "book", model: null, meta: {} }, undefined, { turn: turn() }),
    );
    expect(screen.getByText("book")).toBeInTheDocument();
    expect(FACTS.map((label) => fact(label, book.container))).toEqual([
      "—",
      "240 ms",
      "—",
      "0",
      "0",
    ]);
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
