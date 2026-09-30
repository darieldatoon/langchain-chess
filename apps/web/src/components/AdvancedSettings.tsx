import { Input } from "@langchain/macaw-components/Input";
import { Select, type SelectOption } from "@langchain/macaw-components/Select";
import { Slider } from "@langchain/macaw-components/Slider";
import { Switch } from "@langchain/macaw-components/Switch";
import { Text } from "@langchain/macaw-components/Text";
import { Textarea } from "@langchain/macaw-components/Textarea";
import { useEffect, useState } from "react";
import { parseKnob, parseNullableKnob, sliderValue } from "../format";
import { CONTEXT_CHECKS } from "../settings";
import {
  effortOf,
  effortOverridden,
  memoryOf,
  parseKwargs,
  type Kwargs,
  type Knobs,
  type Sections,
  type Summarize,
  type TakesEffort,
} from "../setup";
import {
  Hint,
  SETTING_HELP,
  SETTING_LABELS,
  type SettingKey,
  type DescriptionStyle,
  type DrawClaims,
  type GateSignal,
  type ListedMoves,
  type ReasoningEffort,
} from "@langchain-chess/chess-ui";

export type SetKnob = <K extends keyof Knobs>(key: K, value: Knobs[K] | undefined) => void;
export type NumberKnob = "k" | "seed" | "tournament_threshold" | "top_p";
/** The knobs typed as text, which can hold text that isn't a valid value yet. */
export type DraftKnob = NumberKnob | "model_kwargs";

