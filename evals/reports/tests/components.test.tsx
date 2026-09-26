import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { Answer } from "../src/components/Answer";
import { DataTable } from "../src/components/DataTable";
import { MetricCard } from "../src/components/MetricCard";
import { PositionExample } from "../src/components/PositionExample";
import { ReportHeader, ReportPage } from "../src/components/ReportHeader";
import { RunBarChart } from "../src/components/RunBarChart";
import { Prose, Section } from "../src/components/Section";
import { valueLabel } from "../src/components/valueLabel";

describe("layout", () => {
  it("renders a section with its eyebrow, and prose", () => {
    render(
      <Section id="q1" eyebrow="Question 1" title="How often?">
        <Prose>Body</Prose>
      </Section>,
    );
    expect(screen.getByText("Question 1")).toBeInTheDocument();
    expect(screen.getByText("How often?")).toBeInTheDocument();
    expect(document.getElementById("q1")).toContainElement(screen.getByText("Body"));
  });

  it("renders a section without an eyebrow", () => {
    render(
      <Section id="s" title="Plain">
        x
      </Section>,
    );
    expect(screen.getByText("Plain")).toBeInTheDocument();
  });

  it("renders the header with links and contents", () => {
    render(
      <ReportPage>
        <ReportHeader
          eyebrow="evals · 2026-09-26"
          title="Title"
          linksLabel="In LangSmith:"
          links={[{ href: "https://smith/x", label: "Experiment" }]}
          contents={[{ id: "q1", label: "Question 1" }]}
        >
          Intro
        </ReportHeader>
      </ReportPage>,
    );
    expect(screen.getByRole("link", { name: "Experiment" })).toHaveAttribute("target", "_blank");
    const nav = screen.getByRole("navigation", { name: "Contents" });
    expect(within(nav).getByRole("link", { name: "Question 1" })).toHaveAttribute("href", "#q1");
    expect(screen.getByText("In LangSmith:")).toBeInTheDocument();
  });

  it("renders a header without a links label", () => {
    render(
      <ReportHeader eyebrow="e" title="t" links={[]} contents={[]}>
        i
      </ReportHeader>,
    );
    expect(screen.queryByText("In LangSmith:")).not.toBeInTheDocument();
  });

  it("renders an answer and a metric card", () => {
    render(
      <>
        <Answer>Yes.</Answer>
        <MetricCard label="Top-1" value="27.2%" hint="Jev rich" />
        <MetricCard label="Bare" value="0" />
      </>,
    );
    expect(screen.getByText("Answer")).toBeInTheDocument();
    expect(screen.getByText("27.2%")).toBeInTheDocument();
    expect(screen.getByText("Jev rich")).toBeInTheDocument();
  });
});

describe("DataTable", () => {
  it("renders the head, rows, a highlighted row and a note", () => {
    render(
      <DataTable
        head={["Run", "Top-1"]}
        rows={[
          ["A", "1%"],
          ["B", "2%"],
        ]}
        highlight={(i) => i === 1}
        note="A note"
      />,
    );
    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(rows[2]).toHaveClass("bg-surface-level-2");
    expect(rows[1]).not.toHaveClass("bg-surface-level-2");
    expect(screen.getByText("A note")).toBeInTheDocument();
  });

  it("renders without a highlight or note", () => {
    render(<DataTable head={["Run"]} rows={[["A"]]} />);
    expect(screen.getAllByRole("row")[1]).not.toHaveClass("bg-surface-level-2");
  });
});

describe("RunBarChart", () => {
  const bars = [
    { label: "SemIf rich", value: 0.244, color: "var(--chart-categorical-fill-1)" },
    { label: "Jev rich", value: null, color: "var(--chart-categorical-fill-2)" },
  ];

  it("labels the chart for assistive technology, with a chance band", () => {
    render(<RunBarChart title="Top-1" description="desc" bars={bars} chance={0.05} />);
    expect(screen.getByText("Top-1")).toBeInTheDocument();
    expect(screen.getByText("desc")).toBeInTheDocument();
    expect(
      document.querySelector('[aria-label="Top-1: SemIf rich 24.4%, Jev rich none"]'),
    ).not.toBeNull();
  });

  it("formats values with a custom formatter", () => {
    render(
      <RunBarChart
        title="cp"
        bars={[{ ...bars[0], value: 219 }]}
        max={400}
        format={(v) => `${v} cp`}
      />,
    );
    expect(document.querySelector('[aria-label="cp: SemIf rich 219 cp"]')).not.toBeNull();
  });
});

describe("valueLabel", () => {
  it("prints the formatted value past the end of the bar", () => {
    const label = valueLabel((v) => `${v}!`)({
      x: 10,
      y: 20,
      width: 100,
      height: 8,
      value: 3,
    } as never);
    const { container } = render(<svg>{label}</svg>);
    const text = container.querySelector("text");
    expect(text).toHaveTextContent("3!");
    expect(text).toHaveAttribute("x", "116");
    expect(text).toHaveAttribute("y", "24");
  });
});

describe("PositionExample", () => {
  const base = {
    title: "A costly miss",
    tags: ["2000-2399", "Tactic"],
    fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
    lastMove: "e2e4",
    orientation: "black" as const,
    best: "e7e5",
    engine: [
      { san: "e5", eval: "+0.2" },
      { san: "c5", eval: "+0.1" },
    ],
    gameUrl: "https://lichess.org/abc#1",
    positionId: "abc-001",
    context: "Black to move.",
  };
  const pick = (label: string, top: string) => ({
    label,
    url: `https://smith/${label}`,
    top,
    moves: [
      { san: top === "e7e5" ? "e5" : "c5", probability: 0.6, engineRank: top === "e7e5" ? 1 : 2 },
      { san: "d5", probability: 0.2, engineRank: 3 },
    ],
  });

  it("marks runs that agree with the engine and those that don't", () => {
    render(
      <PositionExample {...base} picks={[pick("SemIf", "c7c5"), pick("Jev", "e7e5")]}>
        Caption
      </PositionExample>,
    );
    expect(screen.getByText("Example: A costly miss")).toBeInTheDocument();
    expect(screen.getByText("Tactic")).toBeInTheDocument();
    expect(screen.getByText("SemIf's pick")).toBeInTheDocument();
    expect(screen.getByText("Jev agrees")).toBeInTheDocument();
    expect(screen.getByText("Caption")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "SemIf run in LangSmith" })).toHaveAttribute(
      "href",
      "https://smith/SemIf",
    );
    expect(screen.getByRole("link", { name: "Game on Lichess" })).toHaveAttribute(
      "href",
      base.gameUrl,
    );
    expect(
      screen.getByText("Position abc-001. Evals are in pawns for the side to move."),
    ).toBeInTheDocument();
  });

  it("colours a third run's miss like the second's", () => {
    render(
      <PositionExample {...base} picks={[pick("A", "c7c5"), pick("B", "c7c5"), pick("C", "c7c5")]}>
        x
      </PositionExample>,
    );
    expect(screen.getByText("C's pick")).toBeInTheDocument();
  });
});
