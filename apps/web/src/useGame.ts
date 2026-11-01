import { useStream } from "@langchain/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_CONTEXT,
  START_FEN,
  isPending,
  lastPolicyPly,
  liveAnalysis,
  liveSystemOne,
  replay,
  replyOf,
  rootAccepted,
  stagesOf,
  type ChessValues,
  type DrawOffer,
  type Message,
  type MoveEntry,
  type Outcome,
  type Ply,
  type Policy,
  type PositionInput,
  type Reply,
  type ReplyState,
  type Side,
  type SystemOneLive,
  type TurnRecord,
} from "@langchain-chess/chess-ui";
import { sessionClient, type Session } from "./auth/session";
import { commandKey, createCommandIds } from "./commands";
import { apiUrl, configurableOf } from "./settings";
import { gameOf, startFenOf, type GameRecord } from "./setup";

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

/** What a run is sent: a position, a chat message, or nothing (resume the pending turn). */
type Command = { position: PositionInput } | { messages: Message[] } | Record<string, never>;

/** A game's first command from a chosen root, until the server answers it. */
interface FirstPacket {
  position: PositionInput;
  /** The human's first move in it, shown on the board meanwhile. */
  move: PendingMove | null;
  /** The values when it was sent: any other values are the server's answer. */
  sentOn: ChessValues;
}

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
  /** A first position packet is out with no answer yet: Retry resends it. */
  firstUnanswered: boolean;
  /** The server refused the chosen root; choosing another position is the way on. */
  startRejected: boolean;
  /** Null for a thread with no setup this app can read: it can only be shown. */
  record: GameRecord | null;
  /** The recorded policy, else the new game's; null for a thread with neither. */
  policy: Policy | null;
  /** Pending for the whole run and while a turn stays open, so the card never falls back to the
   * previous reply meanwhile. */
  reply: ReplyState;
  systemOneLive: SystemOneLive | null;
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

/** A command in flight that hasn't opened its turn yet; the first values update replaces it. */
const NONE: ReplyState = { status: "none" };

/** The last turn as id and status: once it differs from a run's start, the run's turn is in. */
const lastTurnKey = (turns: readonly TurnRecord[] | undefined) => {
  const last = turns?.at(-1);
  return last ? `${last.id}:${last.status}` : "";
};

const IN_FLIGHT: TurnRecord = {
  id: "",
  request: "",
  initial_allowed: [],
  status: "pending",
  ply: null,
  calls: [],
  rejected_message_ids: [],
  feedback_message_ids: [],
  opened_message_id: null,
  illegal_attempts: 0,
  latency_ms: 0,
};

/**
 * One `useStream` on the `chess` graph; one thread is one game, played with the setup its thread
 * records. `chosen` is a new game's side and context, used until the first turn records them.
 */