interface Props {
  knobs: Knobs;
  sections: Sections;
  summarize: Summarize;
  /** False for an LLM that takes no reasoning effort, which holds the setting at the default. */
  takesEffort: TakesEffort;
  onKnob: SetKnob;
  /** Must be stable: each number field reports whether its text is a valid value. */
  onValidity: (knob: DraftKnob, valid: boolean) => void;
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
  { value: "off", label: "Off", description: "Each turn sees only the current position" },
  {
    value: "on",
    label: "Summarize",
    description: "Earlier turns, summarized when they fill 70% of the model's input limit",
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
  { value: "auto", label: "Yes", description: "Threefold repetition and fifty moves end the game" },
  { value: "never", label: "No", description: "Only forced draws end the game" },
];
const STYLES: SelectOption<DescriptionStyle>[] = [
  { value: "rich", label: "Detailed", description: "Captures, checks, exchange results" },
  { value: "terse", label: "Names only", description: "Just the move, e.g. Nf3" },
];
const GATES: SelectOption<GateSignal>[] = [
  {
    value: "margin",
    label: "Lead over the next move",
    description: "The top move's probability minus the second's",
  },
  { value: "confidence", label: "Its own confidence", description: "System 1's confidence score" },
];

const L = SETTING_LABELS;

/** The knobs behind the pickers; only the sections the chosen opponent uses are shown. */
export function AdvancedSettings({
  knobs,
  sections,
  summarize,
  takesEffort,
  onKnob: set,
  onValidity,
}: Props) {
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
  const toggle = (key: "show_fen" | "show_board" | "with_eval" | "with_nouls") => (
    <div className="flex items-center gap-space-2">
      <Switch label={L[key]} checked={knobs[key]} onChange={(v) => set(key, v)} />
      <Info setting={key} />
    </div>
  );

  return (
    <div className="flex flex-col gap-space-5">
      {sections.llm && (
        <Section title="LLM">
          <Field
            id="effort"
            setting="reasoning_effort"
            hint={
              takesEffort === false
                ? "This model doesn't take a reasoning effort."
                : effortOverridden(knobs)
                  ? "Model arguments set the effort, so this is ignored."
                  : undefined
            }
          >
            <Select
              aria-label={L.reasoning_effort}
              size="md"
              value={effortOf(knobs, takesEffort) ?? "default"}
              disabled={takesEffort === false}
              options={EFFORTS}
              hideSearch
              onChange={(v) => set("reasoning_effort", v === "default" ? null : v)}
            />
          </Field>
          <Field id="system-prompt" setting="system_prompt">
            <Textarea
              aria-label={L.system_prompt}
              value={knobs.system_prompt ?? ""}
              placeholder="The bundled prompt"
              rows={3}
              onChange={(v) => set("system_prompt", v.trim() === "" ? null : v)}
            />
          </Field>
          <Field id="move-list" setting="move_list">
            <Select
              aria-label={L.move_list}
              size="md"
              value={knobs.move_list}
              options={MOVE_LISTS}
              hideSearch
              onChange={(v) => set("move_list", v)}
            />
          </Field>
          {toggle("show_fen")}
          {toggle("show_board")}
          <Field
            id="memory"
            setting="memory"
            hint={
              summarize === "no"
                ? "This model has no known input limit, so it can't summarize."
                : summarize === "unknown"
                  ? "Couldn't reach the server to check this model's input limit."
                  : undefined
            }
          >
            <Select
              aria-label={L.memory}
              size="md"
              value={memoryOf(knobs, summarize) ? "on" : "off"}
              options={memories(summarize)}
              hideSearch
              onChange={(v) => v && set("memory", v === "on")}
            />
          </Field>
          <ModelKwargsField
            value={knobs.model_kwargs}
            onChange={(v) => set("model_kwargs", v)}
            onValidity={onValidity}
          />
        </Section>
      )}

      {sections.systemOne && (
        <Section title="System 1">
          <Field id="style" setting="style">
            <Select
              aria-label={L.style}
              size="md"
              value={knobs.style}
              options={STYLES}
              hideSearch
              onChange={(v) => set("style", v)}
            />
          </Field>
          {toggle("with_eval")}
          {toggle("with_nouls")}
          {sections.gate ? (
            <>
              <Field id="gate" setting="gate">
                <Select
                  aria-label={L.gate}
                  size="md"
                  value={knobs.gate}
                  options={GATES}
                  hideSearch
                  onChange={(v) => set("gate", v)}
                />
              </Field>
              <Field
                id="threshold"
                setting="threshold"
                hint="0 lets System 1 play every move, 1 hands every move to the LLM."
                trailing={
                  <Text variant="sm" as="span" className="font-mono" data-testid="threshold-value">
                    {knobs.threshold.toFixed(2)}
                  </Text>
                }
              >
                <Slider
                  aria-label={L.threshold}
                  min={0}
                  max={1}
                  step={0.05}
                  value={knobs.threshold}
                  onChange={(v) => set("threshold", sliderValue(v))}
                />
              </Field>
              <NumberField
                id="tournament-threshold"
                setting="tournament_threshold"
                {...nullable("tournament_threshold")}
                placeholder="Same as above"
                min={0}
                max={1}
                step={0.05}
              />
              <NumberField id="k" setting="k" {...number("k")} min={1} max={255} />
              <NumberField
                id="top-p"
                setting="top_p"
                {...nullable("top_p")}
                placeholder="Off"
                min={0}
                max={1}
                step={0.05}
              />
            </>
          ) : (
            <Text variant="xs" color="tertiary">
              How confident System 1 must be, and what the LLM is shown, apply when an LLM plays
              too.
            </Text>
          )}
        </Section>
      )}

      <Section title="Rules">
        <Field id="draw-claims" setting="draw_claims">
          <Select
            aria-label={L.draw_claims}
            size="md"
            value={knobs.draw_claims}
            options={DRAW_CLAIMS}
            hideSearch
            onChange={(v) => set("draw_claims", v)}
          />
        </Field>
        <NumberField id="seed" setting="seed" {...number("seed")} step={1} />
      </Section>
    </div>
  );
}

/** An info icon that says what a setting does and when to change it, on tap or hover. */
export function Info({ setting }: { setting: SettingKey }) {
  return <Hint label={`About ${SETTING_LABELS[setting]}`} text={SETTING_HELP[setting]} />;
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

/** A labelled control: a setting's name and tooltip, or a plain `label`. */
export function Field({
  id,
  label,
  setting,
  hint,
  trailing,
  children,
}: {
  id: string;
  hint?: string;
  trailing?: React.ReactNode;
  children: React.ReactNode;
} & ({ label: string; setting?: never } | { setting: SettingKey; label?: never })) {
  return (
    <div className="flex flex-col gap-space-1">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-space-1">
          <Text variant="sm" weight="medium" as="label" htmlFor={id}>
            {setting ? SETTING_LABELS[setting] : label}
          </Text>
          {setting && <Info setting={setting} />}
        </span>
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

const kwargsText = (value: Kwargs) =>
  Object.keys(value).length === 0 ? "" : JSON.stringify(value, null, 2);

/** Like NumberField: its own text, and only valid objects reach the knob. */
function ModelKwargsField({
  value,
  onChange,
  onValidity,
}: {
  value: Kwargs;
  onChange: (value: Kwargs) => void;
  onValidity: (knob: DraftKnob, valid: boolean) => void;
}) {
  const [draft, setDraft] = useState(() => kwargsText(value));
  const parsed = parseKwargs(draft);
  useEffect(() => {
    onValidity("model_kwargs", parsed.ok);
    return () => onValidity("model_kwargs", true);
  }, [parsed.ok, onValidity]);
  return (
    <Field id="model-kwargs" setting="model_kwargs">
      <Textarea
        aria-label={L.model_kwargs}
        value={draft}
        rows={3}
        placeholder='{"temperature": 0.2}'
        isError={!parsed.ok}
        hintText={parsed.ok ? undefined : parsed.why}
        onChange={(v) => {
          setDraft(v);
          const next = parseKwargs(v);
          if (next.ok) onChange(next.value);
        }}
      />
    </Field>
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
  id,
  setting,
  ...rest
}: {
  knob: NumberKnob;
  onValidity: (knob: DraftKnob, valid: boolean) => void;
  id: string;
  setting: SettingKey;
  value: number | null;
  isValid: (text: string) => boolean;
  onChange: (text: string) => void;
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
    <Field id={id} setting={setting}>
      <Input
        {...rest}
        aria-label={SETTING_LABELS[setting]}
        size="md"
        type="number"
        value={draft}
        isError={!valid}
        onChange={(v) => {
          setDraft(v);
          onChange(v);
        }}
      />
    </Field>
  );
}
