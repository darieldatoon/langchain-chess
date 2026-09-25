import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  isAtBottom,
  lastMoveStyles,
  sliderValue,
  money,
  pairs,
  seconds,
  sourceClass,
  sourceLabel,
} from "../format";
import { DEFAULT_CONTEXT, START_FEN, type PlyView } from "../types";
import { Board } from "./Board";
import { MoveList } from "./MoveList";
import { PlyDetails } from "./PlyDetails";
import { renderWithProviders } from "../test/renderApp";
import { ThemeToggle } from "./ThemeToggle";

const human: PlyView = {
  ply: 1,
  side: "white",
  san: "e4",
  uci: "e2e4",
  source: "human",
  model: "human",
  latency_ms: 0,
};
const jev: PlyView = {
  ply: 2,
  side: "black",
  san: "e5",
  uci: "e7e5",
  source: "jev",
  model: "jev-latest",
  latency_ms: 240,
  cost_usd: 0.00006,
  jev_margin: 0.92,
  jev_confidence: 0.8,
  jev_top: [
    { uci: "e7e5", san: "e5", probability: 0.9 },
    { uci: "c7c5", san: "c5", probability: 0.1 },
  ],
};
const llm: PlyView = {
  ...jev,
  ply: 4,
  san: "Nc6",
  uci: "b8c6",
  source: "llm",
  model: "claude-opus-5",
  latency_ms: 8200,
  cost_usd: 0.245,
  reasoning_tokens: 900,
  illegal_attempts: 1,
  escalated: true,
  jev_margin: 0.1,
  raw_reply: "## Plan\n\nDevelop the knight.\n\nMOVE: **Nc6**",
};

describe("format helpers", () => {
  it("pairs plies into rows and classes them by source", () => {
    expect(pairs([])).toEqual([]);
    expect(pairs([human, jev, { ...human, ply: 3, san: "Nf3" }])).toHaveLength(2);
    expect(sourceClass(undefined)).toBe("");
    expect(sourceClass("fallback_jev")).toBe("fallback");
    expect(sourceClass("llm")).toBe("llm");
  });

  it("formats money, time, and labels", () => {
    expect(money(undefined)).toBe("n/a");
    expect(money(0.00006)).toBe("$0.0001");
    expect(money(0.245)).toBe("$0.245");
    expect(seconds(240)).toBe("240 ms");
    expect(seconds(8200)).toBe("8.2 s");
    expect(sourceLabel("jev")).toBe("Jev played");
    expect(sourceLabel("llm")).toBe("LLM chose");
    expect(sourceLabel("fallback_jev")).toBe("LLM failed, Jev played");
    expect(sourceLabel("fallback_random")).toBe("LLM failed, random move");
    expect(sourceLabel("engine")).toBe("Engine");
    expect(sourceLabel("other")).toBe("other");
  });

  it("highlights the last move squares", () => {
    expect(lastMoveStyles(null)).toEqual({});
    expect(lastMoveStyles("e2")).toEqual({});
    expect(Object.keys(lastMoveStyles("e2e4"))).toEqual(["e2", "e4"]);
  });

  it("takes the first slider value from a range", () => {
    expect(sliderValue(0.4)).toBe(0.4);
    expect(sliderValue([0.2, 0.8])).toBe(0.2);
  });

  it("detects the bottom within tolerance", () => {
    expect(isAtBottom({ scrollTop: 92, scrollHeight: 200, clientHeight: 100 })).toBe(true);
    expect(isAtBottom({ scrollTop: 40, scrollHeight: 200, clientHeight: 100 })).toBe(false);
  });
});

