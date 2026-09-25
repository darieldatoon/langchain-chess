import { Button } from "@langchain/macaw-components/Button";
import { Input } from "@langchain/macaw-components/Input";
import { Pane } from "@langchain/macaw-components/Pane";
import { Select, type SelectOption } from "@langchain/macaw-components/Select";
import { Slider } from "@langchain/macaw-components/Slider";
import { Switch } from "@langchain/macaw-components/Switch";
import { Text } from "@langchain/macaw-components/Text";
import { useState } from "react";
import { parseKnob, parseNullableKnob, sliderValue } from "../format";
import { CONTEXT_CHECKS, withKnob, type Settings } from "../settings";
import type {
  ChessContext,
  DescriptionStyle,
  DrawClaims,
  GateSignal,
  Memory,
  PolicyKind,
  ReasoningEffort,
  SystemOneModel,
} from "../types";

interface Props {
  open: boolean;
  settings: Settings;
  onSave: (settings: Settings) => void;
  onClose: () => void;
}

const POLICIES: SelectOption<PolicyKind>[] = [
  {
    value: "hybrid",
    label: "Hybrid",
    description: "System 1 plays when sure and suggests candidates otherwise",
  },
  { value: "systemone", label: "System 1 Only", description: "One ranked decision per move" },
  { value: "llm", label: "LLM Only", description: "A reasoning model picks every move" },
];
const EFFORTS: SelectOption<ReasoningEffort>[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];
const MEMORIES: SelectOption<Memory>[] = [
  { value: "none", label: "None", description: "Each turn sees only the current position" },
  { value: "full", label: "Full", description: "The whole game's conversation, every turn" },
  {
    value: "summarize",
    label: "Summarize",
    description: "The conversation, summarized as it grows",
  },
];
const DRAW_CLAIMS: SelectOption<DrawClaims>[] = [
  { value: "auto", label: "Auto", description: "Threefold and fifty-move draws end the game" },
  { value: "never", label: "Never", description: "Only forced draws end the game" },
];
const SYSTEMONE_MODELS: SelectOption<SystemOneModel>[] = [
  { value: "semif-qwen3.5-4b", label: "semif-qwen3.5-4b" },
  { value: "typesafe/jev-latest", label: "typesafe/jev-latest" },
];
const STYLES: SelectOption<DescriptionStyle>[] = [
  { value: "rich", label: "Rich", description: "Captures, checks, exchange results" },
  { value: "terse", label: "Terse", description: "Move names only" },
];
const GATES: SelectOption<GateSignal>[] = [
  { value: "margin", label: "Margin", description: "Top-1 minus top-2 probability" },
  { value: "confidence", label: "Confidence", description: "System 1's Choice confidence" },
];

