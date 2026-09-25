import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import type { MoveEntry } from "../format";
import { AFTER_E4, call, E4_E5, ply, systemOne, turn } from "../test/fixtures";
import { renderWithProviders } from "../test/renderApp";
import { START_FEN, type Ply, type SystemOneMeta } from "../types";
import type { Reply } from "../useGame";
import { Board } from "./Board";
import { MoveList } from "./MoveList";
import { PlyDetails } from "./PlyDetails";
import { ThemeToggle } from "./ThemeToggle";

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

describe("PlyDetails", () => {
  it("shows a hint without a reply", () => {
    details(null);
    expect(screen.getByText(/Make a move/)).toBeInTheDocument();
  });

  it("shows a System 1 move: source, model, cost, gate, and where it stood", () => {
    details(reply());
    expect(screen.getByText("System 1 played")).toBeInTheDocument();
    expect(screen.getByText("semif-qwen3.5-4b")).toBeInTheDocument();
    expect(screen.getByText("240 ms")).toBeInTheDocument();
    expect(screen.getByText("$0.0001")).toBeInTheDocument();
    expect(screen.getByText(/margin 0.92 vs threshold 0.90, System 1 played/)).toBeInTheDocument();
    expect(screen.getByText(/System 1 ranked #1 at 95%/)).toBeInTheDocument();
    expect(screen.queryByLabelText("system 1 candidates")).not.toBeInTheDocument();
    expect(screen.queryByText("Show LLM reply")).not.toBeInTheDocument();
  });

  it("shows an LLM move with System 1's shortlist, turn cost, and the markdown reply", () => {
    const meta = systemOne({
      status: "shortlist",
      shortlist: [
        { uci: "b8c6", probability: 0.55 },
        { uci: "g8f6", probability: 0.3 },
      ],
      followed: true,
      signal: 0.25,
      finalist_conditional: true,
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
    expect(screen.getByText(/System 1 suggested 2, the LLM followed/)).toBeInTheDocument();
    expect(screen.getByText(/ranked #1 at 55% among finalists/)).toBeInTheDocument();
    expect(screen.getByText("Candidates, probabilities among finalists")).toBeInTheDocument();
    expect(screen.getByLabelText("system 1 candidates")).toHaveTextContent("Nc6");
    expect(screen.getByLabelText("Nf6 probability among finalists")).toHaveAttribute(
      "aria-valuenow",
      "30",
    );
    fireEvent.click(screen.getByRole("button", { name: "Show LLM reply" }));
    expect(screen.getByRole("heading", { level: 2, name: "Plan" })).toBeInTheDocument();
    expect(screen.getByText("Nc6", { selector: ".markdown strong" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide LLM reply" }));
    expect(screen.queryByRole("heading", { level: 2, name: "Plan" })).not.toBeInTheDocument();
  });

  it("says when the LLM went off the shortlist, without probabilities among finalists", () => {
    const meta = systemOne({
      status: "shortlist",
      shortlist: [{ uci: "g8f6", probability: 0.6 }],
      followed: false,
      played_move_result: null,
    });
    details(reply({ source: "llm", uci: "b8c6", san: "Nc6" }, meta));
    expect(screen.getByText(/the LLM went its own way/)).toBeInTheDocument();
    expect(screen.getByText("Candidates, probabilities")).toBeInTheDocument();
    expect(screen.getByLabelText("Nf6 probability")).toBeInTheDocument();
    expect(screen.queryByText(/Played move/)).not.toBeInTheDocument();
  });

  it("omits the verdict detail and the gate line when the signal is missing", () => {
    details(reply({}, systemOne({ status: "shortlist", followed: null })));
    expect(screen.getByText(/System 1 suggested 0\./)).toBeInTheDocument();
    details(reply({ san: "Qh5" }, systemOne({ signal: null })));
    expect(screen.getAllByText(/Gate:/)).toHaveLength(1);
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
  it("renders the position", () => {
    render(
      <Board
        fen={START_FEN}
        orientation="white"
        humanSide="white"
        lastMove="e2e4"
        locked={false}
        onMove={vi.fn()}
      />,
    );
    expect(document.body).toBeTruthy();
  });
});

describe("ThemeToggle", () => {
  it("switches between light and dark", () => {
    renderWithProviders(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button", { name: "Switch to dark theme" }));
    expect(document.documentElement).toHaveClass("dark");
    fireEvent.click(screen.getByRole("button", { name: "Switch to light theme" }));
    expect(document.documentElement).not.toHaveClass("dark");
  });
});
