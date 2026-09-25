import { act, fireEvent, render, screen } from "@testing-library/react";
import type { KeyCheck } from "../auth";
import { describe, expect, it, vi } from "vite-plus/test";
import { DEFAULT_SETUP, type Setup } from "../setup";
import { DEFAULT_CONTEXT } from "../types";
import { AppSettingsDialog } from "./AppSettingsDialog";
import { NewGameDialog } from "./NewGameDialog";
import { ResultCard } from "./ResultCard";

vi.mock("@langchain/macaw-components/Select", async () =>
  (await import("../test/macawShims")).selectShim(),
);
vi.mock("@langchain/macaw-components/Slider", async () =>
  (await import("../test/macawShims")).sliderShim(),
);

function open(initial: Setup = DEFAULT_SETUP, canCancel = false, check: KeyCheck = { kind: "ok" }) {
  const onPlay = vi.fn();
  const onClose = vi.fn();
  const onOpenSettings = vi.fn();
  const checkKey = vi.fn(() => Promise.resolve(check));
  render(
    <NewGameDialog
      open
      initial={initial}
      canCancel={canCancel}
      onPlay={onPlay}
      onClose={onClose}
      onOpenSettings={onOpenSettings}
      checkKey={checkKey}
    />,
  );
  return { onPlay, onClose, onOpenSettings, checkKey };
}

const change = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const play = () => screen.getByRole("button", { name: "Play" });
const clickPlay = () =>
  act(async () => {
    fireEvent.click(play());
  });
const matchup = () => screen.getByLabelText("matchup");
const advanced = () => fireEvent.click(screen.getByRole("button", { name: "Advanced" }));

