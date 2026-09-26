import { useStream } from "@langchain/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fenOrStart,
  isPending,
  lastPolicyPly,
  liveAnalysis,
  replay,
  turnOf,
  type ChessContext,
  type ChessValues,
  type MoveEntry,
  type Outcome,
  type Reply,
  type Side,
} from "@langchain-chess/chess-ui";
import { commandKey, createCommandIds } from "./commands";
import { apiUrl, configurableOf } from "./settings";
import { saveGame } from "./storage";

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

export interface PendingMove {
  uci: string;
  fen: string;
}

export interface Game {
  startFen: string;
  fen: string;
  moves: string[];
  entries: MoveEntry[];
  outcome: Outcome | null;
  error: string | null;
  humanSide: Side;
  lastReply: Reply | null;
  liveAnalysis: string | null;
  pendingTurn: boolean;
  isThinking: boolean;
  isLoading: boolean;
  streamError: unknown;
  threadId: string | null;
  pendingMove: PendingMove | null;
  play: (uci: string, fenAfter: string) => Promise<void>;
  start: () => Promise<void>;
  retry: () => Promise<void>;
}

const NO_MOVES: string[] = [];

/** One `useStream` on the `chess` graph; one thread is one game, played with one context. */
export function useGame(apiKey: string, context: ChessContext, humanSide: Side): Game {
  const [threadId, setThreadId] = useState<string | null>(() => threadFromUrl());
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
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
      saveGame(id, { side: humanSide, context });
      setThreadId(id);
      writeThreadToUrl(id);
    },
  });

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
      fenBefore: replay(startFen, moves.slice(0, ply.ply)).fen,
    };
  }, [plies, turns, startFen, moves]);

  const entries = useMemo(
    () =>
      moves.map((uci, i) => ({
        ply: i,
        san: plies[i]?.san ?? position.sans[i] ?? uci,
        source: plies[i]?.source ?? "external",
      })),
    [moves, plies, position],
  );

  const configurable = useMemo(() => configurableOf(context), [context]);

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
        messages: [
          { type: "human", id: commandId(commandKey(threadId, moves.length, content)), content },
        ],
      }),
    [send, commandId, threadId, moves.length],
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
  // Empty input resumes the pending turn; a fresh `go` would be rejected while one is pending.
  const retry = useCallback(() => send({}), [send]);

  const isThinking = stream.isLoading;

  return {
    startFen,
    fen: position.fen,
    moves,
    entries,
    outcome: values.outcome ?? null,
    error: values.error ?? null,
    humanSide,
    lastReply,
    liveAnalysis: isThinking ? liveAnalysis(stream.messages, turns, plies) : null,
    pendingTurn: isPending(turns),
    isThinking,
    isLoading: isThinking || stream.isThreadLoading,
    streamError: stream.error,
    threadId,
    pendingMove,
    play,
    start,
    retry,
  };
}
