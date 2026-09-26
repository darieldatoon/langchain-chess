import { outcomeLine, sideToMove, type Outcome, type Side } from "@langchain-chess/chess-ui";

/** The result from the human's side of the board. */
export function resultHeadline(outcome: Outcome, humanSide: Side): string {
  if (outcome.kind === "draw") return "Draw";
  return outcome.winner === humanSide ? "You won" : "You lost";
}

export interface StatusInput {
  outcome: Outcome | null;
  fen: string;
  moveCount: number;
  humanSide: Side;
  pending: boolean;
}

export function statusLine(game: StatusInput): string {
  if (game.outcome) return outcomeLine(game.outcome);
  if (game.humanSide === sideToMove(game.fen)) return "Your move.";
  return game.moveCount === 0 && !game.pending
    ? "Press Start and the opponent opens."
    : "Opponent to move.";
}

/** Where System 1 ranked the played move: its last stage, or where a tournament knocked it out. */
/** The SDK's refusal of a second submit while a run is in flight (`multitaskStrategy: "reject"`). */
export function isBusyRejection(error: unknown): boolean {
  return error instanceof Error && error.message.includes("a run is already in flight");
}

const AUTH_STATUSES = new Set([401, 403]);
const AUTH_TEXT = /\b40[13]\b|unauthori[sz]ed|forbidden/i;

/** The server refused the request's credentials: the SDK's HTTPError carries `status`. */
export function isAuthError(error: unknown): boolean {
  const text = describeError(error);
  if (text === null) return false;
  const status = (error as { status?: unknown }).status;
  return (typeof status === "number" && AUTH_STATUSES.has(status)) || AUTH_TEXT.test(text);
}

export function describeError(error: unknown): string | null {
  if (!error) return null;
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : JSON.stringify(error);
}

/** Macaw's Slider reports a range as an array; the threshold is a single value. */
export function sliderValue(value: number | number[]): number {
  return Array.isArray(value) ? value[0] : value;
}

/** A number field's text as a knob value; `undefined` (keep the previous value) when invalid. */
export function parseKnob(text: string, valid: (value: unknown) => boolean): number | undefined {
  const value = Number(text);
  return text.trim() !== "" && valid(value) ? value : undefined;
}

/** Like `parseKnob`, but an empty field clears a nullable knob. */
export function parseNullableKnob(
  text: string,
  valid: (value: unknown) => boolean,
): number | null | undefined {
  return text.trim() === "" ? null : parseKnob(text, valid);
}
