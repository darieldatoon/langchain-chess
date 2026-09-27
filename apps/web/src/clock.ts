// A timed game's two clocks, kept by the client as a UCI GUI keeps them. Pure: every time comes
// in as `now`, in ms from whatever monotonic source the caller owns.
import {
  opposite,
  type ClockInput,
  type Outcome,
  type Ply,
  type Side,
  type TimeControl,
} from "@langchain-chess/chess-ui";

export interface Clock {
  readonly control: TimeControl;
  /** Each side's time left; for the side whose clock runs, as of `running.since`. */
  readonly left: Readonly<Record<Side, number>>;
  readonly running: { readonly side: Side; readonly since: number } | null;
  /** How many of the record's plies the clock has taken in. */
  readonly plies: number;
  /**
   * The clock as the human's move was sent, until that move's ply lands. A run that ends
   * without it (a rejected move, a failed submit) goes back to it.
   */
  readonly beforeMove: { readonly plies: number; readonly clock: Clock } | null;
}

/** Under this, a clock shows tenths and reads as low. */
export const LOW_MS = 10_000;

export function newClock(control: TimeControl): Clock {
  return {
    control,
    left: { white: control.base_ms, black: control.base_ms },
    running: null,
    plies: 0,
    beforeMove: null,
  };
}

/** A `now` from before the clock started counts as its start: a clock never gains time. */
export function remaining(clock: Clock, side: Side, now: number): number {
  const run = clock.running;
  return clock.left[side] - (run?.side === side ? Math.max(0, now - run.since) : 0);
}

export function stop(clock: Clock, now: number): Clock {
  const run = clock.running;
  if (!run) return clock;
  return {
    ...clock,
    left: { ...clock.left, [run.side]: remaining(clock, run.side, now) },
    running: null,
  };
}

export function start(clock: Clock, side: Side, now: number): Clock {
  if (clock.running?.side === side) return clock;
  return { ...stop(clock, now), running: { side, since: now } };
}

/**
 * The human's move is sent: their clock stops and the agent's starts. The increment comes with
 * the move's recorded ply, so a move that never lands earns none.
 */
export function sendMove(clock: Clock, human: Side, plies: number, now: number): Clock {
  return {
    ...start(stop(clock, now), opposite(human), now),
    beforeMove: { plies, clock },
  };
}

/** `side` moved: its clock stops and gains the increment. */
export function press(clock: Clock, side: Side, now: number): Clock {
  const stopped = stop(clock, now);
  const left = stopped.left[side] + clock.control.increment_ms;
  return { ...stopped, left: { ...stopped.left, [side]: left } };
}

/** `side`'s flag fell: its clock stops at zero. */
export function fall(clock: Clock, side: Side, now: number): Clock {
  const stopped = stop(clock, now);
  return { ...stopped, left: { ...stopped.left, [side]: 0 } };
}

/**
 * Takes in the plies the clock hasn't seen: each mover's recorded time becomes its clock, and a
 * mover whose clock ran stops. So the agent's clock reads what the core charged, not the
 * client's estimate, which counted network lag too.
 */
export function recorded(clock: Clock, plies: readonly Ply[]): Clock {
  if (plies.length <= clock.plies) return clock;
  return plies.slice(clock.plies).reduce<Clock>(
    (c, ply) =>
      typeof ply.clock_ms === "number"
        ? {
            ...c,
            left: { ...c.left, [ply.side]: ply.clock_ms },
            running: c.running?.side === ply.side ? null : c.running,
          }
        : c,
    { ...clock, plies: plies.length, beforeMove: null },
  );
}

/** What a run sends: whole ms, rounded up so time left never reads as zero, never below it. */
export function clockInput(clock: Clock, now: number): ClockInput {
  const ms = (side: Side) => Math.max(0, Math.ceil(remaining(clock, side, now)));
  return { control: clock.control, white_ms: ms("white"), black_ms: ms("black") };
}

/** The side whose time ran out, for a game that ended on time; that side was to move. */
export function flaggedSide(outcome: Outcome | null, toMove: Side): Side | null {
  if (outcome?.kind === "timeout") return opposite(outcome.winner);
  if (outcome?.kind === "draw" && outcome.reason === "timeout_vs_insufficient_material") {
    return toMove;
  }
  return null;
}

export interface Turn {
  human: Side;
  toMove: Side;
  over: boolean;
  /** A run from this client is under way, or about to be. */
  inFlight: boolean;
  /** A failed turn waits for Retry. */
  pendingTurn: boolean;
  /** The first run has recorded the time control. */
  started: boolean;
}

/**
 * Whose clock should run. The agent's runs only through a run this client sent, from the
 * submit until its move lands; the human's through their turn, once the game has started, until
 * it reads zero. A failed turn waiting for Retry runs neither.
 */
export function runnerOf(clock: Clock, turn: Turn): Side | null {
  if (turn.over) return null;
  const agent = opposite(turn.human);
  if (turn.inFlight) return clock.running?.side === agent ? agent : null;
  if (turn.pendingTurn || !turn.started) return null;
  // A clock at zero stays stopped: its flag has fallen, and Retry sends it if the request failed.
  return turn.toMove === turn.human && clock.left[turn.human] > 0 ? turn.human : null;
}

/**
 * The clock caught up with the record and the turn: new plies taken in, then the side that
 * should run started and any other stopped. `now` is read only when a clock starts or stops.
 */
export function synced(clock: Clock, plies: readonly Ply[], turn: Turn, now: () => number): Clock {
  const sent = clock.beforeMove;
  const unsent = sent && !turn.inFlight && plies.length <= sent.plies ? sent.clock : clock;
  const taken = recorded(unsent, plies);
  const runner = runnerOf(taken, turn);
  if (runner === (taken.running?.side ?? null)) return taken;
  return runner ? start(taken, runner, now()) : stop(taken, now());
}
