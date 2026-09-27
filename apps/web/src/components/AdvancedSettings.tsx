import { Input } from "@langchain/macaw-components/Input";
import { Select, type SelectOption } from "@langchain/macaw-components/Select";
import { Slider } from "@langchain/macaw-components/Slider";
import { Switch } from "@langchain/macaw-components/Switch";
import { Text } from "@langchain/macaw-components/Text";
import { useEffect, useState } from "react";
import { parseKnob, parseNullableKnob, sliderValue } from "../format";
import { CONTEXT_CHECKS } from "../settings";
import { memoryOf, type Knobs, type Sections, type Summarize } from "../setup";
import type {
  DescriptionStyle,
  DrawClaims,
  GateSignal,
  ListedMoves,
  ReasoningEffort,
} from "@langchain-chess/chess-ui";

export type SetKnob = <K extends keyof Knobs>(key: K, value: Knobs[K] | undefined) => void;
export type NumberKnob = "k" | "seed" | "tournament_threshold" | "top_p";

interface Props {
  knobs: Knobs;
  sections: Sections;
  summarize: Summarize;
  onKnob: SetKnob;
  /** Must be stable: each number field reports whether its text is a valid value. */
  onValidity: (knob: NumberKnob, valid: boolean) => void;
}

/** Select values are strings; `default` stands for null, which sends no effort. */
const EFFORTS: SelectOption<ReasoningEffort | "default">[] = [
  {
    value: "default",
    label: "Model default",
    description: "Sends none; needed for models without reasoning",
  },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];
/** Select values are strings; memory is a boolean. */
const memories = (summarize: Summarize): SelectOption<"off" | "on">[] => [
  { value: "off", label: "None", description: "Each turn sees only the current position" },
  {
    value: "on",
    label: "Summarize",
    description: "The conversation, summarized at 70% of the model's input limit",
    disabled: summarize === "no",
  },
];
const MOVE_LISTS: SelectOption<ListedMoves>[] = [
  { value: "both", label: "Candidates and legal moves" },
  { value: "legal", label: "Legal moves" },
  { value: "candidates", label: "Candidates", description: "System 1's, when it has any" },
  { value: "none", label: "None" },
];
const DRAW_CLAIMS: SelectOption<DrawClaims>[] = [
  { value: "auto", label: "Auto", description: "Threefold and fifty-move draws end the game" },
  { value: "never", label: "Never", description: "Only forced draws end the game" },
];
const STYLES: SelectOption<DescriptionStyle>[] = [
  { value: "rich", label: "Rich", description: "Captures, checks, exchange results" },
  { value: "terse", label: "Terse", description: "Move names only" },
];
const GATES: SelectOption<GateSignal>[] = [
  { value: "margin", label: "Margin", description: "Top-1 minus top-2 probability" },
  { value: "confidence", label: "Confidence", description: "System 1's Choice confidence" },
];

