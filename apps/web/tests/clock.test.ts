import { describe, expect, it } from "vite-plus/test";
import { ply } from "@langchain-chess/chess-ui/testing";
import {
  clockInput,
  fall,
  flaggedSide,
  newClock,
  press,
  recorded,
  remaining,
  runnerOf,
  sendMove,
  start,
  stop,
  synced,
  type Turn,
} from "../src/clock";

const CONTROL = { base_ms: 60_000, increment_ms: 2_000 };
const fresh = newClock(CONTROL);

describe("the clock", () => {
  it("counts down only the running side, and never gains time", () => {
    const running = start(fresh, "white", 1_000);
    expect(remaining(running, "white", 4_000)).toBe(57_000);
    expect(remaining(running, "black", 4_000)).toBe(60_000);
    expect(remaining(running, "white", 500)).toBe(60_000);
    expect(start(running, "white", 9_000)).toBe(running);
  });

  it("charges the running side when it stops or hands over", () => {
    const stopped = stop(start(fresh, "white", 0), 5_000);
    expect(stopped.left).toEqual({ white: 55_000, black: 60_000 });
    expect(stopped.running).toBeNull();
    expect(stop(stopped, 9_000)).toBe(stopped);
    const handed = start(start(fresh, "white", 0), "black", 3_000);
    expect(handed.left.white).toBe(57_000);
    expect(handed.running).toEqual({ side: "black", since: 3_000 });
  });

  it("adds the increment to a side that moves, and zeroes one whose flag fell", () => {
    const moved = press(start(fresh, "white", 0), "white", 10_000);
    expect(moved.left.white).toBe(52_000);
    expect(moved.running).toBeNull();
    expect(fall(start(fresh, "black", 0), "black", 1_000).left).toEqual({
      white: 60_000,
      black: 0,
    });
  });

  it("sends whole ms rounded up, never below zero", () => {
    const running = start({ ...fresh, left: { white: 1_000.2, black: 500 } }, "black", 0);
    expect(clockInput(running, 800)).toEqual({ control: CONTROL, white_ms: 1_001, black_ms: 0 });
    const nearly = start({ ...fresh, left: { white: 1_000, black: 0.4 } }, "black", 0);
    expect(clockInput(nearly, 0).black_ms).toBe(1);
  });

  it("takes each mover's recorded time, stopping a clock that ran for it", () => {
    const thinking = start(fresh, "black", 0);
    const plies = [
      ply({ side: "white", clock_ms: 61_000 }),
      ply({ ply: 1, side: "black", clock_ms: 55_500 }),
    ];
    const clock = recorded(thinking, plies);
    expect(clock).toEqual({
      control: CONTROL,
      left: { white: 61_000, black: 55_500 },
      running: null,
      plies: 2,
      beforeMove: null,
    });
    expect(recorded(clock, plies)).toBe(clock);
  });

  it("skips plies without a time, and keeps a clock running for the other side", () => {
    const humanRunning = start(fresh, "white", 0);
    const clock = recorded(humanRunning, [ply({ side: "black" }), ply({ clock_ms: null })]);
    expect(clock.left).toEqual(fresh.left);
    expect(clock.running).toEqual(humanRunning.running);
    expect(clock.plies).toBe(2);
    const agentMoved = recorded(humanRunning, [ply({ side: "black", clock_ms: 30_000 })]);
    expect(agentMoved.running).toEqual(humanRunning.running);
  });
});

describe("sendMove", () => {
  it("hands the clock to the agent without the increment, which comes with the recorded ply", () => {
    const thinking = start(fresh, "white", 0);
    const sent = sendMove(thinking, "white", 0, 4_000);
    expect(sent.left.white).toBe(56_000);
    expect(sent.running).toEqual({ side: "black", since: 4_000 });
    expect(sent.beforeMove).toEqual({ plies: 0, clock: thinking });
    const landed = recorded(sent, [ply({ clock_ms: 58_000 })]);
    expect(landed.left.white).toBe(58_000);
    expect(landed.beforeMove).toBeNull();
  });
});

describe("flaggedSide", () => {
  it("names the side that ran out, and nobody otherwise", () => {
    expect(flaggedSide({ kind: "timeout", winner: "white" }, "white")).toBe("black");
    const draw = { kind: "draw", reason: "timeout_vs_insufficient_material" } as const;
    expect(flaggedSide(draw, "black")).toBe("black");
    expect(flaggedSide({ kind: "draw", reason: "stalemate" }, "black")).toBeNull();
    expect(flaggedSide({ kind: "checkmate", winner: "white" }, "black")).toBeNull();
    expect(flaggedSide(null, "white")).toBeNull();
  });
});

const turn = (overrides: Partial<Turn> = {}): Turn => ({
  human: "white",
  toMove: "white",
  over: false,
  inFlight: false,
  pendingTurn: false,
  started: true,
  ...overrides,
});
const agentRunning = start(fresh, "black", 0);

describe("runnerOf", () => {
  it("runs the human's clock on their turn, once the game has started", () => {
    expect(runnerOf(fresh, turn())).toBe("white");
    expect(runnerOf(fresh, turn({ started: false }))).toBeNull();
    expect(runnerOf(fresh, turn({ toMove: "black" }))).toBeNull();
  });

  it("runs the agent's clock through its run until its move lands", () => {
    expect(runnerOf(agentRunning, turn({ inFlight: true, toMove: "black" }))).toBe("black");
    expect(runnerOf(fresh, turn({ inFlight: true, toMove: "white" }))).toBeNull();
  });

  it("pauses a failed turn and a finished game", () => {
    expect(runnerOf(agentRunning, turn({ pendingTurn: true, toMove: "black" }))).toBeNull();
    expect(runnerOf(agentRunning, turn({ over: true, inFlight: true }))).toBeNull();
  });
});

describe("synced", () => {
  const never = () => {
    throw new Error("read the time");
  };

  it("leaves a clock already in step alone, without reading the time", () => {
    expect(synced(fresh, [], turn({ toMove: "black" }), never)).toBe(fresh);
  });

  it("starts the side that should run and stops the one that shouldn't", () => {
    expect(synced(fresh, [], turn(), () => 5_000).running).toEqual({ side: "white", since: 5_000 });
    const paused = synced(agentRunning, [], turn({ pendingTurn: true }), () => 4_000);
    expect(paused.running).toBeNull();
    expect(paused.left.black).toBe(56_000);
  });

  it("takes in the agent's move first, so its recorded time stands", () => {
    const landed = [ply({ side: "black", clock_ms: 58_000 })];
    const clock = synced(agentRunning, landed, turn({ inFlight: true }), never);
    expect(clock.left.black).toBe(58_000);
    expect(clock.running).toBeNull();
  });
});

describe("synced after the human's move was sent", () => {
  const thinking = start(fresh, "white", 0);
  const sent = sendMove(thinking, "white", 0, 4_000);

  it("keeps the agent's clock running while the run is under way", () => {
    expect(synced(sent, [], turn({ inFlight: true }), () => 9_000)).toBe(sent);
  });

  it("goes back to the clock before the move when the run ends without it", () => {
    const back = synced(sent, [], turn(), () => 9_000);
    expect(back).toBe(thinking);
    expect(remaining(back, "black", 9_000)).toBe(60_000);
  });

  it("keeps the move once its ply has landed", () => {
    const landed = [ply({ clock_ms: 58_000 })];
    const clock = synced(sent, landed, turn({ toMove: "black" }), () => 9_000);
    expect(clock.left).toEqual({ white: 58_000, black: 55_000 });
    expect(clock.running).toBeNull();
  });
});
