import { Button } from "@langchain/macaw-components/Button";
import { Input } from "@langchain/macaw-components/Input";
import { Pane } from "@langchain/macaw-components/Pane";
import { Select, type SelectOption } from "@langchain/macaw-components/Select";
import { Slider } from "@langchain/macaw-components/Slider";
import { Switch } from "@langchain/macaw-components/Switch";
import { Text } from "@langchain/macaw-components/Text";
import { useState } from "react";
import { sliderValue } from "../format";
import { withKnob, type Settings } from "../settings";
import type {
  DescriptionStyle,
  GateSignal,
  PlayContext,
  PolicyKind,
  ReasoningEffort,
  Side,
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
    description: "Jev moves when sure, the LLM decides otherwise",
  },
  { value: "jev", label: "Jev Only", description: "System 1: one typed decision per move" },
  { value: "llm", label: "LLM Only", description: "System 2: a reasoning model picks every move" },
  { value: "random", label: "Random", description: "A uniform random legal move" },
];
const SIDES: SelectOption<Side>[] = [
  { value: "white", label: "White" },
  { value: "black", label: "Black" },
];
const EFFORTS: SelectOption<ReasoningEffort>[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];
const STYLES: SelectOption<DescriptionStyle>[] = [
  { value: "rich", label: "Rich", description: "Captures, checks, exchange results" },
  { value: "terse", label: "Terse", description: "Move names only" },
];
const GATES: SelectOption<GateSignal>[] = [
  { value: "margin", label: "Margin", description: "Top-1 minus top-2 probability" },
  { value: "confidence", label: "Confidence", description: "Jev's Choice confidence" },
];

export function SettingsPanel({ open, settings, onSave, onClose }: Props) {
  const [apiKey, setApiKey] = useState(settings.apiKey);
  const [ctx, setCtx] = useState<PlayContext>(settings.context);
  const set = <K extends keyof PlayContext>(key: K, value: PlayContext[K]) =>
    setCtx((c) => ({ ...c, [key]: value }));
  const usesLlm = ctx.policy === "llm" || ctx.policy === "hybrid";
  const usesJev = ctx.policy === "jev" || ctx.policy === "hybrid";

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
              onChange={(v) => setCtx((c) => withKnob(c, "policy", v))}
            />
          </Field>
          <Field id="side" label="You Play" hint="Applies to the next new game.">
            <Select
              aria-label="You Play"
              size="md"
              value={ctx.human_side}
              options={SIDES}
              hideSearch
              onChange={(v) => setCtx((c) => withKnob(c, "human_side", v))}
            />
          </Field>
        </Section>

        {usesLlm && (
          <Section title="LLM">
            <Input
              id="model"
              size="md"
              label="Model"
              value={ctx.model}
              onChange={(v) => set("model", v)}
              hintText="Bare names route through the LLM Gateway; openai:gpt-5.6-sol goes direct."
            />
            <Field id="effort" label="Reasoning Effort">
              <Select
                aria-label="Reasoning Effort"
                size="md"
                value={ctx.reasoning_effort}
                options={EFFORTS}
                hideSearch
                onChange={(v) => setCtx((c) => withKnob(c, "reasoning_effort", v))}
              />
            </Field>
            {ctx.policy === "llm" && (
              <Switch
                label="List legal moves in the prompt"
                checked={ctx.include_legal_moves}
                onChange={(v) => set("include_legal_moves", v)}
              />
            )}
          </Section>
        )}

        {usesJev && (
          <Section title="Jev">
            <Field id="style" label="Move Descriptions">
              <Select
                aria-label="Move Descriptions"
                size="md"
                value={ctx.style}
                options={STYLES}
                hideSearch
                onChange={(v) => setCtx((c) => withKnob(c, "style", v))}
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
          </Section>
        )}

        {ctx.policy === "hybrid" && (
          <Section title="Gate">
            <Field
              id="threshold"
              label="Threshold"
              hint="0 is Jev alone, 1 hands every move to the LLM."
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
            <Field id="gate" label="Signal">
              <Select
                aria-label="Signal"
                size="md"
                value={ctx.gate}
                options={GATES}
                hideSearch
                onChange={(v) => setCtx((c) => withKnob(c, "gate", v))}
              />
            </Field>
            <Input
              id="k"
              size="md"
              type="number"
              label="Shortlist Size"
              value={String(ctx.k)}
              onChange={(v) => set("k", Number(v))}
              min={1}
              max={20}
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
