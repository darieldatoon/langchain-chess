// Mirrors libs/chess/langchain_chess/state.py and libs/systemone/langchain_chess_systemone/types.py.
// Keep them in step by hand. The settings are generated: see ./generated/settings.ts.
import type { Gate, Policy } from "./generated/settings";

export type Side = "white" | "black";
export type PolicyKind = Policy;
export type GateSignal = Gate;

export type DrawReason =
  | "stalemate"
  | "insufficient_material"
  | "threefold"
  | "fivefold"
  | "fifty_moves"
  | "seventyfive_moves";

export type Outcome =
  | { kind: "checkmate"; winner: Side }
  | { kind: "draw"; reason: DrawReason }
  /** `illegal_moves` is a forfeit: the agent ran out of attempts at a legal move. */
  | { kind: "resignation"; winner: Side; reason: "illegal_moves" | "resigned" };

/** A draw offered at `ply` (the completed half-moves, possibly 0), and how it was answered. */
export interface DrawOffer {
  ply: number;
  by: Side;
  answer: "declined";
}

export interface Call {
  kind: "llm" | "systemone" | "summary";
  model: string;
  input_tokens: number | null;
  output_tokens: number | null;
  reasoning_tokens: number;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  cache_write_1h_tokens: number | null;
  called_at: string;
  cost_usd: number | null;
  cost_complete: boolean;
  priced_with: string | null;
}

export type TurnStatus = "pending" | "committed" | "abandoned" | "terminal";

export interface TurnRecord {
  id: string;
  request: string;
  initial_allowed: string[];
  status: TurnStatus;
  ply: number | null;
  calls: Call[];
  rejected_message_ids: string[];
  feedback_message_ids: string[];
  opened_message_id: string | null;
  illegal_attempts: number;
  latency_ms: number;
}

export interface Ply {
  ply: number;
  side: Side;
  uci: string;
  san: string;
  source: string;
  analysis: string | null;
  message_id: string | null;
  turn_id: string | null;
  model: string | null;
  latency_ms: number;
  meta: Record<string, Record<string, unknown>>;
}

export interface StageResult {
  round: number;
  heat: number | null;
  rank: number;
  probability: number;
  bye: boolean;
}

export interface TournamentMove {
  uci: string;
  stages: StageResult[];
  finalist: boolean;
}

export interface Tournament {
  max_options: number;
  rounds: number;
  finalists: string[];
  moves: TournamentMove[];
}

export interface RankedMove {
  uci: string;
  probability: number;
}

export interface SystemOneMeta {
  status: "played" | "shortlist" | "skipped";
  model: string;
  /** System 1's best moves whoever played; absent on games recorded before it existed. */
  top?: RankedMove[];
  shortlist: RankedMove[];
  followed: boolean | null;
  gate: GateSignal;
  signal: number | null;
  confidence: number | null;
  margin: number | null;
  threshold_used: number | null;
  finalist_conditional: boolean;
  played_move_result: StageResult[] | null;
  tournament: Tournament | null;
  error: string | null;
  latency_ms?: number;
  eval_score?: number | null;
  needs_calculation?: number | null;
  tactics_present?: number | null;
}

/**
 * `systemone_live`: System 1's decision as soon as it's made, before the LLM runs. Never cleared:
 * read it with `liveSystemOne`, which keeps it only while its turn is the pending one.
 */
export interface SystemOneLive extends Omit<
  SystemOneMeta,
  "top" | "followed" | "played_move_result" | "latency_ms"
> {
  turn_id: string;
  top: RankedMove[];
  latency_ms: number;
  /** System 1's calls this turn: they join the turn's own calls only when it finalizes. */
  calls: Call[];
}

export const SYSTEMONE_META_KEY = "SystemOneMiddleware";

/**
 * The shape both `stream.messages` (core `BaseMessage` instances) and a submitted command share.
 * Structural so the plain `{ type: "human", id, content }` a command sends type-checks too.
 */
/** A graded move's class. Mirrors `Quality` in libs/chess/langchain_chess/grading.py. */
export type Quality = "best" | "good" | "inaccuracy" | "mistake" | "blunder";

/** An engine evaluation from White's side, as the grader stores it. `mate: 0` is a mated position. */
export type Eval = { cp: number } | { mate: number; winner: Side };

/**
 * Which stages of the agent's pipeline a turn has, in the order they run. `certain` is false when
 * they were inferred from the ply, for a game with no readable policy: an absent stage is then
 * left out, never shown as not needed.
 */
export type Stages =
  | { kind: "pipeline"; systemOne: boolean; llm: boolean; certain: boolean }
  | { kind: "forced" };

/** An opponent ply with its turn, the position it was chosen from, and its stages. */
export interface Reply {
  ply: Ply;
  turn: TurnRecord | null;
  fenBefore: string;
  stages: Stages;
}

/** What the reply card shows: nothing yet, a move played, or a turn still open. */
export type ReplyState =
  | { status: "none" }
  | { status: "played"; reply: Reply }
  | {
      status: "pending";
      /** `stopped`: the run ended (failed, or the page reloaded) with the turn still open. */
      activity: "running" | "stopped";
      /** The stream or submit error, when this client saw one. */
      error: string | null;
      /** The pending turn with its completed LLM calls, or a stand-in before it opens. */
      turn: TurnRecord;
      systemOne: SystemOneLive | null;
      /** The text streamed so far; null before the first token. */
      analysis: string | null;
      fenBefore: string;
      stages: Stages;
    }
  /** Review only: a move from outside the agent. */
  | { status: "external"; ply: Ply; fenBefore: string; label: string };

/** What the reply card shows. The app owns it, so it outlives the card. */
export interface TurnView {
  /** Each stage's body, shown or hidden by its chevron. */
  open: { systemOne: boolean; llm: boolean };
  show: {
    topMoves: boolean;
    /** Why the LLM was called: the gate line. */
    gate: boolean;
    analysis: boolean;
    stageStats: boolean;
    gameSoFar: boolean;
    tokens: boolean;
  };
}

export const DEFAULT_TURN_VIEW: TurnView = {
  open: { systemOne: true, llm: true },
  show: {
    topMoves: true,
    gate: true,
    analysis: true,
    stageStats: true,
    gameSoFar: true,
    tokens: false,
  },
};

export interface Message {
  readonly type: string;
  readonly id?: string;
  readonly content: unknown;
}

/** A position command: a root and the moves from it. Mirrors `PositionInput` in state.py. */
export interface PositionInput {
  start_fen?: string;
  moves?: string[];
  restrict?: string[];
}

/** The thread values a UI may read. The state API also returns private channels; never read them. */
export interface ChessValues {
  messages?: Message[];
  start_fen?: string;
  moves?: string[];
  plies?: Ply[];
  turns?: TurnRecord[];
  outcome?: Outcome | null;
  error?: string | null;
  /** Absent on games recorded before draw offers: read it as `[]`. */
  draw_offers?: DrawOffer[];
  /**
   * The server's resolved settings on the game's first turn, as that version recorded them:
   * read them with `loadRecorded`. Absent on older games.
   */
  setup?: unknown;
  /** Absent on games recorded before it: read it with `liveSystemOne`. */
  systemone_live?: SystemOneLive | null;
}

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
