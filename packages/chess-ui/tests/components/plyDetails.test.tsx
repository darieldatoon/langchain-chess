import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { PlyDetails } from "../../src/components/PlyDetails";
import { AFTER_E4, call, E4_E5, live, ply, systemOne, turn } from "../../src/testing";
import type { GameSoFar } from "../../src/turnStats";
import {
  DEFAULT_TURN_VIEW,
  START_FEN,
  type Ply,
  type Reply,
  type ReplyState,
  type Stages,
  type SystemOneLive,
  type SystemOneMeta,
  type TurnRecord,
  type TurnView,
} from "../../src/types";
import { renderWithProviders } from "../support/renderApp";

const HYBRID: Stages = { kind: "pipeline", systemOne: true, llm: true, certain: true };
const LLM_ONLY: Stages = { kind: "pipeline", systemOne: false, llm: true, certain: true };
const S1_ONLY: Stages = { kind: "pipeline", systemOne: true, llm: false, certain: true };

const SO_FAR: GameSoFar = {
  cost: { usd: 0.038, complete: true },
  agentMoves: 13,
  avgModelMs: 2000,
  bySource: { systemone: 6, llm: 6, forced: 1, other: 0 },
  abandoned: 1,
};

function reply(
  overrides: Partial<Ply> = {},
  meta?: SystemOneMeta,
  extra: Partial<Reply> = {},
): Reply {
  return {
    ply: {
      ...E4_E5.plies[1],
      ...overrides,
      ...(meta ? { meta: { SystemOneMiddleware: { ...meta } } } : {}),
    },
    turn: E4_E5.turns[0],
    fenBefore: AFTER_E4,
    stages: HYBRID,
    ...extra,
  };
}

function pending(overrides: Partial<Extract<ReplyState, { status: "pending" }>> = {}): ReplyState {
  return {
    status: "pending",
    activity: "running",
    error: null,
    turn: turn({ status: "pending", ply: null, initial_allowed: ["e7e5", "c7c5"] }),
    systemOne: null,
    analysis: null,
    fenBefore: AFTER_E4,
    stages: HYBRID,
    ...overrides,
  };
}

/** The card as an app drives it: the app holds the view. */
function Card({
  state,
  initial = DEFAULT_TURN_VIEW,
  soFar = SO_FAR,
}: {
  state: ReplyState;
  initial?: TurnView;
  soFar?: GameSoFar | null;
}) {
  const [view, setView] = useState(initial);
  return <PlyDetails reply={state} view={view} onViewChange={setView} soFar={soFar} />;
}

const show = (state: ReplyState, initial?: TurnView, soFar?: GameSoFar | null) =>
  renderWithProviders(<Card state={state} initial={initial} soFar={soFar} />);
const played = (r: Reply): ReplyState => ({ status: "played", reply: r });

/** The reserved slots, in order: what the card's shape is made of. */
const slots = (root: HTMLElement = document.body) =>
  [...root.querySelectorAll<HTMLElement>("[data-slot]")].map((el) => el.dataset.slot);
const stage = (name: string) => screen.getByRole("region", { name: `${name} stage` });
const figures = (name: string) =>
  within(stage(name)).queryByLabelText("stage time and cost")?.textContent ?? null;

