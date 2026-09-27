import { act, fireEvent, screen } from "@testing-library/react";
import { renderWithProviders as render } from "../support/renderApp";
import type { KeyCheck } from "../../src/auth";
import type { ModelLimit } from "../../src/modelLimit";
import { describe, expect, it, vi } from "vite-plus/test";
import { DEFAULT_SETUP, type Setup } from "../../src/setup";
import {
  DEFAULT_CONTEXT,
  SETTING_HELP,
  SETTING_KEYS,
  SETTING_LABELS,
  type SettingKey,
} from "@langchain-chess/chess-ui";
import userEvent from "@testing-library/user-event";

const PICKED: SettingKey[] = ["policy", "model", "systemone_model"];

const downloads = vi.hoisted(() => [] as [string, unknown][]);
vi.mock("../../src/files", async (original) => ({
  ...(await original<typeof import("../../src/files")>()),
  downloadJson: (name: string, value: unknown) => downloads.push([name, value]),
}));

async function importFile(content: string) {
  const file = new File([content], "opponent.json", { type: "application/json" });
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Setup file"), { target: { files: [file] } });
  });
}
import { AppSettingsDialog } from "../../src/components/AppSettingsDialog";
import { LIMIT_DELAY_MS, NewGameDialog } from "../../src/components/NewGameDialog";
import { ResultCard } from "../../src/components/ResultCard";

vi.mock("@langchain/macaw-components/Select", async () =>
  (await import("../support/macawShims")).selectShim(),
);
vi.mock("@langchain/macaw-components/Slider", async () =>
  (await import("../support/macawShims")).sliderShim(),
);

const KNOWN: ModelLimit = { kind: "known", tokens: 968000 };

function open(
  initial: Setup = DEFAULT_SETUP,
  canCancel = false,
  check: KeyCheck = { kind: "ok" },
  limits: Record<string, ModelLimit> = {},
) {
  const onPlay = vi.fn();
  const onClose = vi.fn();
  const onOpenSettings = vi.fn();
  const checkKey = vi.fn(() => Promise.resolve(check));
  const modelLimit = vi.fn((model: string) =>
    Promise.resolve(model in limits ? limits[model] : KNOWN),
  );
  render(
    <NewGameDialog
      open
      initial={initial}
      canCancel={canCancel}
      onPlay={onPlay}
      onClose={onClose}
      onOpenSettings={onOpenSettings}
      checkKey={checkKey}
      modelLimit={modelLimit}
    />,
  );
  return { onPlay, onClose, onOpenSettings, checkKey, modelLimit };
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
/** Lets the debounced model-limit request answer. */
const settled = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, LIMIT_DELAY_MS + 10));
  });

