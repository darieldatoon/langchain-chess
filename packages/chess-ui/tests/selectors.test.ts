import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vite-plus/test";
import {
  isPending,
  lastPolicyPly,
  liveAnalysis,
  replyAt,
  systemOneMeta,
  textOf,
  turnCost,
  turnOf,
} from "../src/selectors";
import { call, E4_E5, ply, systemOne, turn } from "../src/testing";

describe("turnCost", () => {
  it("is null when no call is priced", () => {
    expect(turnCost([])).toBeNull();
    expect(turnCost([call({ cost_usd: null })])).toBeNull();
  });

  it("sums the priced calls and is complete only when every call is priced exactly", () => {
    expect(turnCost([call({ cost_usd: 0.01 }), call({ cost_usd: 0.02 })])).toEqual({
      usd: 0.03,
      complete: true,
    });
    expect(turnCost([call({ cost_usd: 0.01 }), call({ cost_usd: null })])).toEqual({
      usd: 0.01,
      complete: false,
    });
    expect(turnCost([call({ cost_usd: 0.01, cost_complete: false })])).toEqual({
      usd: 0.01,
      complete: false,
    });
  });
});

describe("ply selectors", () => {
  it("finds a ply's turn, the last opponent ply, and System 1 telemetry", () => {
    const [human, reply] = E4_E5.plies;
    expect(turnOf(human, E4_E5.turns)).toBeNull();
    expect(turnOf(reply, E4_E5.turns)?.id).toBe("turn-1");
    expect(turnOf({ ...reply, turn_id: "gone" }, E4_E5.turns)).toBeNull();
    expect(lastPolicyPly([])).toBeNull();
    expect(lastPolicyPly([human])).toBeNull();
    expect(lastPolicyPly(E4_E5.plies)).toBe(reply);
    expect(systemOneMeta(reply)?.status).toBe("played");
    expect(systemOneMeta(human)).toBeNull();
    expect(systemOneMeta(ply({ meta: { SystemOneMiddleware: { nope: 1 } } }))).toBeNull();
  });

  it("reports a pending last turn", () => {
    expect(isPending([])).toBe(false);
    expect(isPending([turn()])).toBe(false);
    expect(isPending([turn(), turn({ status: "pending" })])).toBe(true);
  });

  it("keeps the systemone fixture honest", () => {
    expect(systemOne({ status: "skipped" }).status).toBe("skipped");
  });
});

describe("textOf", () => {
  it("joins text blocks and ignores the rest", () => {
    expect(textOf("plain")).toBe("plain");
    expect(textOf(undefined)).toBe("");
    expect(
      textOf([
        { type: "reasoning", reasoning: "hidden" },
        { type: "text", text: "Nf3 " },
        null,
        "stray",
        { type: "text", text: 3 },
        { type: "text", text: "develops." },
      ]),
    ).toBe("Nf3 develops.");
  });
});

describe("liveAnalysis", () => {
  const human = new HumanMessage({ id: "h1", content: "e2e4" });

  it("shows the latest AI text after the last human message", () => {
    const messages = [
      new HumanMessage({ id: "h0", content: "go" }),
      new AIMessage({ id: "a0", content: "old analysis" }),
      human,
      new AIMessage({ id: "a1", content: "first try" }),
      new AIMessage({ id: "a2", content: [{ type: "text", text: "thinking about e5" }] }),
    ];
    expect(liveAnalysis(messages, [], [])).toBe("thinking about e5");
  });

  it("anchors at the pending turn's opening message, so feedback doesn't hide attempts", () => {
    const messages = [
      human,
      new AIMessage({ id: "a1", content: "Qxf7 is my move" }),
      new HumanMessage({ id: "fb", content: "Qxf7 is illegal" }),
      new AIMessage({ id: "a2", content: "   " }),
    ];
    const pending = [turn({ status: "pending", opened_message_id: "h1" })];
    expect(liveAnalysis(messages, pending, [])).toBe("Qxf7 is my move");
    const lost = [turn({ status: "pending", opened_message_id: "missing" })];
    expect(liveAnalysis(messages, lost, [])).toBeNull();
  });

  it("skips replies already committed to a ply", () => {
    const messages = [human, new AIMessage({ id: "a1", content: "committed" })];
    expect(liveAnalysis(messages, [], [ply({ message_id: "a1" })])).toBeNull();
    expect(liveAnalysis([], [], [])).toBeNull();
    const anonymous = [human, { type: "ai", content: "no id yet" }];
    expect(liveAnalysis(anonymous, [], [ply()])).toBe("no id yet");
  });
});

describe("replyAt", () => {
  const fens = ["f0", "f1", "f2", "f3"];
  const plies = [
    ply(),
    ply({ ply: 1, side: "black", source: "systemone", turn_id: "turn-1" }),
    ply({ ply: 2, san: "Nf3" }),
  ];
  const turns = [turn()];

  it("is the latest agent reply before the position, with its turn and position before", () => {
    expect(replyAt(plies, turns, fens, 3)).toEqual({
      ply: plies[1],
      turn: turns[0],
      fenBefore: "f1",
    });
    expect(replyAt(plies, turns, fens, 2)?.ply).toBe(plies[1]);
  });

  it("is null at the start and before any agent move", () => {
    expect(replyAt(plies, turns, fens, 0)).toBeNull();
    expect(replyAt(plies, turns, fens, 1)).toBeNull();
  });
});
