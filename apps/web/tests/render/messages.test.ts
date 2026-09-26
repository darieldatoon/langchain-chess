import { describe, expect, it } from "vite-plus/test";
import { evalText, readMessage } from "../../src/render/messages";
import { failed, inputs, jev, reference, semif } from "../../preview/samples";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const message = (type: string, data: unknown, metadataInputs: unknown = inputs) => ({
  type,
  data,
  metadata: { inputs: metadataInputs, run_id: "r" },
});
const reason = (m: unknown) => {
  const shown = readMessage(m);
  return shown?.kind === "unreadable" ? shown.reason : shown?.kind;
};

describe("readMessage", () => {
  it("ignores anything that isn't an output or reference message", () => {
    expect(readMessage(null)).toBeNull();
    expect(readMessage([])).toBeNull();
    expect(readMessage({ type: "resize" })).toBeNull();
  });

  it("reads the position from the inputs, with the mover and the last move", () => {
    const shown = readMessage(message("reference", reference));
    expect(shown).toMatchObject({
      kind: "reference",
      position: {
        fen: "r1b2rk1/1pp2ppp/p1nqp3/3p4/3P4/PP2PP2/1RPB2PP/4KBNR w K - 1 13",
        mover: "white",
        lastMove: "b4c6",
        legal: inputs.legal,
      },
      reference: { ranked: reference.ranked, evals: reference.evals },
    });
    const start = readMessage(message("reference", reference, { ...inputs, moves: [] }));
    expect(start).toMatchObject({ position: { fen: START, lastMove: null } });
  });

  it("reads System 1's ranking, with or without a tournament", () => {
    expect(readMessage(message("output", semif))).toMatchObject({
      kind: "output",
      ranking: {
        kind: "ranked",
        moves: semif.ranked,
        confidence: semif.confidence,
        margin: semif.margin,
        tournament: true,
        requests: 2,
        latencyMs: semif.latency_ms,
      },
    });
    const bare = { ranked: jev.ranked, confidence: 0.2, margin: 0.1 };
    expect(readMessage(message("output", bare))).toMatchObject({
      ranking: { tournament: false, requests: null, latencyMs: null },
    });
  });

  it("reads a failed ranking by its error", () => {
    expect(readMessage(message("output", failed))).toMatchObject({
      ranking: { kind: "failed", error: failed.error, requests: 3, latencyMs: 4210.5 },
    });
  });

  it("names the first thing it can't draw", () => {
    expect(reason(message("output", null))).toBe("no outputs");
    expect(reason({ type: "output", data: semif })).toBe("no inputs");
    expect(reason(message("output", semif, { question: "hi" }))).toMatch(/not a position/);
    expect(reason(message("output", semif, { ...inputs, legal: [] }))).toMatch(/not a position/);
    expect(reason(message("output", semif, { ...inputs, start_fen: "nope" }))).toBe(
      "start_fen is not a FEN: nope",
    );
    expect(reason(message("output", semif, { ...inputs, moves: ["e2e4", "e2e4"] }))).toMatch(
      /^move e2e4 is illegal after /,
    );
    expect(reason(message("reference", { evals: {} }))).toMatch(/no evals and ranked/);
    expect(reason(message("reference", { ...reference, evals: { d2c3: { cp: 1.5 } } }))).toBe(
      `no eval for ${reference.ranked[0]}`,
    );
    const mate = { ...reference, ranked: ["d2c3"], evals: { d2c3: { mate: 1, winner: "red" } } };
    expect(reason(message("reference", mate))).toBe("no eval for d2c3");
    expect(reason(message("reference", { ...reference, evals: { d2c3: 3 } }))).toMatch(/no eval/);
    expect(reason(message("output", { ...semif, ranked: [] }))).toBe(
      "outputs have no ranked moves",
    );
    expect(reason(message("output", { ...semif, ranked: [{ uci: "x" }] }))).toBe(
      "outputs have no ranked moves",
    );
    expect(reason(message("output", { ...semif, confidence: null }))).toBe(
      "outputs have no confidence and margin",
    );
    expect(reason(message("output", { ...semif, margin: "high" }))).toBe(
      "outputs have no confidence and margin",
    );
  });
});

describe("evalText", () => {
  it("shows pawns from the mover's side", () => {
    expect(evalText({ cp: 40 }, "white")).toBe("+0.4");
    expect(evalText({ cp: 40 }, "black")).toBe("-0.4");
    expect(evalText({ cp: -838 }, "white")).toBe("-8.4");
    expect(evalText({ cp: 4 }, "black")).toBe("0.0");
  });

  it("shows mates for and against the mover", () => {
    expect(evalText({ mate: 3, winner: "white" }, "white")).toBe("mate in 3");
    expect(evalText({ mate: 2, winner: "white" }, "black")).toBe("mated in 2");
    expect(evalText({ mate: 0, winner: "black" }, "black")).toBe("checkmate");
    expect(evalText({ mate: 0, winner: "black" }, "white")).toBe("checkmated");
  });
});
