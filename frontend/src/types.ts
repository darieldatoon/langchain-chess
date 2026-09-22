// Mirrors src/jev_chess/graphs/context.py and game.py. Keep the two in step by hand.

export type PolicyKind = "jev" | "llm" | "hybrid" | "random";
export type Side = "white" | "black";
export type ReasoningEffort = "low" | "medium" | "high";
export type GateSignal = "margin" | "confidence";
export type DescriptionStyle = "rich" | "terse";
export type Status = "playing" | "checkmate" | "stalemate" | "draw" | "max_plies";

export interface PlayContext {
  policy: PolicyKind;
  human_side: Side;
  max_plies: number;
  model: string;
  reasoning_effort: ReasoningEffort;
  include_legal_moves: boolean;
  jev_model: string;
  style: DescriptionStyle;
  with_eval: boolean;
  with_nouls: boolean;
  k: number;
  top_p: number | null;
  gate: GateSignal;
  threshold: number;
}

export const DEFAULT_CONTEXT: PlayContext = {
  policy: "hybrid",
  human_side: "white",
  max_plies: 200,
  model: "claude-opus-5",
  reasoning_effort: "medium",
  include_legal_moves: true,
  jev_model: "jev-latest",
  style: "rich",
  with_eval: false,
  with_nouls: false,
  k: 5,
  top_p: null,
  gate: "margin",
  threshold: 0.9,
};

export interface TopView {
  uci: string;
  san: string;
  probability: number;
}

export interface PlyView {
  ply: number;
  side: Side;
  san: string;
  uci: string;
  source: string;
  model: string;
  latency_ms: number;
  cost_usd?: number | null;
  input_tokens?: number;
  output_tokens?: number;
  reasoning_tokens?: number;
  escalated?: boolean;
  illegal_attempts?: number;
  jev_confidence?: number | null;
  jev_margin?: number | null;
  jev_top?: TopView[];
  raw_reply?: string | null;
}

export interface GameState {
  move?: string | null;
  fen?: string;
  history?: string[];
  moves?: string[];
  plies?: PlyView[];
  status?: Status;
  result?: string | null;
  error?: string | null;
  player?: string;
  human_side?: Side;
}

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
