import { useStream } from "@langchain/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_CONTEXT,
  fenOrStart,
  isPending,
  lastPolicyPly,
  liveAnalysis,
  replay,
  rootAccepted,
  turnOf,
  type ChessValues,
  type DrawOffer,
  type MoveEntry,
  type Outcome,
  type Ply,
  type Reply,
  type ReplyState,
  type Side,
  type TurnRecord,
} from "@langchain-chess/chess-ui";
import { commandKey, createCommandIds } from "./commands";
import { apiUrl, configurableOf } from "./settings";
import { gameOf, type GameRecord } from "./setup";

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

/** A resign or draw command in flight. */
export type Control = "resign" | "draw";

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
  plies: readonly Ply[];
  turns: readonly TurnRecord[];
  entries: MoveEntry[];
  outcome: Outcome | null;
  error: string | null;
  drawOffers: readonly DrawOffer[];
  /** The server took this game's root: its first command made a turn. */
  rootAccepted: boolean;
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
  sending: Control | null;
  play: (uci: string, fenAfter: string) => Promise<void>;
  start: () => Promise<void>;
  retry: () => Promise<void>;
  /** For `side`, which the server can't know: it doesn't know which side is human. */
  resign: (side: Side) => Promise<void>;
  offerDraw: (side: Side) => Promise<void>;
}

const NO_MOVES: string[] = [];
const NO_OFFERS: DrawOffer[] = [];

/**
 * One `useStream` on the `chess` graph; one thread is one game, played with the setup its thread
 * records. `chosen` is a new game's side and context, used until the first turn records them.
 */
export function useGame(apiKey: string, chosen: GameRecord | null): Game {
  const [threadId, setThreadId] = useState(() => threadFromUrl());
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
  const [sending, setSending] = useState<Control | null>(null);
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
    (input: ChessValues) =>
      stream.submit(input, {
        config: { configurable, ...WEB_TRACE },
        metadata: { surface: "web" },
        multitaskStrategy: "reject",
      }),
    [stream, configurable],
  );

  const command = useCallback(
    (content: string) =>
      send({
        messages: [{ type: "human", id: commandId(commandKey(moves.length, content)), content }],
      }),
    [send, commandId, moves.length],
  );

  // Optimistic board: show the human's move until the run settles, success or error.
  const play = useCallback(
    async (uci: string, fenAfter: string) => {
      setPendingMove({ uci, fen: fenAfter });
      try {
        await command(uci);
      } finally {
        setPendingMove(null);
      }
    },
    [command],
  );

  const start = useCallback(() => command("go"), [command]);
  // Never resent: a consumed id resent while a turn is pending would retry that turn.
  const control = useCallback(
    async (kind: Control, side: Side) => {
      setSending(kind);
      try {
        await command(`${kind} ${side}`);
      } finally {
        setSending(null);
      }
    },
    [command],
  );
  const resign = useCallback((side: Side) => control("resign", side), [control]);
  const offerDraw = useCallback((side: Side) => control("draw", side), [control]);
  // Empty input resumes the pending turn; a fresh `go` would be rejected while one is pending.
  const retry = useCallback(() => send({}), [send]);

  const isThinking = stream.isLoading;
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
    plies,
    turns,
    entries,
    outcome: values.outcome ?? null,
    error: values.error ?? null,
    drawOffers: values.draw_offers ?? NO_OFFERS,
    rootAccepted: rootAccepted(values),
    record,
    reply,
    pendingTurn: isPending(turns),
    isThinking,
    isLoading: isThinking || stream.isThreadLoading,
    restore,
    streamError: stream.error,
    threadId,
    pendingMove,
    sending,
    play,
    start,
    retry,
    resign,
    offerDraw,
  };
}
