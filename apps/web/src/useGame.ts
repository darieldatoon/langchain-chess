import { useStream } from "@langchain/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_CONTEXT,
  fenOrStart,
  isPending,
  lastPolicyPly,
  liveAnalysis,
  opposite,
  replay,
  sideToMove,
  turnOf,
  type ChessInput,
  type ChessValues,
  type MoveEntry,
  type Outcome,
  type Reply,
  type ReplyState,
  type Side,
} from "@langchain-chess/chess-ui";
import {
  clockInput,
  fall,
  newClock,
  press,
  remaining,
  sendMove,
  start as startClock,
  stop as stopClock,
  synced,
  type Clock,
} from "./clock";
import { commandKey, createCommandIds } from "./commands";
import { apiUrl, configurableOf } from "./settings";
import { gameOf, type GameRecord } from "./setup";
import { monotonic, type Now } from "./useClock";

export const CHESS_GRAPH = "chess";
/** The trace name and tags. `run_name` is missing from the SDK's `Config` type; the server honours it. */
export const WEB_TRACE = { run_name: "chess-web", tags: ["web"] };
const THREAD_PARAM = "thread";

export function threadFromUrl(search: string = window.location.search): string | null {
  return new URLSearchParams(search).get(THREAD_PARAM);
}

export function writeThreadToUrl(threadId: string | null, history: History = window.history): void {
  const url = new URL(window.location.href);
  if (threadId) url.searchParams.set(THREAD_PARAM, threadId);
  else url.searchParams.delete(THREAD_PARAM);
  history.replaceState(null, "", url);
}

/**
 * A game from the URL is played only once it has loaded: a failed load, or a thread the server
 * doesn't have, would otherwise look like a new game.
 */
export type Restore = "loading" | "missing" | "failed" | "ready";

export interface PendingMove {
  uci: string;
  fen: string;
}

export interface Game {
  startFen: string;
  fen: string;
  /** The start and the position after each move. */
  fens: string[];
  moves: string[];
  entries: MoveEntry[];
  outcome: Outcome | null;
  error: string | null;
  /** Null for a thread with no setup this app can read: it can only be shown. */
  record: GameRecord | null;
  /** Thinking for the whole run, so the card never falls back to the previous reply meanwhile. */
  reply: ReplyState;
  pendingTurn: boolean;
  isThinking: boolean;
  isLoading: boolean;
  restore: Restore;
  streamError: unknown;
  threadId: string | null;
  pendingMove: PendingMove | null;
  /** Null for an untimed game. */
  clock: Clock | null;
  /**
   * The clock to watch for a flag: null until the record shows the running side to move, so
   * a flag never overtakes the run that carries the human's move or the time control.
   */
  flaggable: Clock | null;
  /** The side to move whose clock reads zero with no flag recorded: Retry sends the flag. */
  fallen: Side | null;
  play: (uci: string, fenAfter: string) => Promise<void>;
  start: () => Promise<void>;
  retry: () => Promise<void>;
  /** Ends the game on time: `side`'s clock ran out. */
  flag: (side: Side) => Promise<void>;
}

const NO_MOVES: string[] = [];

/**
 * One `useStream` on the `chess` graph; one thread is one game, played with the setup its thread
 * records. `chosen` is a new game's side, context and clock, used until the first turn records
 * them. A timed game's clock lives here, timed by `now`.
 */