describe("PlyDetails", () => {
  it("shows a placeholder before any turn, with its title", () => {
    renderWithProviders(
      <PlyDetails
        reply={{ status: "none" }}
        view={DEFAULT_TURN_VIEW}
        onViewChange={() => {}}
        title="Move 3"
      />,
    );
    expect(screen.getByRole("heading", { name: "Move 3" })).toBeInTheDocument();
    expect(screen.getByText("No reply yet.")).toBeInTheDocument();
    expect(screen.queryByLabelText("game so far")).not.toBeInTheDocument();
  });

  it("keeps the footer of a game a paid turn ended before any move", () => {
    const resigned = { ...SO_FAR, agentMoves: 0, avgModelMs: null, abandoned: 0 };
    renderWithProviders(
      <PlyDetails
        reply={{ status: "none" }}
        view={DEFAULT_TURN_VIEW}
        onViewChange={() => {}}
        soFar={resigned}
        placeholder="Start position."
      />,
    );
    expect(screen.getByText("Start position.")).toBeInTheDocument();
    expect(screen.getByLabelText("game so far")).toHaveTextContent("$0.038");
  });

  it("thinks with both stages waiting while a command is in flight", () => {
    show(pending({ turn: turn({ status: "pending", initial_allowed: [], calls: [] }) }));
    const card = screen.getByLabelText("last reply");
    expect(card).toHaveAttribute("aria-busy", "true");
    expect(within(card).getByText("Move 1 · Black")).toBeInTheDocument();
    expect(within(card).getByText("Thinking…")).toBeInTheDocument();
    expect(within(stage("System 1")).getByRole("img", { name: "Running" })).toBeInTheDocument();
    expect(within(stage("LLM")).getByText("Waiting")).toBeInTheDocument();
    expect(figures("System 1")).toBe("…");
    expect(figures("LLM")).toBe("…");
  });

  it("shows System 1's moves and the gate while the LLM is still thinking", async () => {
    show(pending({ systemOne: live(), analysis: "Weighing **e5**" }));
    expect(within(stage("System 1")).getByRole("img", { name: "Done" })).toBeInTheDocument();
    expect(figures("System 1")).toBe("400 ms · $0.0001");
    expect(screen.getByLabelText("system 1 moves")).toBeInTheDocument();
    expect(screen.getByLabelText("e5 probability")).toHaveAttribute("aria-valuenow", "40");
    expect(
      screen.getByText("Not confident enough: margin 0.02, bar 0.90 → asked the LLM"),
    ).toBeInTheDocument();
    expect(within(stage("LLM")).getByRole("img", { name: "Running" })).toBeInTheDocument();
    expect(await screen.findByText("e5", { selector: ".markdown strong" })).toBeInTheDocument();
  });

  it("keeps a stopped turn's progress and says what stopped it", () => {
    const stopped = pending({
      activity: "stopped",
      error: "Gateway timeout",
      systemOne: live(),
      analysis: "Half a thought",
      turn: turn({ status: "pending", calls: [call()], latency_ms: 3000, illegal_attempts: 1 }),
    });
    const { rerender } = show(stopped);
    expect(screen.getByLabelText("last reply")).toHaveAttribute("aria-busy", "false");
    expect(screen.getByText("Stopped")).toBeInTheDocument();
    expect(screen.getByLabelText("system 1 moves")).toBeInTheDocument();
    expect(screen.getByText("Half a thought")).toBeInTheDocument();
    expect(within(stage("LLM")).getByText("Failed")).toBeInTheDocument();
    expect(figures("LLM")).toBe("3.0 s · $0.010");
    expect(screen.getByText("Gateway timeout · 1 illegal move so far")).toBeInTheDocument();
    // After a reload there is no error to show, and nothing streamed yet.
    rerender(<Card state={{ ...stopped, error: null, analysis: null } as ReplyState} />);
    expect(screen.getByText("No analysis before it stopped.")).toBeInTheDocument();
    expect(screen.getByText("1 illegal move so far")).toBeInTheDocument();
  });

  it("fails a System 1-only turn that stopped without a result", () => {
    const { rerender } = show(pending({ activity: "stopped", stages: S1_ONLY }));
    expect(within(stage("System 1")).getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("System 1 didn't finish.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "LLM stage" })).not.toBeInTheDocument();
    rerender(<Card state={pending({ activity: "stopped", stages: S1_ONLY, error: "down" })} />);
    expect(screen.getByText("System 1 didn't finish: down")).toBeInTheDocument();
  });

  it("keeps the LLM not needed when a stopped hybrid turn's System 1 had played", () => {
    show(pending({ activity: "stopped", systemOne: live({ status: "played" }) }));
    expect(within(stage("System 1")).getByRole("img", { name: "Done" })).toBeInTheDocument();
    expect(within(stage("LLM")).getByText("Not needed")).toBeInTheDocument();
    expect(figures("LLM")).toBeNull();
    expect(screen.getByText(/^Confident: margin 0\.02.*→ played e5$/)).toBeInTheDocument();
  });

  it("shows a move System 1 played in a hybrid, the LLM not needed", () => {
    show(played(reply({}, systemOne({ latency_ms: 240 }))));
    const card = screen.getByLabelText("last reply");
    expect(card).toHaveAttribute("aria-busy", "false");
    expect(within(card).getByText("System 1 played")).toBeInTheDocument();
    expect(screen.getByLabelText("turn totals")).toHaveTextContent("240 ms · $0.0001");
    expect(figures("System 1")).toBe("240 ms · $0.0001");
    expect(screen.getByLabelText("e5 (played) probability")).toHaveAttribute("aria-valuenow", "95");
    expect(within(stage("LLM")).getByText("Not needed")).toBeInTheDocument();
    expect(screen.getByText("Confident: margin 0.92, bar 0.90 → played e5")).toBeInTheDocument();
  });

  it("shows an LLM move: its analysis, totals, and how it ranked with System 1", async () => {
    const calls = [
      call({ kind: "systemone", cost_usd: 0.001 }),
      call({ cost_usd: 0.2 }),
      call({ cost_usd: null }),
      call({ kind: "summary", cost_usd: 0.0004 }),
    ];
    const meta = systemOne({
      status: "shortlist",
      latency_ms: 200,
      top: [
        { uci: "b8c6", probability: 0.55 },
        { uci: "g8f6", probability: 0.3 },
      ],
    });
    show(
      played(
        reply(
          {
            uci: "g8f6",
            san: "Nf6",
            source: "llm",
            model: "anthropic:claude-opus-5",
            latency_ms: 8200,
            analysis: "## Plan\n\nDevelop.\n\nMOVE: **Nf6**",
          },
          meta,
          {
            turn: turn({ calls, illegal_attempts: 2, latency_ms: 8200 }),
            fenBefore: "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2",
          },
        ),
      ),
    );
    expect(screen.getByText("LLM chose")).toBeInTheDocument();
    expect(screen.getByText("Move 2 · Black")).toBeInTheDocument();
    expect(screen.getByLabelText("$0.201+ (incomplete estimate)")).toBeInTheDocument();
    expect(figures("LLM")).toBe("8.0 s · $0.200+");
    expect(within(stage("LLM")).getByText(/anthropic:claude-opus-5/)).toBeInTheDocument();
    expect(
      screen.getByText(
        "2 illegal moves before Nf6 · Nf6: System 1's #2 (30%) · Memory summarized · $0.0004",
      ),
    ).toBeInTheDocument();
    expect(await screen.findByRole("heading", { level: 2, name: "Plan" })).toBeInTheDocument();
  });

  it("says when a played move is outside System 1's displayed moves", () => {
    show(
      played(
        reply(
          { uci: "d7d5", san: "d5", source: "llm", analysis: null },
          systemOne({ status: "shortlist" }),
        ),
      ),
    );
    expect(screen.getByText("d5: not in System 1's top 2")).toBeInTheDocument();
    expect(screen.getByText("No analysis for this move.")).toBeInTheDocument();
  });

  it("names the LLM from the turn's calls when the ply doesn't", () => {
    show(
      pending({
        stages: LLM_ONLY,
        turn: turn({ status: "pending", calls: [call({ model: "openai:gpt-6" })] }),
      }),
    );
    expect(within(stage("LLM")).getByText(/openai:gpt-6/)).toBeInTheDocument();
    expect(within(stage("LLM")).getByText(/^① LLM/)).toBeInTheDocument();
  });

  it("shows only the legal move for a forced turn, from the first frame", () => {
    const { rerender } = show(pending({ stages: { kind: "forced" } }));
    expect(screen.getByText("Only legal move")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /stage/ })).not.toBeInTheDocument();
    rerender(
      <Card
        state={played(
          reply({ source: "forced", meta: {} }, undefined, { stages: { kind: "forced" } }),
        )}
      />,
    );
    expect(screen.getByText("Forced move")).toBeInTheDocument();
    expect(screen.getByText("Only legal move")).toBeInTheDocument();
  });

  it("shows why System 1 was skipped", () => {
    const { rerender } = show(
      played(reply({ source: "llm" }, systemOne({ status: "skipped", error: "timeout" }))),
    );
    expect(screen.getByText("System 1 skipped: timeout")).toBeInTheDocument();
    expect(within(stage("System 1")).getByText("Skipped")).toBeInTheDocument();
    rerender(
      <Card
        state={played(reply({ source: "llm" }, systemOne({ status: "skipped", error: null })))}
      />,
    );
    expect(screen.getByText(/no reason given/)).toBeInTheDocument();
  });

  it("leaves out a stage an uncertain legacy ply can't show ran", () => {
    const legacy: Stages = { kind: "pipeline", systemOne: true, llm: false, certain: false };
    show(played(reply({}, systemOne({ top: undefined }), { stages: legacy, turn: null })));
    expect(screen.getByRole("region", { name: "System 1 stage" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "LLM stage" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("turn totals")).toHaveTextContent("240 ms · —");
    expect(figures("System 1")).toBe("— · —");
    expect(screen.getByText("No System 1 moves.")).toBeInTheDocument();
  });

  it("shows a legacy LLM ply with no turn record, its figures unknown", () => {
    const legacy: Stages = { kind: "pipeline", systemOne: false, llm: true, certain: false };
    show(
      played(
        reply({ source: "llm", meta: {}, analysis: "Old" }, undefined, {
          stages: legacy,
          turn: null,
        }),
      ),
    );
    expect(figures("LLM")).toBe("— · —");
    expect(screen.getByText("Old")).toBeInTheDocument();
  });

  it("shows an external move as one line, with the footer", () => {
    show({ status: "external", ply: ply(), fenBefore: START_FEN, label: "Human move" });
    expect(screen.getByText("Move 1 · White")).toBeInTheDocument();
    expect(screen.getByText("Human")).toBeInTheDocument();
    expect(screen.getByText("Human move")).toBeInTheDocument();
    expect(screen.getByLabelText("game so far")).toBeInTheDocument();
  });

  it("adds the played move below the top moves when it reached the final, not otherwise", () => {
    const top = [{ uci: "g8f6", probability: 0.6 }];
    const final = { round: 1, heat: null, rank: 4, probability: 0.05, bye: false };
    const { rerender } = show(
      played(reply({ uci: "b8c6", san: "Nc6" }, systemOne({ top, played_move_result: [final] }))),
    );
    expect(screen.getByLabelText("system 1 moves")).toHaveTextContent("…");
    expect(screen.getByLabelText("Nc6 (played) probability")).toHaveAttribute("aria-valuenow", "5");
    const heat = { round: 1, heat: 2, rank: 5, probability: 0.02, bye: false };
    const bye = { round: 1, heat: null, rank: 1, probability: 1, bye: true };
    for (const result of [[heat], [bye], null]) {
      rerender(
        <Card
          state={played(
            reply({ uci: "b8c6", san: "Nc6" }, systemOne({ top, played_move_result: result })),
          )}
        />,
      );
      expect(screen.queryByLabelText(/Nc6/)).not.toBeInTheDocument();
    }
  });

  it("falls back to the shortlist for older games", () => {
    const shortlist = [{ uci: "g8f6", probability: 0.6 }];
    show(played(reply({}, systemOne({ top: undefined, shortlist }))));
    expect(screen.getByLabelText("Nf6 probability")).toBeInTheDocument();
  });

  it("previews System 1's moves, by hover only when the app hovers", () => {
    const onPin = vi.fn();
    const onHover = vi.fn();
    const state = played(reply({}, systemOne({ top: [{ uci: "g8f6", probability: 0.6 }] })));
    const { rerender } = renderWithProviders(
      <PlyDetails
        reply={state}
        view={DEFAULT_TURN_VIEW}
        onViewChange={() => {}}
        preview={{ onPin, onHover, pinned: "g8f6" }}
      />,
    );
    const nf6 = screen.getByRole("button", { name: "Preview Nf6" });
    expect(nf6).toHaveAttribute("aria-pressed", "true");
    fireEvent.mouseEnter(nf6);
    fireEvent.mouseLeave(nf6);
    expect(onHover.mock.calls).toEqual([["g8f6"], [null]]);
    fireEvent.click(nf6);
    expect(onPin).toHaveBeenCalledWith("g8f6");
    rerender(
      <PlyDetails
        reply={state}
        view={DEFAULT_TURN_VIEW}
        onViewChange={() => {}}
        preview={{ onPin, pinned: null }}
      />,
    );
    fireEvent.mouseEnter(screen.getByRole("button", { name: "Preview Nf6" }));
    expect(onHover).toHaveBeenCalledTimes(2);
    // No footer without the app's figures.
    expect(screen.queryByLabelText("game so far")).not.toBeInTheDocument();
  });

  it("sums the game so far, with this move's pace when it stands out", () => {
    show(played(reply({ latency_ms: 4000 })));
    const footer = screen.getByLabelText("game so far");
    expect(footer).toHaveTextContent("$0.038");
    expect(footer).toHaveTextContent("13 moves · avg 2.0 s model time · this move 2.0× avg");
    expect(footer).toHaveTextContent("System 1 played 6 · LLM 6 · forced 1 · 1 abandoned turn");
  });

  it("shows each stage's tokens when asked", () => {
    const tokens = { ...DEFAULT_TURN_VIEW, show: { ...DEFAULT_TURN_VIEW.show, tokens: true } };
    show(pending({ systemOne: live() }), tokens);
    const lines = screen.getAllByLabelText("token details").map((el) => el.textContent);
    expect(lines).toEqual([
      "in 1,000 · out 200 · cache read — · cache write — · reasoning 0",
      "in 0 · out 0 · cache read 0 · cache write 0 · reasoning 0",
    ]);
  });
});

describe("PlyDetails' shape", () => {
  const view = DEFAULT_TURN_VIEW;
  const openTurn = (overrides: Partial<TurnRecord> = {}) =>
    turn({ status: "pending", ply: null, initial_allowed: ["e7e5", "c7c5"], ...overrides });
  const committed = (overrides: Partial<TurnRecord> = {}) =>
    turn({ initial_allowed: ["e7e5", "c7c5"], ...overrides });
  const s1Meta = (l: SystemOneLive, extra: Partial<SystemOneMeta> = {}): SystemOneMeta => ({
    ...l,
    followed: null,
    played_move_result: null,
    ...extra,
  });

  it("gives every text slot a fixed height, so no text can grow it", () => {
    const tokens = { ...view, show: { ...view.show, tokens: true } };
    const { container } = show(pending({ systemOne: live() }), tokens);
    const slotted = [...container.querySelectorAll<HTMLElement>("[data-slot]")];
    expect(slotted.length).toBeGreaterThan(10);
    for (const el of slotted) {
      // A stage row holds only its controls, which are as tall on every frame.
      if (el.dataset.slot === "header" || el.dataset.slot?.startsWith("stage-")) continue;
      expect(el.className, el.dataset.slot).toMatch(/(^|\s)h-/);
    }
    for (const el of container.querySelectorAll<HTMLElement>("[data-slot^='tokens-'] > *")) {
      expect(el).toHaveClass("truncate");
    }
  });

  it("keeps every slot from the first real pending turn through the commit", () => {
    const result = live();
    const states: ReplyState[] = [
      pending({ turn: openTurn() }),
      pending({ turn: openTurn(), systemOne: result }),
      pending({ turn: openTurn(), systemOne: result, analysis: "Thinking about d5" }),
      // A memory summary and an illegal attempt arrive mid-turn.
      pending({
        turn: openTurn({ calls: [call({ kind: "summary" })], illegal_attempts: 1 }),
        systemOne: result,
        analysis: "Thinking about d5",
      }),
      played(
        reply({ uci: "d7d5", san: "d5", source: "llm", analysis: "d5" }, s1Meta(result), {
          turn: committed({ calls: [call()] }),
        }),
      ),
      // A played move outside System 1's top moves adds a row to the same area.
      played(
        reply(
          { uci: "d7d5", san: "d5", source: "llm", analysis: "d5" },
          s1Meta(result, {
            played_move_result: [{ round: 1, heat: null, rank: 9, probability: 0.01, bye: false }],
          }),
          { turn: committed({ calls: [call()] }) },
        ),
      ),
    ];
    const { rerender, container } = show(states[0], view);
    const first = slots(container);
    expect(first).toEqual([
      "header",
      "header-move",
      "header-source",
      "stage-systemone",
      "top-moves",
      "gate",
      "stage-llm",
      "analysis",
      "notes",
      "footer",
      "footer-figures",
      "footer-sources",
    ]);
    for (const state of states.slice(1)) {
      rerender(<Card state={state} initial={view} />);
      expect(slots(container)).toEqual(first);
    }
  });

  it("keeps the slots when System 1 is skipped or plays alone", () => {
    const { rerender, container } = show(pending({ turn: openTurn() }), view);
    const first = slots(container);
    const skipped = live({ status: "skipped", error: "down", signal: null, threshold_used: null });
    rerender(<Card state={pending({ turn: openTurn(), systemOne: skipped })} initial={view} />);
    expect(slots(container)).toEqual(first);
    const alone = live({ status: "played" });
    rerender(<Card state={pending({ turn: openTurn(), systemOne: alone })} initial={view} />);
    expect(slots(container)).toEqual(first);
    rerender(<Card state={played(reply({}, s1Meta(alone)))} initial={view} />);
    expect(slots(container)).toEqual(first);
  });

  it("changes shape once from the placeholder and the stand-in turn, forced included", () => {
    const { rerender, container } = show({ status: "none" }, view, null);
    expect(slots(container)).toEqual([]);
    const inFlight = pending({ turn: turn({ status: "pending", initial_allowed: [] }) });
    rerender(<Card state={inFlight} initial={view} />);
    expect(slots(container)).toContain("stage-llm");
    rerender(<Card state={pending({ stages: { kind: "forced" } })} initial={view} />);
    expect(slots(container)).toEqual([
      "header",
      "header-move",
      "header-source",
      "forced",
      "footer",
      "footer-figures",
      "footer-sources",
    ]);
  });

  it("changes shape only through Customize and the chevrons", async () => {
    const onViewChange = vi.fn();
    const state = pending({ systemOne: live() });
    const { rerender, container } = renderWithProviders(
      <PlyDetails reply={state} view={view} onViewChange={onViewChange} soFar={SO_FAR} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Hide System 1" }));
    expect(onViewChange).toHaveBeenLastCalledWith({
      ...view,
      open: { systemOne: false, llm: true },
    });
    fireEvent.click(screen.getByRole("button", { name: "Hide LLM" }));
    expect(onViewChange).toHaveBeenLastCalledWith({
      ...view,
      open: { systemOne: true, llm: false },
    });
    const closed = { ...view, open: { systemOne: false, llm: false } };
    rerender(<PlyDetails reply={state} view={closed} onViewChange={onViewChange} />);
    expect(slots(container)).toEqual([
      "header",
      "header-move",
      "header-source",
      "stage-systemone",
      "stage-llm",
    ]);
    expect(screen.getByRole("button", { name: "Show LLM" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );

    const trigger = screen.getByRole("button", { name: "Customize" });
    trigger.focus();
    await userEvent.click(trigger);
    const analysis = await screen.findByRole("switch", { name: "Analysis" });
    expect(analysis).toBeChecked();
    for (const name of [
      "System 1's moves",
      "Why the LLM was called",
      "Stage time and cost",
      "Game so far",
    ]) {
      expect(screen.getByRole("switch", { name })).toBeChecked();
    }
    expect(screen.getByRole("switch", { name: "Token details" })).not.toBeChecked();
    fireEvent.click(analysis);
    expect(onViewChange).toHaveBeenLastCalledWith({
      ...closed,
      show: { ...view.show, analysis: false },
    });
  });

  it("hides each part Customize turns off, while it streams too", () => {
    const off: TurnView = {
      open: { systemOne: true, llm: true },
      show: {
        topMoves: false,
        gate: false,
        analysis: false,
        stageStats: false,
        gameSoFar: false,
        tokens: false,
      },
    };
    const { container } = show(pending({ systemOne: live(), analysis: "Streaming" }), off);
    expect(screen.queryByText("Streaming")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("system 1 moves")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("stage time and cost")).not.toBeInTheDocument();
    expect(slots(container)).toEqual([
      "header",
      "header-move",
      "header-source",
      "stage-systemone",
      "stage-llm",
      "notes",
    ]);
  });
});