/** The knobs behind the pickers; only the sections the chosen opponent uses are shown. */
export function AdvancedSettings({ knobs, sections, summarize, onKnob: set, onValidity }: Props) {
  const number = (key: "k" | "seed") => ({
    knob: key,
    onValidity,
    value: knobs[key],
    isValid: (v: string) => parseKnob(v, CONTEXT_CHECKS[key]) !== undefined,
    onChange: (v: string) => set(key, parseKnob(v, CONTEXT_CHECKS[key])),
  });
  const nullable = (key: "tournament_threshold" | "top_p") => ({
    knob: key,
    onValidity,
    value: knobs[key],
    isValid: (v: string) => parseNullableKnob(v, CONTEXT_CHECKS[key]) !== undefined,
    onChange: (v: string) => set(key, parseNullableKnob(v, CONTEXT_CHECKS[key])),
  });

  return (
    <div className="flex flex-col gap-space-5">
      {sections.llm && (
        <Section title="LLM">
          <Field id="effort" label="Reasoning Effort">
            <Select
              aria-label="Reasoning Effort"
              size="md"
              value={knobs.reasoning_effort ?? "default"}
              options={EFFORTS}
              hideSearch
              onChange={(v) => set("reasoning_effort", v === "default" ? null : v)}
            />
          </Field>
          <Field id="move-list" label="Moves Listed">
            <Select
              aria-label="Moves Listed"
              size="md"
              value={knobs.move_list}
              options={MOVE_LISTS}
              hideSearch
              onChange={(v) => set("move_list", v)}
            />
          </Field>
          <Field
            id="memory"
            label="Memory"
            hint={
              summarize === "no"
                ? "This model has no known input limit, so it can't summarize."
                : summarize === "unknown"
                  ? "Couldn't reach the server to check this model's input limit."
                  : "What the model sees of earlier turns."
            }
          >
            <Select
              aria-label="Memory"
              size="md"
              value={memoryOf(knobs, summarize) ? "on" : "off"}
              options={memories(summarize)}
              hideSearch
              onChange={(v) => v && set("memory", v === "on")}
            />
          </Field>
        </Section>
      )}

      {sections.systemOne && (
        <Section title="System 1">
          <Field id="style" label="Move Descriptions">
            <Select
              aria-label="Move Descriptions"
              size="md"
              value={knobs.style}
              options={STYLES}
              hideSearch
              onChange={(v) => set("style", v)}
            />
          </Field>
          <Switch
            label="Ask for a position Score"
            checked={knobs.with_eval}
            onChange={(v) => set("with_eval", v)}
          />
          <Switch
            label="Ask the Noul questions"
            checked={knobs.with_nouls}
            onChange={(v) => set("with_nouls", v)}
          />
          {sections.gate ? (
            <>
              <Field id="gate" label="Signal">
                <Select
                  aria-label="Signal"
                  size="md"
                  value={knobs.gate}
                  options={GATES}
                  hideSearch
                  onChange={(v) => set("gate", v)}
                />
              </Field>
              <Field
                id="threshold"
                label="Threshold"
                hint="0 lets System 1 play every move, 1 hands every move to the LLM."
                trailing={
                  <Text variant="sm" as="span" className="font-mono" data-testid="threshold-value">
                    {knobs.threshold.toFixed(2)}
                  </Text>
                }
              >
                <Slider
                  aria-label="Threshold"
                  min={0}
                  max={1}
                  step={0.05}
                  value={knobs.threshold}
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
            </>
          ) : (
            <Text variant="xs" color="tertiary">
              The gate and shortlist apply when an LLM plays too.
            </Text>
          )}
        </Section>
      )}

      <Section title="Rules">
        <Field id="draw-claims" label="Draw Claims">
          <Select
            aria-label="Draw Claims"
            size="md"
            value={knobs.draw_claims}
            options={DRAW_CLAIMS}
            hideSearch
            onChange={(v) => set("draw_claims", v)}
          />
        </Field>
        <NumberField
          id="seed"
          label="Seed"
          {...number("seed")}
          hintText="Seeds System 1's tournament shuffle."
          step={1}
        />
      </Section>
    </div>
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

export function Field({
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
 * valid values, and the field flags the rest to the form, which holds Play until it's fixed.
 */
function NumberField({
  knob,
  onValidity,
  value,
  isValid,
  onChange,
  ...rest
}: {
  knob: NumberKnob;
  onValidity: (knob: NumberKnob, valid: boolean) => void;
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
  const valid = isValid(draft);
  // An unmounted field's text is discarded, so it no longer holds the form back.
  useEffect(() => {
    onValidity(knob, valid);
    return () => onValidity(knob, true);
  }, [knob, valid, onValidity]);
  return (
    <Input
      {...rest}
      size="md"
      type="number"
      value={draft}
      isError={!valid}
      onChange={(v) => {
        setDraft(v);
        onChange(v);
      }}
    />
  );
}