export function SettingsPanel({ open, settings, onSave, onClose }: Props) {
  const [apiKey, setApiKey] = useState(settings.apiKey);
  const [ctx, setCtx] = useState<ChessContext>(settings.context);
  const set = <K extends keyof ChessContext>(key: K, value: ChessContext[K] | undefined) =>
    setCtx((c) => withKnob(c, key, value));
  const number = (key: "k" | "seed") => ({
    value: ctx[key],
    isValid: (v: string) => parseKnob(v, CONTEXT_CHECKS[key]) !== undefined,
    onChange: (v: string) => set(key, parseKnob(v, CONTEXT_CHECKS[key])),
  });
  const nullable = (key: "tournament_threshold" | "top_p" | "summary_trigger_tokens") => ({
    value: ctx[key],
    isValid: (v: string) => parseNullableKnob(v, CONTEXT_CHECKS[key]) !== undefined,
    onChange: (v: string) => set(key, parseNullableKnob(v, CONTEXT_CHECKS[key])),
  });
  const usesModel = ctx.policy !== "systemone";
  const usesSystemOne = ctx.policy !== "llm";

  return (
    <Pane
      open={open}
      onClose={onClose}
      title="Settings"
      description="Connection and opponent configuration. Changes apply to the next move."
      noBackArrow
      // Pane lays its content out as a block inside a full-screen overlay; the auto margin
      // anchors it to the right edge, where its slide-in animation comes from.
      dialogStyle={{ width: "min(30rem, 100vw)", marginLeft: "auto", marginRight: 0 }}
    >
      <div className="flex flex-col gap-space-5 p-space-5">
        <Section title="Connection">
          <Input
            id="api-key"
            size="md"
            type="password"
            label="LangSmith API Key"
            value={apiKey}
            onChange={setApiKey}
            placeholder="lsv2_..."
            hintText="Stored in this browser only. Not needed against langgraph dev."
          />
        </Section>

        <Section title="Game">
          <Field id="policy" label="Opponent">
            <Select
              aria-label="Opponent"
              size="md"
              value={ctx.policy}
              options={POLICIES}
              hideSearch
              onChange={(v) => set("policy", v)}
            />
          </Field>
          <Field id="draw-claims" label="Draw Claims">
            <Select
              aria-label="Draw Claims"
              size="md"
              value={ctx.draw_claims}
              options={DRAW_CLAIMS}
              hideSearch
              onChange={(v) => set("draw_claims", v)}
            />
          </Field>
          <Field
            id="memory"
            label="Memory"
            hint={usesModel ? "What the model sees of earlier turns." : "System 1 has no memory."}
          >
            <Select
              aria-label="Memory"
              size="md"
              value={ctx.memory}
              options={MEMORIES}
              hideSearch
              disabled={!usesModel}
              onChange={(v) => set("memory", v)}
            />
          </Field>
        </Section>

        {usesModel && (
          <Section title="LLM">
            <Input
              id="model"
              size="md"
              label="Model"
              value={ctx.model}
              onChange={(v) => set("model", v.trim() === "" ? undefined : v)}
              hintText="Bare names route through the LLM Gateway; openai:gpt-5.6-sol goes direct."
            />
            <Field id="effort" label="Reasoning Effort">
              <Select
                aria-label="Reasoning Effort"
                size="md"
                value={ctx.reasoning_effort}
                options={EFFORTS}
                hideSearch
                onChange={(v) => set("reasoning_effort", v)}
              />
            </Field>
            <Switch
              label="List legal moves in the prompt"
              checked={ctx.show_legal_moves}
              onChange={(v) => set("show_legal_moves", v)}
            />
            <NumberField
              id="summary-trigger"
              label="Summary Trigger Tokens"
              {...nullable("summary_trigger_tokens")}
              placeholder="From the model profile"
              hintText="Empty uses the model's profile."
              min={1}
            />
          </Section>
        )}

        {usesSystemOne && (
          <Section title="System 1">
            <Field id="systemone-model" label="System 1 Model">
              <Select
                aria-label="System 1 Model"
                size="md"
                value={ctx.systemone_model}
                options={SYSTEMONE_MODELS}
                hideSearch
                onChange={(v) => set("systemone_model", v)}
              />
            </Field>
            <Field id="style" label="Move Descriptions">
              <Select
                aria-label="Move Descriptions"
                size="md"
                value={ctx.style}
                options={STYLES}
                hideSearch
                onChange={(v) => set("style", v)}
              />
            </Field>
            <Switch
              label="Ask for a position Score"
              checked={ctx.with_eval}
              onChange={(v) => set("with_eval", v)}
            />
            <Switch
              label="Ask the Noul questions"
              checked={ctx.with_nouls}
              onChange={(v) => set("with_nouls", v)}
            />
            <NumberField
              id="seed"
              label="Seed"
              {...number("seed")}
              hintText="Seeds the tournament shuffle."
              step={1}
            />
          </Section>
        )}

        {ctx.policy === "hybrid" && (
          <Section title="Gate">
            <Field
              id="threshold"
              label="Threshold"
              hint="0 lets System 1 play every move, 1 hands every move to the LLM."
              trailing={
                <Text variant="sm" as="span" className="font-mono" data-testid="threshold-value">
                  {ctx.threshold.toFixed(2)}
                </Text>
              }
            >
              <Slider
                aria-label="Threshold"
                min={0}
                max={1}
                step={0.05}
                value={ctx.threshold}
                onChange={(v) => set("threshold", sliderValue(v))}
              />
            </Field>
            <NumberField
              id="tournament-threshold"
              label="Tournament Threshold"
              {...nullable("tournament_threshold")}
              placeholder="Same as threshold"
              hintText="Used after a tournament. Empty uses the threshold."
              min={0}
              max={1}
              step={0.05}
            />
            <Field id="gate" label="Signal">
              <Select
                aria-label="Signal"
                size="md"
                value={ctx.gate}
                options={GATES}
                hideSearch
                onChange={(v) => set("gate", v)}
              />
            </Field>
            <NumberField id="k" label="Shortlist Size" {...number("k")} min={1} max={255} />
            <NumberField
              id="top-p"
              label="Top-p"
              {...nullable("top_p")}
              placeholder="Off"
              hintText="Cut the shortlist at this probability mass instead. Empty uses the size."
              min={0}
              max={1}
              step={0.05}
            />
          </Section>
        )}

        <div className="flex justify-end gap-space-2 border-t border-subtle pt-space-4">
          <Button variant="outlined" color="secondary" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button
            color="primary"
            size="md"
            onClick={() => onSave({ apiKey: apiKey.trim(), context: ctx })}
          >
            Save
          </Button>
        </div>
      </div>
    </Pane>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-space-3">
      <Text variant="h4" as="h3" color="secondary">
        {title}
      </Text>
      {children}
    </section>
  );
}

function Field({
  id,
  label,
  hint,
  trailing,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-space-1">
      <div className="flex items-center justify-between">
        <Text variant="sm" weight="medium" as="label" htmlFor={id}>
          {label}
        </Text>
        {trailing}
      </div>
      <div id={id}>{children}</div>
      {hint && (
        <Text variant="xs" color="tertiary">
          {hint}
        </Text>
      )}
    </div>
  );
}

/**
 * Keeps its own text so a half-typed number ("0.", "") stays editable; the knob only takes
 * valid values, and the field flags the rest.
 */
function NumberField({
  value,
  isValid,
  onChange,
  ...rest
}: {
  id: string;
  label: string;
  value: number | null;
  isValid: (text: string) => boolean;
  onChange: (text: string) => void;
  hintText?: string;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
}) {
  const [draft, setDraft] = useState(value === null ? "" : String(value));
  return (
    <Input
      {...rest}
      size="md"
      type="number"
      value={draft}
      isError={!isValid(draft)}
      onChange={(v) => {
        setDraft(v);
        onChange(v);
      }}
    />
  );
}