describe("NewGameDialog", () => {
  it("plays the default matchup as White, with no way to cancel without a game", async () => {
    const { onPlay, onClose, onOpenSettings } = open();
    expect(screen.getByRole("dialog", { name: "New game" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "White" })).toBeChecked();
    expect(matchup()).toHaveTextContent(
      "SemIf plays confident moves; Claude Opus 5.5 decides the rest.",
    );
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("radio", { name: "Black" }));
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(onOpenSettings).toHaveBeenCalledWith({ ...DEFAULT_SETUP, side: "black" });
    fireEvent.click(screen.getByRole("radio", { name: "White" }));
    await clickPlay();
    expect(onPlay).toHaveBeenCalledWith(DEFAULT_SETUP, DEFAULT_CONTEXT);
  });

  it("picks a side, and cancels back to the game on screen", async () => {
    const { onPlay, onClose } = open(DEFAULT_SETUP, true);
    fireEvent.click(screen.getByRole("radio", { name: "Random" }));
    fireEvent.click(screen.getByRole("radio", { name: "Black" }));
    await clickPlay();
    expect(onPlay.mock.calls[0][0].side).toBe("black");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("offers Settings even when there is a game to cancel back to", () => {
    const { onOpenSettings } = open(DEFAULT_SETUP, true);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(onOpenSettings).toHaveBeenCalledWith(DEFAULT_SETUP);
  });

  it.each<[KeyCheck, string]>([
    [{ kind: "missing" }, "LangSmith API key needed"],
    [{ kind: "rejected" }, "API key rejected"],
    [{ kind: "unreachable", message: "Failed to fetch" }, "Failed to fetch"],
  ])("holds the game back when the key check fails: %o", async (check, text) => {
    const { onPlay, onOpenSettings, checkKey } = open(DEFAULT_SETUP, false, check);
    await clickPlay();
    expect(checkKey).toHaveBeenCalledTimes(1);
    expect(onPlay).not.toHaveBeenCalled();
    expect(screen.getByText(text)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    expect(onOpenSettings).toHaveBeenCalledWith(DEFAULT_SETUP);
  });

  it("does not start a game when closed before the key check answers", async () => {
    let answer: (check: KeyCheck) => void = () => {};
    const onPlay = vi.fn();
    const view = render(
      <NewGameDialog
        open
        initial={DEFAULT_SETUP}
        canCancel
        onPlay={onPlay}
        onClose={() => {}}
        onOpenSettings={() => {}}
        checkKey={() => new Promise((resolve) => (answer = resolve))}
      />,
    );
    fireEvent.click(play());
    expect(play()).toBeDisabled();
    view.unmount();
    await act(async () => answer({ kind: "ok" }));
    expect(onPlay).not.toHaveBeenCalled();
  });

  it("derives the policy from the pickers and disables Play when both are None", async () => {
    const { onPlay } = open();
    change("LLM", "none");
    expect(matchup()).toHaveTextContent("SemIf plays every move.");
    change("System 1", "none");
    expect(matchup()).toHaveTextContent("Pick a System 1, an LLM, or both.");
    expect(play()).toBeDisabled();
    change("LLM", "gpt-5.6-sol");
    expect(matchup()).toHaveTextContent("GPT-5.6 Sol plays every move.");
    await clickPlay();
    expect(onPlay.mock.calls[0][1]).toMatchObject({ policy: "llm", model: "gpt-5.6-sol" });
    change("System 1", "typesafe/jev-latest");
    await clickPlay();
    expect(onPlay.mock.calls[1][1]).toMatchObject({
      policy: "hybrid",
      systemone_model: "typesafe/jev-latest",
    });
  });

  it("keeps a picker's value when the select reports a deselect", async () => {
    const { onPlay } = open();
    change("LLM", "");
    await clickPlay();
    expect(onPlay.mock.calls[0][1].model).toBe("claude-opus-5-5");
  });

  it("takes any model spec as a custom LLM, and needs one to play", async () => {
    const { onPlay } = open();
    expect(screen.queryByLabelText("Model Spec")).not.toBeInTheDocument();
    change("LLM", "custom");
    expect(play()).toBeDisabled();
    expect(matchup()).toHaveTextContent("Enter a model spec for the custom LLM.");
    change("Model Spec", "openai:gpt-5.6-sol");
    expect(matchup()).toHaveTextContent(
      "SemIf plays confident moves; openai:gpt-5.6-sol decides the rest.",
    );
    await clickPlay();
    expect(onPlay).toHaveBeenCalledWith(
      expect.objectContaining({ llm: "custom", customModel: "openai:gpt-5.6-sol" }),
      expect.objectContaining({ policy: "hybrid", model: "openai:gpt-5.6-sol" }),
    );
  });

  it("keeps Advanced collapsed until asked, then shows only the sections that apply", () => {
    open();
    expect(screen.queryByText("Rules")).not.toBeInTheDocument();
    advanced();
    expect(screen.getByRole("button", { name: "Advanced" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByLabelText("Reasoning Effort")).toBeInTheDocument();
    expect(screen.getByLabelText("Move Descriptions")).toBeInTheDocument();
    expect(screen.getByLabelText("Threshold")).toBeInTheDocument();
    expect(screen.getByLabelText("Draw Claims")).toBeInTheDocument();

    change("LLM", "none");
    expect(screen.queryByLabelText("Reasoning Effort")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Threshold")).not.toBeInTheDocument();
    expect(screen.getByText(/gate and shortlist apply when an LLM plays too/)).toBeInTheDocument();
    expect(screen.getByLabelText("Move Descriptions")).toBeInTheDocument();

    change("LLM", "claude-opus-5");
    change("System 1", "none");
    expect(screen.queryByLabelText("Move Descriptions")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Reasoning Effort")).toBeInTheDocument();
    expect(screen.getByLabelText("Seed")).toBeInTheDocument();

    advanced();
    expect(screen.queryByLabelText("Seed")).not.toBeInTheDocument();
  });

  it("edits every knob and plays with them", async () => {
    const { onPlay } = open();
    advanced();
    expect(screen.queryByLabelText("Summary Trigger Tokens")).not.toBeInTheDocument();
    change("Memory", "summarize");
    change("Summary Trigger Tokens", "50000");
    change("Reasoning Effort", "low");
    change("Threshold", "0.5");
    expect(screen.getByTestId("threshold-value")).toHaveTextContent("0.50");
    change("Tournament Threshold", "0.7");
    change("Signal", "confidence");
    change("Shortlist Size", "3");
    change("Top-p", "0.8");
    change("Draw Claims", "never");
    change("Move Descriptions", "terse");
    change("Seed", "7");
    fireEvent.click(screen.getByRole("switch", { name: "List legal moves in the prompt" }));
    fireEvent.click(screen.getByRole("switch", { name: "Ask for a position Score" }));
    fireEvent.click(screen.getByRole("switch", { name: "Ask the Noul questions" }));
    await clickPlay();
    expect(onPlay.mock.calls[0][1]).toEqual({
      ...DEFAULT_CONTEXT,
      memory: "summarize",
      summary_trigger_tokens: 50000,
      reasoning_effort: "low",
      threshold: 0.5,
      tournament_threshold: 0.7,
      gate: "confidence",
      k: 3,
      top_p: 0.8,
      draw_claims: "never",
      style: "terse",
      seed: 7,
      show_legal_moves: false,
      with_eval: true,
      with_nouls: true,
    });
  });

  it("clears nullable knobs, keeps valid values over invalid text, and flags it", async () => {
    const { onPlay } = open({
      ...DEFAULT_SETUP,
      knobs: { ...DEFAULT_SETUP.knobs, top_p: 0.5, tournament_threshold: 0.6 },
    });
    advanced();
    expect(screen.getByLabelText("Top-p")).toHaveValue(0.5);
    change("Top-p", "");
    change("Tournament Threshold", "");
    change("Shortlist Size", "0");
    expect(screen.getByLabelText("Shortlist Size")).toHaveValue(0);
    expect(screen.getByLabelText("Shortlist Size")).toHaveAttribute("aria-invalid", "true");
    await clickPlay();
    const context = onPlay.mock.calls[0][1];
    expect(context.top_p).toBeNull();
    expect(context.tournament_threshold).toBeNull();
    expect(context.k).toBe(5);
  });
});

describe("AppSettingsDialog", () => {
  it("saves the key trimmed and closes from Cancel or Escape", () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(<AppSettingsDialog open settings={{ apiKey: "" }} onSave={onSave} onClose={onClose} />);
    change("LangSmith API Key", " lsv2_x ");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith({ apiKey: "lsv2_x" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(screen.queryByLabelText("System 1")).not.toBeInTheDocument();
  });
});

describe("ResultCard", () => {
  it("shows the result and offers a rematch or a new game", () => {
    const onRematch = vi.fn();
    const onNewGame = vi.fn();
    render(
      <ResultCard
        outcome={{ kind: "checkmate", winner: "black" }}
        humanSide="black"
        onRematch={onRematch}
        onNewGame={onNewGame}
      />,
    );
    expect(screen.getByText("You won")).toBeInTheDocument();
    expect(screen.getByText("Checkmate, Black wins. 0-1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Rematch" }));
    fireEvent.click(screen.getByRole("button", { name: "New game" }));
    expect(onRematch).toHaveBeenCalledTimes(1);
    expect(onNewGame).toHaveBeenCalledTimes(1);
  });
});
