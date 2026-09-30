import { describe, expect, it } from "vite-plus/test";
import {
  describeError,
  isAuthError,
  isBusyRejection,
  parseKnob,
  parseNullableKnob,
  resultHeadline,
  sliderValue,
} from "../src/format";
import { CONTEXT_CHECKS } from "../src/settings";

describe("errors", () => {
  it("describes errors", () => {
    expect(isBusyRejection(new Error("submit() rejected: a run is already in flight"))).toBe(true);
    expect(isBusyRejection(new Error("Failed to fetch"))).toBe(false);
    expect(isBusyRejection("a run is already in flight")).toBe(false);
    expect(describeError(undefined)).toBeNull();
    expect(describeError(new Error("boom"))).toBe("boom");
    expect(describeError("plain")).toBe("plain");
    expect(describeError({ detail: "x" })).toBe('{"detail":"x"}');
  });

  it("recognises only the server refusing the request, by status or the SDK's message", () => {
    const http = (status: number, message: string) =>
      Object.assign(new Error(`HTTP ${status}: ${message}`), { status });
    expect(isAuthError(http(401, "Unauthorized"))).toBe(true);
    expect(isAuthError(Object.assign(new Error("denied"), { status: 403 }))).toBe(true);
    expect(isAuthError(new Error("Protocol request failed: 401 Unauthorized — bad key"))).toBe(
      true,
    );
    expect(isAuthError(new Error("Thread state request failed: 403 Forbidden"))).toBe(true);
    expect(isAuthError(http(500, "Internal Server Error"))).toBe(false);
    // A run that failed on the server's own model credentials is not the browser's key.
    expect(isAuthError(new Error("AuthenticationError: Error code: 401 - invalid x-api-key"))).toBe(
      false,
    );
    expect(isAuthError(new Error("Forbidden"))).toBe(false);
    expect(isAuthError("HTTP 401: Unauthorized")).toBe(false);
    expect(isAuthError(new Error("provider 4013 overloaded"))).toBe(false);
    expect(isAuthError(new Error("Failed to fetch"))).toBe(false);
    expect(isAuthError(undefined)).toBe(false);
    expect(isAuthError(null)).toBe(false);
  });
});

describe("resultHeadline", () => {
  it("reads the result from the human's side", () => {
    const mate = { kind: "checkmate", winner: "white" } as const;
    expect(resultHeadline(mate, "white")).toBe("You won");
    expect(resultHeadline(mate, "black")).toBe("You lost");
    expect(resultHeadline({ kind: "draw", reason: "stalemate" }, "black")).toBe("Draw");
  });
});

describe("ui helpers", () => {
  it("takes the first slider value from a range", () => {
    expect(sliderValue(0.4)).toBe(0.4);
    expect(sliderValue([0.2, 0.8])).toBe(0.2);
  });

  it("parses number fields into knob values", () => {
    expect(parseKnob("3", CONTEXT_CHECKS.k)).toBe(3);
    expect(parseKnob("", CONTEXT_CHECKS.k)).toBeUndefined();
    expect(parseKnob("0", CONTEXT_CHECKS.k)).toBeUndefined();
    expect(parseNullableKnob(" ", CONTEXT_CHECKS.top_p)).toBeNull();
    expect(parseNullableKnob("0.5", CONTEXT_CHECKS.top_p)).toBe(0.5);
    expect(parseNullableKnob("0", CONTEXT_CHECKS.top_p)).toBeUndefined();
  });
});
