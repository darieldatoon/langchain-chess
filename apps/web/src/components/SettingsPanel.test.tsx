import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { DEFAULT_SETTINGS } from "../settings";
import { SettingsPanel } from "./SettingsPanel";

vi.mock("@langchain/macaw-components/Select", async () =>
  (await import("../test/macawShims")).selectShim(),
);
vi.mock("@langchain/macaw-components/Slider", async () =>
  (await import("../test/macawShims")).sliderShim(),
);

function open(onSave = vi.fn(), onClose = vi.fn()) {
  render(<SettingsPanel open settings={DEFAULT_SETTINGS} onSave={onSave} onClose={onClose} />);
  return { onSave, onClose };
}

describe("SettingsPanel", () => {
  it("edits the key and hybrid knobs, then saves trimmed", () => {
    const { onSave } = open();
    fireEvent.change(screen.getByLabelText("LangSmith API Key"), { target: { value: " lsv2_x " } });
    fireEvent.change(screen.getByLabelText("Threshold"), { target: { value: "0.5" } });
    expect(screen.getByTestId("threshold-value")).toHaveTextContent("0.50");
    fireEvent.change(screen.getByLabelText("Signal"), { target: { value: "confidence" } });
    fireEvent.change(screen.getByLabelText("Shortlist Size"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "gpt-5.6-sol" } });
    fireEvent.change(screen.getByLabelText("Reasoning Effort"), { target: { value: "low" } });
    fireEvent.change(screen.getByLabelText("You Play"), { target: { value: "black" } });
    fireEvent.change(screen.getByLabelText("Move Descriptions"), { target: { value: "terse" } });
    fireEvent.click(screen.getByRole("switch", { name: "Ask for a position Score" }));
    fireEvent.click(screen.getByRole("switch", { name: "Ask the Noul questions" }));
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

  it("keeps the previous value when a select is cleared", () => {
    const { onSave } = open();
    fireEvent.change(screen.getByLabelText("Opponent"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave.mock.calls[0][0].context.policy).toBe("hybrid");
  });

  it("shows only the sections the chosen policy uses", () => {
    open();
    const policy = screen.getByLabelText("Opponent");
    fireEvent.change(policy, { target: { value: "llm" } });
    expect(screen.queryByLabelText("Threshold")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Move Descriptions")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "List legal moves in the prompt" }));
    fireEvent.change(policy, { target: { value: "jev" } });
    expect(screen.queryByLabelText("Model")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Move Descriptions")).toBeInTheDocument();
    fireEvent.change(policy, { target: { value: "random" } });
    expect(screen.queryByLabelText("Move Descriptions")).not.toBeInTheDocument();
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
