import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { DEFAULT_SETTINGS, type Settings } from "../settings";
import { SettingsPanel } from "./SettingsPanel";

vi.mock("@langchain/macaw-components/Select", async () =>
  (await import("../test/macawShims")).selectShim(),
);
vi.mock("@langchain/macaw-components/Slider", async () =>
  (await import("../test/macawShims")).sliderShim(),
);

function open(settings: Settings = DEFAULT_SETTINGS, onSave = vi.fn(), onClose = vi.fn()) {
  render(<SettingsPanel open settings={settings} onSave={onSave} onClose={onClose} />);
  return { onSave, onClose };
}

const change = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("SettingsPanel", () => {
  it("edits the key and every hybrid knob, then saves trimmed", () => {
    const { onSave } = open();
    change("LangSmith API Key", " lsv2_x ");
    change("Threshold", "0.5");
    expect(screen.getByTestId("threshold-value")).toHaveTextContent("0.50");
    change("Tournament Threshold", "0.7");
    change("Signal", "confidence");
    change("Shortlist Size", "3");
    change("Top-p", "0.8");
    change("Model", "gpt-5.6-sol");
    change("Reasoning Effort", "low");
    change("Summary Trigger Tokens", "50000");
    change("Draw Claims", "never");
    change("System 1 Model", "typesafe/jev-latest");
    change("Move Descriptions", "terse");
    change("Seed", "7");
    fireEvent.click(screen.getByRole("switch", { name: "List legal moves in the prompt" }));
    fireEvent.click(screen.getByRole("switch", { name: "Ask for a position Score" }));
    fireEvent.click(screen.getByRole("switch", { name: "Ask the Noul questions" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith({
      apiKey: "lsv2_x",
      context: {
        ...DEFAULT_SETTINGS.context,
        threshold: 0.5,
        tournament_threshold: 0.7,
        gate: "confidence",
        k: 3,
        top_p: 0.8,
        model: "gpt-5.6-sol",
        reasoning_effort: "low",
        summary_trigger_tokens: 50000,
        draw_claims: "never",
        systemone_model: "typesafe/jev-latest",
        style: "terse",
        seed: 7,
        show_legal_moves: false,
        with_eval: true,
        with_nouls: true,
      },
    });
  });

  it("clears nullable knobs, keeps valid values over invalid text, and flags it", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      context: { ...DEFAULT_SETTINGS.context, top_p: 0.5, tournament_threshold: 0.6 },
    };
    const { onSave } = open(settings);
    expect(screen.getByLabelText("Top-p")).toHaveValue(0.5);
    change("Top-p", "");
    change("Tournament Threshold", "");
    change("Shortlist Size", "0");
    expect(screen.getByLabelText("Shortlist Size")).toHaveValue(0);
    expect(screen.getByLabelText("Shortlist Size")).toHaveAttribute("aria-invalid", "true");
    change("Model", "  ");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const saved = onSave.mock.calls[0][0].context;
    expect(saved.top_p).toBeNull();
    expect(saved.tournament_threshold).toBeNull();
    expect(saved.k).toBe(5);
    expect(saved.model).toBe("claude-opus-5");
  });

  it("keeps the previous value when a select is cleared", () => {
    const { onSave } = open();
    change("Opponent", "");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave.mock.calls[0][0].context.policy).toBe("hybrid");
  });

  it("shows only the sections the chosen policy uses, with memory always disabled", () => {
    open();
    expect(screen.getByLabelText("Memory")).toBeDisabled();
    change("Memory", "none");
    change("Opponent", "llm");
    expect(screen.queryByLabelText("Threshold")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Move Descriptions")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Model")).toBeInTheDocument();
    change("Opponent", "systemone");
    expect(screen.queryByLabelText("Model")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Threshold")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Move Descriptions")).toBeInTheDocument();
    expect(screen.getByLabelText("Memory")).toBeDisabled();
  });

  it("closes from cancel and stays closed when not open", () => {
    const { onClose } = open();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    render(
      <SettingsPanel open={false} settings={DEFAULT_SETTINGS} onSave={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });
});