export function useGame(session: Session, chosen: GameRecord | null): Game {
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

  const client = useMemo(() => sessionClient(apiUrl(), session), [session]);
  const stream = useStream<ChessValues>({
    client,
    assistantId: CHESS_GRAPH,
    threadId,
    onThreadId: (id) => {
      // A replaced game's stream can still report its thread late; it must not rebind the page.
      if (!mounted.current) return;
      setThreadId(id);
      writeThreadToUrl(id);
    },
  });

  // A new client (a new sign-in) loads the thread again, with a new promise. Only a load for a
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
  const accepted = rootAccepted(values);
  const startFen = startFenOf(values, chosen);
  const moves = values.moves ?? NO_MOVES;
  const plies = useMemo(() => values.plies ?? [], [values.plies]);
  const turns = useMemo(() => values.turns ?? [], [values.turns]);
  const position = useMemo(() => replay(startFen, moves), [startFen, moves]);

  const record = useMemo(() => gameOf(values, chosen), [values, chosen]);
  const policy = record?.context.policy ?? null;
  const systemOneLive = liveSystemOne(values);
  const lastReply = useMemo((): Reply | null => {
    const ply = lastPolicyPly(plies);
    return ply ? replyOf(ply, turns, position.fens, policy) : null;
  }, [plies, turns, position, policy]);

  const entries = useMemo(
    () =>
      moves.map((uci, i) => ({
        ply: i,
        san: plies[i]?.san ?? position.sans[i] ?? uci,
        source: plies[i]?.source ?? "external",
      })),
    [moves, plies, position],
  );

  // Without a record the board stays locked, so the stand-in never reaches a run.
  const configurable = useMemo(() => configurableOf(record?.context ?? DEFAULT_CONTEXT), [record]);

  // The last turn a run started from: this page's own sends, and any pending turn it sees, such
  // as one already running when it loaded. Undefined until either happens.
  const [runFrom, setRunFrom] = useState<string | undefined>(undefined);
  const openKey = turns.at(-1)?.status === "pending" ? lastTurnKey(turns) : undefined;
  if (openKey !== undefined && openKey !== runFrom) setRunFrom(openKey);
  const send = useCallback(
    (input: Command) => {
      setRunFrom(lastTurnKey(stream.values.turns));
      // The SDK types a run's input as the thread's values; `position` is an input-only channel.
      return stream.submit(input as ChessValues, {
        config: { configurable, ...WEB_TRACE },
        metadata: { surface: "web" },
        multitaskStrategy: "reject",
      });
    },
    [stream, configurable],
  );

  const command = useCallback(
    (content: string) =>
      send({
        messages: [{ type: "human", id: commandId(commandKey(moves.length, content)), content }],
      }),
    [send, commandId, moves.length],
  );

  // A game from a chosen root opens with one position command, never a message (the server
  // rejects both together), and resends exactly that packet until the root is accepted.
  const [first, setFirst] = useState<FirstPacket | null>(null);
  const [startRejected, setStartRejected] = useState(false);
  const custom = chosen !== null && chosen.startFen !== START_FEN && !accepted;
  if (first && (accepted || values.outcome)) setFirst(null);
  // Only a response to the packet changes the values: a new error with no turn is its rejection.
  if (first && !stream.isLoading && values !== first.sentOn && values.error && !accepted) {
    setFirst(null);
    setStartRejected(true);
  }
  const sendFirst = useCallback(
    (packet: Omit<FirstPacket, "sentOn">) => {
      setFirst({ ...packet, sentOn: stream.values });
      setStartRejected(false);
      return send({ position: packet.position });
    },
    [send, stream],
  );

  // Optimistic board: show the human's move until the run settles, success or error; a first
  // packet's move stays until the root is accepted or rejected.
  const play = useCallback(
    async (uci: string, fenAfter: string) => {
      if (custom) {
        await sendFirst({
          position: { start_fen: startFen, moves: [uci] },
          move: { uci, fen: fenAfter },
        });
        return;
      }
      setPendingMove({ uci, fen: fenAfter });
      try {
        await command(uci);
      } finally {
        setPendingMove(null);
      }
    },
    [command, custom, sendFirst, startFen],
  );

  const start = useCallback(
    () => (custom ? sendFirst({ position: { start_fen: startFen }, move: null }) : command("go")),
    [command, custom, sendFirst, startFen],
  );
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
  // An unanswered first packet is resent unchanged: the server keys it by its fingerprint.
  const retry = useCallback(() => (first ? sendFirst(first) : send({})), [first, send, sendFirst]);

  const isThinking = stream.isLoading;
  const shownMove = pendingMove ?? first?.move ?? null;
  const reply = useMemo((): ReplyState => {
    const last = turns.at(-1);
    const open = last?.status === "pending" ? last : null;
    // A commit can land before the run stops loading: it shows at once, never the stand-in.
    const landed = runFrom !== undefined && lastTurnKey(turns) !== runFrom;
    if (!open && (!isThinking || landed)) {
      return lastReply ? { status: "played", reply: lastReply } : NONE;
    }
    const turn = open ?? IN_FLIGHT;
    return {
      status: "pending",
      activity: isThinking ? "running" : "stopped",
      // The table fills it in: it also holds the submit errors.
      error: null,
      turn,
      systemOne: systemOneLive,
      analysis: liveAnalysis(stream.messages, turns, plies),
      fenBefore: open ? position.fen : (shownMove?.fen ?? position.fen),
      stages: stagesOf(policy, turn, null),
    };
  }, [
    isThinking,
    runFrom,
    stream.messages,
    turns,
    plies,
    lastReply,
    systemOneLive,
    position,
    shownMove,
    policy,
  ]);

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
    rootAccepted: accepted,
    firstUnanswered: first !== null && !stream.isLoading,
    startRejected: startRejected && !accepted,
    record,
    policy,
    reply,
    systemOneLive,
    pendingTurn: isPending(turns),
    isThinking,
    isLoading: isThinking || stream.isThreadLoading,
    restore,
    streamError: stream.error,
    threadId,
    pendingMove: shownMove,
    sending,
    play,
    start,
    retry,
    resign,
    offerDraw,
  };
}
