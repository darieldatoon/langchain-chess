// Mirrors libs/chess/langchain_chess/state.py, libs/systemone/langchain_chess_systemone/types.py,
// and ChessContext and `setup` in apps/server/langchain_chess_server/. Keep them in step by hand.

export type Side = "white" | "black";
export type PolicyKind = "llm" | "systemone" | "hybrid";
export type ReasoningEffort = "low" | "medium" | "high";
export type Memory = "none" | "summarize";
export type GateSignal = "margin" | "confidence";
export type DescriptionStyle = "rich" | "terse";
export type DrawClaims = "auto" | "never";
export type SystemOneModel = "semif-qwen3.5-4b" | "typesafe/jev-latest";

export interface ChessContext {
  policy: PolicyKind;
  model: string;
  /** Null sends no effort: the model's own default, and the only choice for non-reasoners. */
  reasoning_effort: ReasoningEffort | null;
  show_legal_moves: boolean;
  memory: Memory;
  systemone_model: SystemOneModel;
  style: DescriptionStyle;
  with_eval: boolean;
  with_nouls: boolean;
  gate: GateSignal;
  threshold: number;
  tournament_threshold: number | null;
  k: number;
  top_p: number | null;
  draw_claims: DrawClaims;
  seed: number;
}

export const DEFAULT_CONTEXT: ChessContext = {
  policy: "hybrid",
  model: "langsmith:baseten/zai-org/GLM-5.3-Flash",
  reasoning_effort: null,
  show_legal_moves: true,
  memory: "none",
  systemone_model: "semif-qwen3.5-4b",
  style: "rich",
  with_eval: false,
  with_nouls: false,
  gate: "margin",
  threshold: 0.9,
  tournament_threshold: null,
  k: 5,
  top_p: null,
  draw_claims: "auto",
  seed: 0,
};

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
  | { kind: "resignation"; winner: Side; reason: "illegal_moves" };

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
  /** The server's resolved settings on the game's first turn; absent on older games. */
  setup?: ChessContext;
}

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
