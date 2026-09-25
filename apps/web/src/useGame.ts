import { useStream } from "@langchain/react";
import { useCallback, useMemo, useState } from "react";
import { fenOrStart } from "./chess";
import { apiUrl, configurableOf } from "./settings";
import type { GameState, PlayContext, PlyView, Side, Status } from "./types";

export const GAME_GRAPH = "game";
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

export interface Game {
  fen: string;
  history: string[];
  plies: PlyView[];
  status: Status;
  result: string | null;
  error: string | null;
  player: string;
  humanSide: Side;
  lastPolicyPly: PlyView | null;
  isThinking: boolean;
  isLoading: boolean;
  streamError: unknown;
  threadId: string | null;
  pendingFen: string | null;
  play: (uci: string, fenAfter: string) => Promise<void>;
  start: () => Promise<void>;
  newGame: () => void;
}

/** One `useStream` on the `game` graph; a new game is a new thread. */
export function useGame(apiKey: string, context: PlayContext): Game {
  const [threadId, setThreadId] = useState<string | null>(() => threadFromUrl());
  const [pendingFen, setPendingFen] = useState<string | null>(null);

  const stream = useStream<GameState>({
    apiUrl: apiUrl(),
    apiKey: apiKey || undefined,
    assistantId: GAME_GRAPH,
    threadId,
    onThreadId: (id) => {
      setThreadId(id);
      writeThreadToUrl(id);
    },
  });

  const values = stream.values;
  const configurable = useMemo(() => configurableOf(context), [context]);

  const submit = useCallback(
    (input: { move?: string }) => stream.submit(input, { config: { configurable } }),
    [stream, configurable],
  );

  // Optimistic board: show the human's move until the run settles, success or error.
  const play = useCallback(
    async (uci: string, fenAfter: string) => {
      setPendingFen(fenAfter);
      try {
        await submit({ move: uci });
      } finally {
        setPendingFen(null);
      }
    },
    [submit],
  );

  const start = useCallback(() => submit({}), [submit]);

  const newGame = useCallback(() => {
    setPendingFen(null);
    setThreadId(null);
    writeThreadToUrl(null);
  }, []);

  const plies = values.plies ?? [];
  const lastPolicyPly = [...plies].reverse().find((p) => p.source !== "human") ?? null;

  return {
    fen: fenOrStart(values.fen),
    history: values.history ?? [],
    plies,
    status: values.status ?? "playing",
    result: values.result ?? null,
    error: values.error ?? null,
    player: values.player ?? "",
    humanSide: values.human_side ?? context.human_side,
    lastPolicyPly,
    isThinking: stream.isLoading,
    isLoading: stream.isLoading || stream.isThreadLoading,
    streamError: stream.error,
    threadId,
    pendingFen,
    play,
    start,
    newGame,
  };
}