describe("MoveList", () => {
  it("renders an empty hint and rows, including a row without a white move", () => {
    const { rerender } = render(<MoveList plies={[]} />);
    expect(screen.getByText("No moves yet.")).toBeInTheDocument();
    rerender(<MoveList plies={[human, jev, { ...human, ply: 3, san: "Nf3" }]} />);
    expect(screen.getByText("e5")).toHaveClass("bg-brand-subtle");
    expect(screen.getByText("Nf3")).toBeInTheDocument();
    rerender(<MoveList plies={[{ ...jev, source: "fallback_jev" }]} />);
    expect(screen.getByText("e5")).toHaveClass("bg-error-subtle");
    expect(screen.getByText("1.")).toBeInTheDocument();
  });

  it("follows new moves while at the bottom and holds after a manual scroll up", () => {
    const { rerender } = render(<MoveList plies={[human]} />);
    const list = screen.getByLabelText("move list");
    Object.defineProperty(list, "scrollHeight", { value: 400, configurable: true });
    Object.defineProperty(list, "clientHeight", { value: 100, configurable: true });
    rerender(<MoveList plies={[human, jev]} />);
    expect(list.scrollTop).toBe(400);
    list.scrollTop = 10;
    fireEvent.scroll(list);
    rerender(<MoveList plies={[human, jev, { ...human, ply: 3, san: "Nf3" }]} />);
    expect(list.scrollTop).toBe(10);
    list.scrollTop = 300;
    fireEvent.scroll(list);
    rerender(
      <MoveList plies={[human, jev, { ...human, ply: 3, san: "Nf3" }, { ...jev, ply: 4 }]} />,
    );
    expect(list.scrollTop).toBe(400);
  });
});

describe("PlyDetails", () => {
  it("shows a hint without a ply", () => {
    render(<PlyDetails ply={null} context={DEFAULT_CONTEXT} />);
    expect(screen.getByText(/Make a move/)).toBeInTheDocument();
  });

  it("shows Jev telemetry with the gate line for the hybrid", () => {
    render(<PlyDetails ply={jev} context={DEFAULT_CONTEXT} />);
    expect(screen.getByText("Jev played")).toBeInTheDocument();
    expect(screen.getByText(/margin 0.92 vs threshold 0.90/)).toBeInTheDocument();
    expect(screen.getByText(/Jev was sure enough/)).toBeInTheDocument();
    expect(screen.getByLabelText("jev candidates").children).toHaveLength(2);
    expect(screen.getByLabelText("e5 probability")).toHaveAttribute("aria-valuenow", "90");
    expect(screen.queryByText("Show LLM reply")).not.toBeInTheDocument();
  });

  it("shows LLM telemetry, toggles the markdown reply, and uses the confidence gate", () => {
    render(<PlyDetails ply={llm} context={{ ...DEFAULT_CONTEXT, gate: "confidence" }} />);
    expect(screen.getByText("LLM chose")).toBeInTheDocument();
    expect(screen.getByText(/confidence 0.80/)).toBeInTheDocument();
    expect(screen.getByText(/escalated to the LLM/)).toBeInTheDocument();
    expect(screen.getByText("900")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show LLM reply" }));
    expect(screen.getByRole("heading", { level: 2, name: "Plan" })).toBeInTheDocument();
    expect(screen.getByText("Nc6", { selector: ".markdown strong" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide LLM reply" }));
    expect(screen.queryByRole("heading", { level: 2, name: "Plan" })).not.toBeInTheDocument();
  });

  it("uses a plain badge for engine moves", () => {
    render(
      <PlyDetails
        ply={{ ...jev, source: "engine", model: "random", jev_top: undefined }}
        context={DEFAULT_CONTEXT}
      />,
    );
    expect(screen.getByText("Engine")).toBeInTheDocument();
  });

  it("hides the gate line outside the hybrid or without a signal", () => {
    render(<PlyDetails ply={jev} context={{ ...DEFAULT_CONTEXT, policy: "jev" }} />);
    expect(screen.queryByText(/threshold/)).not.toBeInTheDocument();
    render(
      <PlyDetails ply={{ ...llm, jev_margin: null, jev_top: [] }} context={DEFAULT_CONTEXT} />,
    );
    expect(screen.queryByText(/threshold/)).not.toBeInTheDocument();
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
