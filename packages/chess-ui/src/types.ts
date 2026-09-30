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

export const SYSTEMONE_META_KEY = "SystemOneMiddleware";

/**
 * The shape both `stream.messages` (core `BaseMessage` instances) and a submitted command share.
 * Structural so the plain `{ type: "human", id, content }` a command sends type-checks too.
 */
/** A graded move's class. Mirrors `Quality` in libs/chess/langchain_chess/grading.py. */
export type Quality = "best" | "good" | "inaccuracy" | "mistake" | "blunder";

/** The latest opponent ply with its turn and the position it was chosen from. */
export interface Reply {
  ply: Ply;
  turn: TurnRecord | null;
  fenBefore: string;
}

/** What the reply card shows: nothing yet, a move played, or the opponent still choosing one. */
export type ReplyState =
  | { status: "none" }
  | { status: "played"; reply: Reply }
  /** `reasoning` is the text streamed so far; null before the first token, or with none. */
  | { status: "thinking"; reasoning: string | null };

/** Which of the reply card's sections are open. The app owns it, so it outlives the card. */
export interface PlyView {
  reasoning: boolean;
  topMoves: boolean;
}

export const DEFAULT_PLY_VIEW: PlyView = { reasoning: true, topMoves: true };

export interface Message {
  readonly type: string;
  readonly id?: string;
  readonly content: unknown;
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
}

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