describe("NewGameDialog", () => {
  it("plays the default matchup as White, with no way to cancel without a game", async () => {
    const { onPlay, onClose, onOpenSettings } = open();
    expect(screen.getByRole("dialog", { name: "New game" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "White" })).toBeChecked();
    expect(matchup()).toHaveTextContent(
      "SemIf plays confident moves; GLM-5.3 Flash decides the rest.",
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
        modelLimit={() => Promise.resolve(KNOWN)}
      />,
    );
    fireEvent.click(play());
    expect(play()).toBeDisabled();
    view.unmount();
    await act(async () => answer({ kind: "ok" }));
    expect(onPlay).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid", "0"],
    ["valid but different", "3"],
  ])("does not play stale picks edited to %s while the key check runs", async (_, k) => {
    let answer: (check: KeyCheck) => void = () => {};
    const onPlay = vi.fn();
    render(
      <NewGameDialog
        open
        initial={DEFAULT_SETUP}
        canCancel={false}
        onPlay={onPlay}
        onClose={() => {}}
        onOpenSettings={() => {}}
        checkKey={() => new Promise((resolve) => (answer = resolve))}
        modelLimit={() => Promise.resolve(KNOWN)}
      />,
    );
    advanced();
    fireEvent.click(play());
    change("Candidates for the LLM", k);
    await act(async () => answer({ kind: "ok" }));
    expect(onPlay).not.toHaveBeenCalled();
  });

  it("still reports a key problem found for picks edited meanwhile", async () => {
    let answer: (check: KeyCheck) => void = () => {};
    render(
      <NewGameDialog
        open
        initial={DEFAULT_SETUP}
        canCancel={false}
        onPlay={() => {}}
        onClose={() => {}}
        onOpenSettings={() => {}}
        checkKey={() => new Promise((resolve) => (answer = resolve))}
        modelLimit={() => Promise.resolve(KNOWN)}
      />,
    );
    fireEvent.click(play());
    fireEvent.click(screen.getByRole("radio", { name: "Black" }));
    await act(async () => answer({ kind: "missing" }));
    expect(screen.getByText("LangSmith API key needed")).toBeInTheDocument();
  });

  it("derives the policy from the pickers and disables Play when both are None", async () => {
    const { onPlay } = open();
    change("LLM", "none");
    expect(matchup()).toHaveTextContent("SemIf plays every move.");
    change("System 1", "none");
    expect(matchup()).toHaveTextContent("Pick a System 1, an LLM, or both.");
    expect(play()).toBeDisabled();
    change("LLM", "langsmith:baseten/zai-org/GLM-5.3");
    expect(matchup()).toHaveTextContent("GLM-5.3 plays every move.");
    await clickPlay();
    expect(onPlay.mock.calls[0][1]).toMatchObject({
      policy: "llm",
      model: "langsmith:baseten/zai-org/GLM-5.3",
    });
    change("System 1", "typesafe/jev-latest");
    await clickPlay();
    expect(onPlay.mock.calls[1][1]).toMatchObject({
      policy: "hybrid",
      systemone_model: "typesafe/jev-latest",
    });
  });

  it("offers a System 1 from elsewhere under its own name, and keeps it while it's off", async () => {
    const { onPlay } = open({ ...DEFAULT_SETUP, systemOne: "none" });
    const picker = screen.getByLabelText("System 1");
    expect(picker).toHaveValue("other");
    expect(screen.getByRole("option", { name: "none" })).toBeInTheDocument();
    expect(matchup()).toHaveTextContent("none plays confident moves");
    change("System 1", "none");
    expect(matchup()).toHaveTextContent("GLM-5.3 Flash plays every move.");
    change("System 1", "other");
    await clickPlay();
    expect(onPlay.mock.calls[0][1]).toMatchObject({ policy: "hybrid", systemone_model: "none" });
    change("System 1", "typesafe/jev-latest");
    change("System 1", "other");
    await clickPlay();
    expect(onPlay.mock.calls[1][1]).toMatchObject({ systemone_model: "none" });
  });

  it("keeps a picker's value when the select reports a deselect", async () => {
    const { onPlay } = open();
    change("LLM", "");
    change("System 1", "");
    await clickPlay();
    expect(onPlay.mock.calls[0][1].model).toBe("langsmith:baseten/zai-org/GLM-5.3-Flash");
    expect(onPlay.mock.calls[0][1].systemone_model).toBe("semif-qwen3.5-4b");
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
    expect(screen.getByLabelText("Reasoning effort")).toBeInTheDocument();
    expect(screen.getByLabelText("Move descriptions")).toBeInTheDocument();
    expect(screen.getByLabelText("Bar to play alone")).toBeInTheDocument();
    expect(screen.getByLabelText("Claim draws")).toBeInTheDocument();

    change("LLM", "none");
    expect(screen.queryByLabelText("Reasoning effort")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Bar to play alone")).not.toBeInTheDocument();
    expect(screen.getByText(/apply when an LLM plays too/)).toBeInTheDocument();
    expect(screen.getByLabelText("Move descriptions")).toBeInTheDocument();

    change("LLM", "langsmith:openai/gpt-6-luna");
    change("System 1", "none");
    expect(screen.queryByLabelText("Move descriptions")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Reasoning effort")).toBeInTheDocument();
    expect(screen.getByLabelText("Seed")).toBeInTheDocument();

    advanced();
    expect(screen.queryByLabelText("Seed")).not.toBeInTheDocument();
  });

  it("edits every knob and plays with them", async () => {
    const { onPlay } = open();
    advanced();
    await settled();
    change("Memory", "on");
    change("Moves to list", "none");
    change("Reasoning effort", "low");
    change("Bar to play alone", "0.5");
    expect(screen.getByTestId("threshold-value")).toHaveTextContent("0.50");
    change("Bar for long move lists", "0.7");
    change("Confidence measure", "confidence");
    change("Candidates for the LLM", "3");
    change("Probability cutoff", "0.8");
    change("Claim draws", "never");
    change("Move descriptions", "terse");
    change("Seed", "7");
    change("System prompt", "Play the Caro-Kann.");
    change("Model arguments", '{"temperature": 0.2}');
    fireEvent.click(screen.getByRole("switch", { name: "Show the FEN" }));
    fireEvent.click(screen.getByRole("switch", { name: "Show the board" }));
    fireEvent.click(screen.getByRole("switch", { name: "Ask for a position score" }));
    fireEvent.click(screen.getByRole("switch", { name: "Ask about tactics" }));
    await clickPlay();
    expect(onPlay.mock.calls[0][1]).toEqual({
      ...DEFAULT_CONTEXT,
      memory: true,
      move_list: "none",
      system_prompt: "Play the Caro-Kann.",
      model_kwargs: { temperature: 0.2 },
      show_fen: false,
      show_board: false,
      reasoning_effort: "low",
      threshold: 0.5,
      tournament_threshold: 0.7,
      gate: "confidence",
      k: 3,
      top_p: 0.8,
      draw_claims: "never",
      style: "terse",
      seed: 7,
      with_eval: true,
      with_nouls: true,
    });
  });

  it("holds Play while the model kwargs can't be sent, and says why", async () => {
    const { onPlay } = open();
    advanced();
    change("Model arguments", "{");
    expect(screen.getByText("Not valid JSON.")).toBeInTheDocument();
    expect(matchup()).toHaveTextContent("Fix the Advanced settings marked invalid.");
    change("Model arguments", '{"reasoning_effort": "high"}');
    expect(screen.getByText(/Model arguments set the effort/)).toBeInTheDocument();
    change("System prompt", "   ");
    await clickPlay();
    expect(onPlay.mock.calls[0][1]).toMatchObject({
      model_kwargs: { reasoning_effort: "high" },
      system_prompt: null,
    });
    change("Model arguments", "");
    await clickPlay();
    expect(onPlay.mock.calls[1][1].model_kwargs).toEqual({});
  });

  it("shows stored model kwargs as JSON", () => {
    open({ ...DEFAULT_SETUP, knobs: { ...DEFAULT_SETUP.knobs, model_kwargs: { top_p: 0.5 } } });
    advanced();
    expect(screen.getByLabelText("Model arguments")).toHaveValue('{\n  "top_p": 0.5\n}');
  });

  it("names every setting plainly and explains each in a tooltip", async () => {
    open();
    advanced();
    const shown = SETTING_KEYS.filter((key) => !PICKED.includes(key));
    for (const key of shown) {
      expect(screen.getByLabelText(`About ${SETTING_LABELS[key]}`)).toBeInTheDocument();
    }
    await userEvent.hover(screen.getByLabelText("About Probability cutoff"));
    const tip = await screen.findByRole("tooltip");
    expect(tip).toHaveTextContent(SETTING_HELP.top_p);
  });

  it("imports a setup file, keeping the side picked, and exports the one on screen", async () => {
    const { onPlay } = open();
    fireEvent.click(screen.getByRole("radio", { name: "Black" }));
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(click).toHaveBeenCalledOnce();
    advanced();
    const file = {
      version: 2,
      systemone_model: "someone/ranker",
      k: 3,
      model_kwargs: { top_p: 1 },
    };
    await importFile(JSON.stringify(file));
    expect(screen.getByLabelText("System 1")).toHaveValue("other");
    expect(screen.getByLabelText("Candidates for the LLM")).toHaveValue(3);
    expect(screen.getByLabelText("Model arguments")).toHaveValue('{\n  "top_p": 1\n}');
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    const exported = {
      ...DEFAULT_CONTEXT,
      systemone_model: "someone/ranker",
      k: 3,
      model_kwargs: { top_p: 1 },
    };
    expect(downloads.at(-1)).toEqual(["opponent.json", exported]);
    await clickPlay();
    expect(onPlay.mock.calls[0][0].side).toBe("black");
    expect(onPlay.mock.calls[0][1]).toEqual(exported);
  });

  it("ignores an import that finishes after the dialog closed", async () => {
    const view = render(
      <NewGameDialog
        open
        initial={DEFAULT_SETUP}
        canCancel={false}
        onPlay={() => {}}
        onClose={() => {}}
        onOpenSettings={() => {}}
        checkKey={() => Promise.resolve({ kind: "ok" })}
        modelLimit={() => Promise.resolve(KNOWN)}
      />,
    );
    const file = new File(['{"version": 2}'], "opponent.json");
    fireEvent.change(screen.getByLabelText("Setup file"), { target: { files: [file] } });
    view.unmount();
    await act(async () => {});
    expect(screen.queryByText(/Couldn't import/)).not.toBeInTheDocument();
  });

  it("says why a file can't be imported, and changes nothing", async () => {
    open();
    await importFile("{");
    expect(screen.getByText("That file isn't JSON.")).toBeInTheDocument();
    await importFile('{"version": 2, "modle": "x"}');
    expect(screen.getByText("unknown settings for version 2: modle")).toBeInTheDocument();
    await importFile('{"version": 2, "k": 2}');
    expect(screen.queryByText(/Couldn't import/)).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Setup file"), { target: { files: [] } });
    });
    change("LLM", "none");
    change("System 1", "none");
    expect(screen.getByRole("button", { name: "Export" })).toBeDisabled();
  });

  it("sends no effort with Model default, as models without reasoning need", async () => {
    const { onPlay } = open({
      ...DEFAULT_SETUP,
      knobs: { ...DEFAULT_SETUP.knobs, reasoning_effort: "medium" },
    });
    change("LLM", "langsmith:anthropic/claude-haiku-4-5-20251001");
    advanced();
    expect(screen.getByLabelText("Reasoning effort")).toHaveValue("medium");
    change("Reasoning effort", "default");
    await clickPlay();
    expect(onPlay.mock.calls[0][1]).toMatchObject({
      model: "langsmith:anthropic/claude-haiku-4-5-20251001",
      reasoning_effort: null,
    });
  });

  it("turns summarize off for a model with no known input limit", async () => {
    const glm = "langsmith:fireworks/accounts/fireworks/models/glm-5p3";
    const summarizing = {
      ...DEFAULT_SETUP,
      knobs: { ...DEFAULT_SETUP.knobs, memory: true },
    };
    const { onPlay, modelLimit } = open(
      summarizing as Setup,
      false,
      { kind: "ok" },
      { [glm]: { kind: "none" } },
    );
    expect(matchup()).toHaveTextContent("Checking whether GLM-5.3 Flash can summarize…");
    expect(play()).toBeDisabled();
    await settled();
    expect(play()).toBeEnabled();
    change("LLM", "custom");
    change("Model Spec", "langsmith:fireworks");
    change("Model Spec", glm);
    await settled();
    expect(modelLimit.mock.calls.map(([model]) => model)).toEqual([
      "langsmith:baseten/zai-org/GLM-5.3-Flash",
      glm,
    ]);
    advanced();
    expect(screen.getByLabelText("Memory")).toHaveValue("off");
    expect(screen.getByRole("option", { name: "Summarize" })).toBeDisabled();
    expect(screen.getByText(/no known input limit, so it can't summarize/)).toBeInTheDocument();
    await clickPlay();
    expect(onPlay.mock.calls[0][1]).toMatchObject({ model: glm, memory: false });
  });

  it("ignores a late limit for a model no longer picked", async () => {
    const answers: ((limit: ModelLimit) => void)[] = [];
    const summarizing = {
      ...DEFAULT_SETUP,
      knobs: { ...DEFAULT_SETUP.knobs, memory: true },
    };
    render(
      <NewGameDialog
        open
        initial={summarizing as Setup}
        canCancel={false}
        onPlay={() => {}}
        onClose={() => {}}
        onOpenSettings={() => {}}
        checkKey={() => Promise.resolve({ kind: "ok" })}
        modelLimit={() => new Promise((resolve) => answers.push(resolve))}
      />,
    );
    await settled();
    change("LLM", "langsmith:baseten/zai-org/GLM-5.3");
    await act(async () => answers[0]({ kind: "none" }));
    expect(matchup()).toHaveTextContent("Checking whether GLM-5.3 can summarize…");
    await settled();
    await act(async () => answers[1](KNOWN));
    expect(play()).toBeEnabled();
  });

  it("keeps summarize and holds Play when the limit check fails, until a retry answers", async () => {
    const summarizing = {
      ...DEFAULT_SETUP,
      knobs: { ...DEFAULT_SETUP.knobs, memory: true },
    } as Setup;
    const { onPlay, modelLimit } = open(
      summarizing,
      false,
      { kind: "ok" },
      {
        [DEFAULT_SETUP.llm]: { kind: "failed" },
      },
    );
    await settled();
    expect(matchup()).toHaveTextContent("Couldn't check whether GLM-5.3 Flash can summarize.");
    expect(play()).toBeDisabled();
    advanced();
    expect(screen.getByLabelText("Memory")).toHaveValue("on");
    expect(screen.getByRole("option", { name: "Summarize" })).toBeEnabled();
    expect(screen.getByText(/Couldn't reach the server/)).toBeInTheDocument();

    modelLimit.mockImplementation(() => Promise.resolve(KNOWN));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(matchup()).toHaveTextContent("Checking whether GLM-5.3 Flash can summarize…");
    await settled();
    expect(modelLimit).toHaveBeenCalledTimes(2);
    await clickPlay();
    expect(onPlay.mock.calls[0][1]).toMatchObject({ memory: true });
  });

  it("plays past a failed limit check when summarize isn't asked for", async () => {
    const { onPlay } = open(
      DEFAULT_SETUP,
      false,
      { kind: "ok" },
      {
        [DEFAULT_SETUP.llm]: { kind: "failed" },
      },
    );
    await settled();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    await clickPlay();
    expect(onPlay.mock.calls[0][1]).toMatchObject({ memory: false });
  });

  it("clears nullable knobs, and holds Play while a number field shows invalid text", async () => {
    const { onPlay } = open({
      ...DEFAULT_SETUP,
      knobs: { ...DEFAULT_SETUP.knobs, top_p: 0.5, tournament_threshold: 0.6 },
    });
    advanced();
    expect(screen.getByLabelText("Probability cutoff")).toHaveValue(0.5);
    change("Probability cutoff", "");
    change("Bar for long move lists", "");
    change("Candidates for the LLM", "0");
    change("Seed", "1.5");
    expect(screen.getByLabelText("Candidates for the LLM")).toHaveValue(0);
    expect(screen.getByLabelText("Candidates for the LLM")).toHaveAttribute("aria-invalid", "true");
    expect(matchup()).toHaveTextContent("Fix the Advanced settings marked invalid.");
    expect(play()).toBeDisabled();
    change("Candidates for the LLM", "3");
    expect(play()).toBeDisabled();
    change("Seed", "2");
    await clickPlay();
    const context = onPlay.mock.calls[0][1];
    expect(context.top_p).toBeNull();
    expect(context.tournament_threshold).toBeNull();
    expect(context.k).toBe(3);
    expect(context.seed).toBe(2);
  });

  it("drops a hidden field's invalid text: the knob keeps the value it shows again", async () => {
    const { onPlay } = open();
    advanced();
    change("Candidates for the LLM", "0");
    expect(play()).toBeDisabled();
    advanced();
    expect(play()).toBeEnabled();
    advanced();
    expect(screen.getByLabelText("Candidates for the LLM")).toHaveValue(5);
    await clickPlay();
    expect(onPlay.mock.calls[0][1].k).toBe(5);
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
