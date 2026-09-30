import { Banner } from "@langchain/macaw-components/Banner";
import { Button } from "@langchain/macaw-components/Button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@langchain/macaw-components/DropdownMenu";
import { Input } from "@langchain/macaw-components/Input";
import { RadioCard } from "@langchain/macaw-components/RadioCard";
import { RadioGroup } from "@langchain/macaw-components/RadioGroup";
import { Select, type SelectOption } from "@langchain/macaw-components/Select";
import { Text } from "@langchain/macaw-components/Text";
import { cn } from "@langchain/macaw-components/utils/cn";
import { CaretDownIcon } from "@phosphor-icons/react/dist/ssr/CaretDown";
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr/CaretRight";
import { DotsThreeIcon } from "@phosphor-icons/react/dist/ssr/DotsThree";
import { CrownIcon } from "@phosphor-icons/react/dist/ssr/Crown";
import { ShuffleIcon } from "@phosphor-icons/react/dist/ssr/Shuffle";
import { useCallback, useEffect, useRef, useState } from "react";
import { keyCheckMessage, type KeyCheck } from "../auth";
import { downloadJson, readJson } from "../files";
import type { ModelFacts } from "../modelFacts";
import { configurableOf, withKnob } from "../settings";
import {
  LLM_NAMES,
  LLM_PRESETS,
  SYSTEM_ONE_PRESETS,
  importedSetup,
  matchupLine,
  matchupOf,
  modelOf,
  sectionsOf,
  type LlmChoice,
  type Matchup,
  type Setup,
  type SideChoice,
  type Summarize,
  type TakesEffort,
} from "../setup";
import { ResponsiveDialog, TOUCH_TARGET, type ChessContext } from "@langchain-chess/chess-ui";
import { AdvancedSettings, Field, type DraftKnob, type SetKnob } from "./AdvancedSettings";

interface Props {
  initial: Setup;
  /** Only a game on screen can be gone back to; otherwise there is nothing to cancel to. */
  canCancel: boolean;
  onPlay: (setup: Setup, context: ChessContext) => void;
  onClose: () => void;
  /** Hands over the unsaved picks so they survive the trip to settings and back. */
  onOpenSettings: (draft: Setup) => void;
  /** Runs on Play; the game starts only once the server accepts the key. */
  checkKey: () => Promise<KeyCheck>;
  /** What the server knows about the model: `summarize` needs its input limit, and a model that
   * takes no reasoning effort is sent none. */
  modelFacts: (model: string) => Promise<ModelFacts>;
}

/** Waits out typing in the custom model field before asking the server. */
export const LIMIT_DELAY_MS = 300;

const SIDES: { value: SideChoice; label: string; icon: React.ReactNode }[] = [
  { value: "white", label: "White", icon: <CrownIcon aria-hidden size={24} weight="regular" /> },
  {
    value: "random",
    label: "Random",
    icon: <ShuffleIcon aria-hidden size={24} weight="regular" />,
  },
  { value: "black", label: "Black", icon: <CrownIcon aria-hidden size={24} weight="fill" /> },
];

const SYSTEM_ONE_LABELS: Record<(typeof SYSTEM_ONE_PRESETS)[number], string> = {
  "semif-qwen3.5-4b": "SemIf",
  "typesafe/jev-latest": "Jev (experimental)",
};

/** Picker keys, not model names: a model from elsewhere may be named anything. */
const OTHER_SYSTEM_ONE = "other";
const NO_SYSTEM_ONE = "none";

const isSystemOnePreset = (model: string) =>
  (SYSTEM_ONE_PRESETS as readonly string[]).includes(model);

/** The presets, then a model from elsewhere (a recorded game, storage) under its own name. */
function systemOnes(other: string): SelectOption<string>[] {
  return [
    ...SYSTEM_ONE_PRESETS.map((value) => ({
      value,
      label: SYSTEM_ONE_LABELS[value],
      description: value,
    })),
    ...(other === "" ? [] : [{ value: OTHER_SYSTEM_ONE, label: other }]),
    { value: NO_SYSTEM_ONE, label: "None", description: "The LLM plays alone" },
  ];
}

function systemOneKey(setup: Setup): string {
  if (setup.systemOneOff) return NO_SYSTEM_ONE;
  return isSystemOnePreset(setup.systemOne) ? setup.systemOne : OTHER_SYSTEM_ONE;
}

function summarizeOf(facts: ModelFacts): Summarize {
  if (facts.kind === "failed") return "unknown";
  return facts.maxInputTokens === null ? "no" : "yes";
}

const INVALID_KNOBS: Matchup = { ok: false, reason: "Fix the Advanced settings marked invalid." };

const LLMS: SelectOption<LlmChoice>[] = [
  ...LLM_PRESETS.map((value) => ({ value, label: LLM_NAMES[value] })),
  { value: "none", label: "None", description: "System 1 plays alone" },
  { value: "custom", label: "Custom model…", description: "Any model spec" },
];

