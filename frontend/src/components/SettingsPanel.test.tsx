import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { DEFAULT_SETTINGS } from "../settings";
import { SettingsPanel } from "./SettingsPanel";

describe("SettingsPanel", () => {
  it("edits the key and hybrid knobs, then saves trimmed", () => {
    const onSave = vi.fn();
    render(<SettingsPanel settings={DEFAULT_SETTINGS} onSave={onSave} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("LangSmith API key"), { target: { value: " lsv2_x " } });
    fireEvent.change(screen.getByLabelText("Threshold"), { target: { value: "0.5" } });
    fireEvent.change(screen.getByLabelText("Signal"), { target: { value: "confidence" } });
    fireEvent.change(screen.getByLabelText("Shortlist size"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "gpt-5.6-sol" } });
    fireEvent.change(screen.getByLabelText("Reasoning effort"), { target: { value: "low" } });
    fireEvent.change(screen.getByLabelText("You play"), { target: { value: "black" } });
    fireEvent.change(screen.getByLabelText("Move descriptions"), { target: { value: "terse" } });
    fireEvent.click(screen.getByLabelText("Ask for a position Score"));
    fireEvent.click(screen.getByLabelText("Ask the Noul questions"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith({
      apiKey: "lsv2_x",
      context: {
        ...DEFAULT_SETTINGS.context,
        threshold: 0.5,
        gate: "confidence",
        k: 3,
        model: "gpt-5.6-sol",
        reasoning_effort: "low",
        human_side: "black",
        style: "terse",
        with_eval: true,
        with_nouls: true,
      },
    });
  });

  it("shows only the sections the chosen policy uses", () => {
    render(<SettingsPanel settings={DEFAULT_SETTINGS} onSave={vi.fn()} onClose={vi.fn()} />);
    const policy = screen.getByLabelText("Opponent");
    fireEvent.change(policy, { target: { value: "llm" } });
    expect(screen.queryByLabelText("Threshold")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Move descriptions")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("List legal moves in the prompt"));
    fireEvent.change(policy, { target: { value: "jev" } });
    expect(screen.queryByLabelText("Model")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Move descriptions")).toBeInTheDocument();
    fireEvent.change(policy, { target: { value: "random" } });
    expect(screen.queryByLabelText("Move descriptions")).not.toBeInTheDocument();
  });

  it("closes from the button, the backdrop, and cancel, but not from inside", () => {
    const onClose = vi.fn();
    render(<SettingsPanel settings={DEFAULT_SETTINGS} onSave={vi.fn()} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByTestId("backdrop"));
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
