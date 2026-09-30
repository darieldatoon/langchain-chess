import type { Outcome, Side } from "@langchain-chess/chess-ui";

/** The result from the human's side of the board. */
export function resultHeadline(outcome: Outcome, humanSide: Side): string {
  if (outcome.kind === "draw") return "Draw";
  return outcome.winner === humanSide ? "You won" : "You lost";
}

/** The SDK's refusal of a second submit while a run is in flight (`multitaskStrategy: "reject"`). */
export function isBusyRejection(error: unknown): boolean {
  return error instanceof Error && error.message.includes("a run is already in flight");
}

const AUTH_STATUSES = new Set([401, 403]);
/**
 * The SDK's own messages for a refused request; its stream requests carry no `status`. Anchored
 * so a failed run's message (say, a model provider's 401) never reads as the browser's key.
 */
const AUTH_REQUEST = /^(?:HTTP|(?:Protocol|Thread state) request failed:) 40[13]\b/;

/** The Agent Server refused this browser's credentials, as opposed to a run failing. */
export function isAuthError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const status = (error as { status?: unknown }).status;
  return (
    (typeof status === "number" && AUTH_STATUSES.has(status)) || AUTH_REQUEST.test(error.message)
  );
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