export function NewGameDialog({
  initial,
  canCancel,
  onPlay,
  onClose,
  onOpenSettings,
  checkKey,
  modelFacts,
}: Props) {
  const [setup, setSetup] = useState(initial);
  const [advanced, setAdvanced] = useState(false);
  const [checking, setChecking] = useState(false);
  const [keyProblem, setKeyProblem] = useState<Exclude<KeyCheck, { kind: "ok" }> | null>(null);
  const pick =
    <K extends keyof Setup>(key: K) =>
    (value: Setup[K] | undefined) =>
      setSetup((s) => withKnob(s, key, value));
  // Kept while a preset is picked, so it can be picked again. No model is named "".
  const [otherSystemOne, setOtherSystemOne] = useState(() =>
    isSystemOnePreset(initial.systemOne) ? "" : initial.systemOne,
  );
  const [importProblem, setImportProblem] = useState<string | null>(null);
  // Remounts Advanced after an import: its text fields keep their own drafts.
  const [imported, setImported] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const importFile = async (file: File) => {
    const read = await readJson(file);
    const result = read.ok ? importedSetup(read.value, setup.side) : read;
    if (!mounted.current) return;
    if (!result.ok) {
      setImportProblem(result.why);
      return;
    }
    setImportProblem(null);
    setSetup(result.setup);
    if (!isSystemOnePreset(result.setup.systemOne)) setOtherSystemOne(result.setup.systemOne);
    setImported((n) => n + 1);
  };
  const pickSystemOne = (key: string | undefined) =>
    setSetup((s) => {
      if (key === undefined) return s;
      if (key === NO_SYSTEM_ONE) return { ...s, systemOneOff: true };
      const model = key === OTHER_SYSTEM_ONE ? otherSystemOne : key;
      return { ...s, systemOne: model, systemOneOff: false };
    });
  const setKnob: SetKnob = (key, value) =>
    setSetup((s) => ({ ...s, knobs: withKnob(s.knobs, key, value) }));
  const model = modelOf(setup);
  const [facts, setFacts] = useState<{ model: string; result: ModelFacts } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const answered = facts?.model === model ? facts.result : null;
  const summarize: Summarize = answered ? summarizeOf(answered) : "checking";
  // A failed request says nothing about the model, and the server checks the effort again.
  const takesEffort: TakesEffort = answered
    ? answered.kind === "failed" || answered.takesEffort
    : "checking";
  // Number fields whose text isn't a valid value: Play would send a value they no longer show.
  const [invalid, setInvalid] = useState<Partial<Record<DraftKnob, boolean>>>({});
  const setValidity = useCallback(
    (knob: DraftKnob, valid: boolean) =>
      setInvalid((s) => ((s[knob] ?? false) === !valid ? s : { ...s, [knob]: !valid })),
    [],
  );
  const matchup = matchupOf(setup, summarize, takesEffort);
  const ready = matchup.ok && Object.values(invalid).some(Boolean) ? INVALID_KNOBS : matchup;
  const mounted = useRef(true);
  // What is on screen now, for a key check that answers after the picks changed.
  const onScreen = useRef({ setup, ready });
  useEffect(() => {
    onScreen.current = { setup, ready };
  });

  useEffect(() => {
    if (!model) return;
    let current = true;
    const timer = setTimeout(() => {
      void modelFacts(model).then((result) => {
        if (current) setFacts({ model, result });
      });
    }, LIMIT_DELAY_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
    // `attempt` is read by nothing inside: a retry changes it to ask again.
  }, [model, modelFacts, attempt]);

  const recheck = () => {
    setFacts(null);
    setAttempt((a) => a + 1);
  };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const play = async (context: ChessContext) => {
    setChecking(true);
    setKeyProblem(null);
    const check = await checkKey();
    // Cancelled or sent to settings mid-check: a late answer must not start a game.
    if (!mounted.current) return;
    setChecking(false);
    if (check.kind !== "ok") setKeyProblem(check);
    // Edited mid-check: that Play was for picks no longer on screen, so Play asks again.
    else if (onScreen.current.setup === setup && onScreen.current.ready.ok) onPlay(setup, context);
  };
  const problem = keyProblem && keyCheckMessage(keyProblem);

  const footer = (
    <div className="flex flex-wrap items-center justify-between gap-space-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="plain"
            color="secondary"
            size="md"
            leftDecorator={DotsThreeIcon}
            className={TOUCH_TARGET}
          >
            More
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem className={TOUCH_TARGET} onSelect={() => onOpenSettings(setup)}>
            Settings
          </DropdownMenuItem>
          <DropdownMenuItem className={TOUCH_TARGET} onSelect={() => fileInput.current!.click()}>
            Import
          </DropdownMenuItem>
          {ready.ok ? (
            <DropdownMenuItem
              className={TOUCH_TARGET}
              onSelect={() => downloadJson("opponent.json", configurableOf(ready.context))}
            >
              Export
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem className={TOUCH_TARGET} disabled>
              Export
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        aria-label="Setup file"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void importFile(file);
        }}
      />
      <div className="flex items-center gap-space-2">
        {canCancel && (
          <Button
            variant="outlined"
            color="secondary"
            size="md"
            className={TOUCH_TARGET}
            onClick={onClose}
          >
            Cancel
          </Button>
        )}
        {ready.ok ? (
          <Button
            color="primary"
            size="md"
            className={TOUCH_TARGET}
            loading={checking}
            disabled={checking}
            onClick={() => void play(ready.context)}
          >
            Play
          </Button>
        ) : (
          <Button color="primary" size="md" className={TOUCH_TARGET} disabled>
            Play
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <ResponsiveDialog
      title="New game"
      description="Choose your colour and the opponent."
      onClose={canCancel ? onClose : undefined}
      footer={footer}
    >
      <div className="flex flex-col gap-space-5">
        <div className="flex flex-col gap-space-2">
          <Text variant="sm" weight="medium" as="span" id="play-as">
            Play As
          </Text>
          <RadioGroup
            aria-labelledby="play-as"
            value={setup.side}
            // Only SIDES values reach here.
            onValueChange={(v) => pick("side")(v as SideChoice)}
            className="grid grid-cols-3 gap-space-3"
          >
            {SIDES.map((side) => (
              <RadioCard key={side.value} value={side.value} aria-label={side.label} hideIndicator>
                <span className="flex flex-col items-center gap-space-1">
                  {side.icon}
                  <Text variant="sm" weight="medium" as="span">
                    {side.label}
                  </Text>
                </span>
              </RadioCard>
            ))}
          </RadioGroup>
        </div>

        <Field id="system-one" label="System 1" hint="A fast move ranker.">
          <Select
            aria-label="System 1"
            size="md"
            value={systemOneKey(setup)}
            options={systemOnes(otherSystemOne)}
            hideSearch
            onChange={pickSystemOne}
          />
        </Field>

        <div className="flex flex-col gap-space-3">
          <Field id="llm" label="LLM" hint="A reasoning model that thinks the position through.">
            <Select
              aria-label="LLM"
              size="md"
              value={setup.llm}
              options={LLMS}
              hideSearch
              onChange={pick("llm")}
            />
          </Field>
          {setup.llm === "custom" && (
            <Input
              id="custom-model"
              size="md"
              label="Model Spec"
              value={setup.customModel}
              onChange={pick("customModel")}
              placeholder="langsmith:baseten/moonshotai/Kimi-K3"
              hintText="Use the format provider:model, e.g. langsmith:anthropic/claude-opus-5-5."
              autoFocus
            />
          )}
        </div>

        <div
          aria-label="matchup"
          className="flex items-center justify-between gap-space-3 rounded-md bg-surface-level-2 px-space-4 py-space-3"
          role="status"
        >
          <Text variant="sm" color={ready.ok ? "primary" : "error"}>
            {ready.ok ? matchupLine(ready.context) : ready.reason}
          </Text>
          {!matchup.ok && summarize === "unknown" && (
            <Button
              variant="plain"
              size="sm"
              color="primary"
              className={TOUCH_TARGET}
              onClick={recheck}
            >
              Retry
            </Button>
          )}
        </div>

        <div className="flex flex-col gap-space-4">
          <Button
            variant="plain"
            color="secondary"
            size="sm"
            className={cn("self-start", TOUCH_TARGET)}
            leftDecorator={advanced ? CaretDownIcon : CaretRightIcon}
            aria-expanded={advanced}
            aria-controls="advanced-settings"
            onClick={() => setAdvanced((a) => !a)}
          >
            Advanced
          </Button>
          {advanced && (
            <div id="advanced-settings">
              <AdvancedSettings
                key={imported}
                knobs={setup.knobs}
                sections={sectionsOf(setup)}
                summarize={summarize}
                takesEffort={takesEffort}
                onKnob={setKnob}
                onValidity={setValidity}
              />
            </div>
          )}
        </div>

        {importProblem && (
          <Banner intent="warning" title="Couldn't import that setup">
            {importProblem}
          </Banner>
        )}

        {problem && (
          <Banner
            intent="warning"
            title={problem.title}
            action={
              <Button
                variant="plain"
                size="sm"
                color="primary"
                className={TOUCH_TARGET}
                onClick={() => onOpenSettings(setup)}
              >
                Open settings
              </Button>
            }
          >
            {problem.body}
          </Banner>
        )}
      </div>
    </ResponsiveDialog>
  );
}