export function useGame(apiKey: string, chosen: GameRecord | null, now: Now = monotonic): Game {
  const [threadId, setThreadId] = useState(() => threadFromUrl());
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
  const [load, setLoad] = useState<{
    hydration: Promise<void>;
    restore: "missing" | "failed";
  } | null>(null);
  // One game per hook instance: the table remounts for a new game, which starts fresh ids.
  const [commandId] = useState(() => createCommandIds());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const stream = useStream<ChessValues>({
    apiUrl: apiUrl(),
    apiKey: apiKey || undefined,
    assistantId: CHESS_GRAPH,
    threadId,
    onThreadId: (id) => {
      // A replaced game's stream can still report its thread late; it must not rebind the page.
      if (!mounted.current) return;
      setThreadId(id);
      writeThreadToUrl(id);
    },
  });

  // A new client (a changed key) loads the thread again, with a new promise. Only a load for a
  // thread can find it missing: a new game's load, made before it had one, settles empty.
  const hydration = stream.hydrationPromise;
  const [target, setTarget] = useState({ hydration, threadId });
  if (target.hydration !== hydration) setTarget({ hydration, threadId });
  useEffect(() => {
    const { hydration, threadId } = target;
    // A superseded load settling late must not overwrite the current one's outcome.
    let cancelled = false;
    const settle = (restore: "missing" | "failed") =>
      cancelled ||
      setLoad((l) =>
        l?.hydration === hydration && l.restore === restore ? l : { hydration, restore },
      );
    hydration.then(
      // The SDK settles a 404 as a clean load that binds no thread stream.
      () => threadId !== null && !stream.getThread() && settle("missing"),
      () => settle("failed"),
    );
    return () => {
      cancelled = true;
    };
  }, [target, stream]);
  const restore: Restore =
    load?.hydration === hydration ? load.restore : stream.isThreadLoading ? "loading" : "ready";

  const values = stream.values;
  const startFen = fenOrStart(values.start_fen);
  const moves = values.moves ?? NO_MOVES;
  const plies = useMemo(() => values.plies ?? [], [values.plies]);
  const turns = useMemo(() => values.turns ?? [], [values.turns]);
  const position = useMemo(() => replay(startFen, moves), [startFen, moves]);

  const lastReply = useMemo((): Reply | null => {
    const ply = lastPolicyPly(plies);
    if (!ply) return null;
    return {
      ply,
      turn: turnOf(ply, turns),
      fenBefore: position.fens[ply.ply],
    };
  }, [plies, turns, position]);

  const entries = useMemo(
    () =>
      moves.map((uci, i) => ({
        ply: i,
        san: plies[i]?.san ?? position.sans[i] ?? uci,
        source: plies[i]?.source ?? "external",
      })),
    [moves, plies, position],
  );

  const record = useMemo(() => gameOf(values, chosen), [values, chosen]);
  // Without a record the board stays locked, so the stand-in never reaches a run.
  const configurable = useMemo(() => configurableOf(record?.context ?? DEFAULT_CONTEXT), [record]);

  const send = useCallback(
    (input: ChessInput, multitaskStrategy: "reject" | "interrupt" = "reject") =>
      stream.submit(input, {
        config: { configurable, ...WEB_TRACE },
        metadata: { surface: "web" },
        multitaskStrategy,
      }),
    [stream, configurable],
  );

  const human = record?.side ?? "white";
  const timeControl = record?.timeControl ?? null;
  const isThinking = stream.isLoading;
  const [keptClock, setClock] = useState<Clock | null>(null);
  // Built once the control is known, then kept in step with the record and the turn.
  const base = keptClock ?? (timeControl ? newClock(timeControl) : null);
  const clock =
    base &&
    synced(
      base,
      plies,
      {
        human,
        toMove: sideToMove(position.fen),
        over: values.outcome != null,
        inFlight: isThinking || pendingMove !== null,
        pendingTurn: isPending(turns),
        started: values.time_control != null,
      },
      now,
    );
  if (clock !== keptClock) setClock(clock);

  /** A timed run's clocks, after `mover`'s increment if it carries their move; the agent's runs. */
  const clocked = useCallback(
    (mover: Side | null): ChessInput => {
      if (!clock) return {};
      const at = now();
      const sent = mover ? press(clock, mover, at) : stopClock(clock, at);
      setClock(
        mover ? sendMove(clock, mover, plies.length, at) : startClock(sent, opposite(human), at),
      );
      return { clock: clockInput(sent, at) };
    },
    [clock, now, human, plies.length],
  );

  const command = useCallback(
    (content: string, timed: ChessInput) =>
      send({
        messages: [{ type: "human", id: commandId(commandKey(moves.length, content)), content }],
        ...timed,
      }),
    [send, commandId, moves.length],
  );

  // Once per side and position: a refused flag must not be sent again as its clock sits at zero.
  const flagged = useRef<string | null>(null);
  // The SDK's loading can drop while an interrupting flag is still running; this doesn't.
  const [flagging, setFlagging] = useState(false);
  const flag = useCallback(
    async (side: Side, again = false) => {
      const key = `${side}@${plies.length}`;
      if (!clock || (flagged.current === key && !again)) return;
      flagged.current = key;
      const at = now();
      const out = fall(clock, side, at);
      setClock(out);
      setFlagging(true);
      // The agent's run may be in flight. Interrupt, not rollback: rollback would delete its
      // checkpoints, the human's move among them.
      const strategy = side === human ? "reject" : "interrupt";
      try {
        await send({ clock: clockInput(out, at), flag: side }, strategy);
      } finally {
        setFlagging(false);
      }
    },
    [clock, now, human, plies.length, send],
  );

  // Optimistic board: show the human's move until the run settles, success or error.
  const play = useCallback(
    async (uci: string, fenAfter: string) => {
      // The flag timer may not have fired yet: a move after the flag fell is a flag.
      if (clock && remaining(clock, human, now()) <= 0) return flag(human);
      setPendingMove({ uci, fen: fenAfter });
      try {
        await command(uci, clocked(human));
      } finally {
        setPendingMove(null);
      }
    },
    [command, clocked, human, clock, now, flag],
  );

  const toMove = sideToMove(position.fen);
  const live = values.time_control != null && values.outcome == null;
  const flaggable = live && clock?.running?.side === toMove ? clock : null;
  const fallen =
    live && clock && !isThinking && !flagging && !clock.running && clock.left[toMove] <= 0
      ? toMove
      : null;

  const start = useCallback(() => command("go", clocked(null)), [command, clocked]);
  // Input without a command resumes the pending turn; a fresh `go` would be rejected while one
  // is pending. A flag whose request failed is sent again.
  const retry = useCallback(
    () => (fallen ? flag(fallen, true) : send(clocked(null))),
    [fallen, flag, send, clocked],
  );

  const reply = useMemo(
    (): ReplyState =>
      isThinking
        ? { status: "thinking", reasoning: liveAnalysis(stream.messages, turns, plies) }
        : lastReply
          ? { status: "played", reply: lastReply }
          : { status: "none" },
    [isThinking, stream.messages, turns, plies, lastReply],
  );

  return {
    startFen,
    fen: position.fen,
    fens: position.fens,
    moves,
    entries,
    outcome: values.outcome ?? null,
    error: values.error ?? null,
    record,
    reply,
    pendingTurn: isPending(turns),
    isThinking,
    isLoading: isThinking || stream.isThreadLoading,
    restore,
    streamError: stream.error,
    threadId,
    pendingMove,
    clock,
    flaggable,
    fallen,
    play,
    start,
    retry,
    flag,
  };
}
