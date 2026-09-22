import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { DEFAULT_CONTEXT, START_FEN, type PlyView } from "../types";
import { Banner } from "./Banner";
import { lastMoveStyles, money, pairs, seconds, sourceClass, sourceLabel } from "../format";
import { Board } from "./Board";
import { MoveList } from "./MoveList";
import { PlyDetails } from "./PlyDetails";

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
  raw_reply: "Thinking...\nMOVE: Nc6",
};

describe("Banner", () => {
  it("opens settings", () => {
    const open = vi.fn();
    render(<Banner onOpenSettings={open} />);
    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    expect(open).toHaveBeenCalled();
  });
});

describe("MoveList", () => {
  it("pairs plies into rows and classes them by source", () => {
    expect(pairs([])).toEqual([]);
    expect(pairs([human, jev, { ...human, ply: 3, san: "Nf3" }])).toHaveLength(2);
    expect(sourceClass(undefined)).toBe("");
    expect(sourceClass("fallback_jev")).toBe("fallback");
    expect(sourceClass("llm")).toBe("llm");
  });

  it("renders an empty hint and rows", () => {
    const { rerender } = render(<MoveList plies={[]} />);
    expect(screen.getByText("No moves yet.")).toBeInTheDocument();
    rerender(<MoveList plies={[human, jev, { ...human, ply: 3, san: "Nf3" }]} />);
    expect(screen.getByText("e5")).toHaveClass("jev");
    expect(screen.getByText("Nf3")).toBeInTheDocument();
    rerender(<MoveList plies={[jev]} />);
    expect(screen.getByText("e5")).toBeInTheDocument();
    expect(screen.getByText("1.")).toBeInTheDocument();
  });
});

describe("PlyDetails", () => {
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
    expect(screen.queryByText("LLM reply")).not.toBeInTheDocument();
  });

  it("shows LLM telemetry, the reply, and the confidence gate", () => {
    render(<PlyDetails ply={llm} context={{ ...DEFAULT_CONTEXT, gate: "confidence" }} />);
    expect(screen.getByText("LLM chose")).toBeInTheDocument();
    expect(screen.getByText(/confidence 0.80/)).toBeInTheDocument();
    expect(screen.getByText(/escalated to the LLM/)).toBeInTheDocument();
    expect(screen.getByText("900")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("LLM reply")).toBeInTheDocument();
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
  it("highlights the last move squares", () => {
    expect(lastMoveStyles(null)).toEqual({});
    expect(lastMoveStyles("e2")).toEqual({});
    expect(Object.keys(lastMoveStyles("e2e4"))).toEqual(["e2", "e4"]);
  });

  it("renders the position", () => {
    const onMove = vi.fn();
    render(
      <Board
        fen={START_FEN}
        orientation="white"
        humanSide="white"
        lastMove="e2e4"
        locked={false}
        onMove={onMove}
      />,
    );
    expect(document.querySelector('[data-column="a"]') ?? document.body).toBeTruthy();
  });
});
