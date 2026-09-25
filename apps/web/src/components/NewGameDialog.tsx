import { Button } from "@langchain/macaw-components/Button";
import { Dialog, DialogContent } from "@langchain/macaw-components/Dialog";
import { Input } from "@langchain/macaw-components/Input";
import { RadioCard } from "@langchain/macaw-components/RadioCard";
import { RadioGroup } from "@langchain/macaw-components/RadioGroup";
import { Select, type SelectOption } from "@langchain/macaw-components/Select";
import { Text } from "@langchain/macaw-components/Text";
import { CaretDownIcon } from "@phosphor-icons/react/dist/ssr/CaretDown";
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr/CaretRight";
import { CrownIcon } from "@phosphor-icons/react/dist/ssr/Crown";
import { ShuffleIcon } from "@phosphor-icons/react/dist/ssr/Shuffle";
import { useState } from "react";
import { withKnob } from "../settings";
import {
  matchupLine,
  matchupOf,
  sectionsOf,
  type LlmChoice,
  type Setup,
  type SideChoice,
  type SystemOneChoice,
} from "../setup";
import type { ChessContext } from "../types";
import { AdvancedSettings, Field, type SetKnob } from "./AdvancedSettings";

interface Props {
  open: boolean;
  initial: Setup;
  /** Only a game on screen can be gone back to; otherwise there is nothing to cancel to. */
  canCancel: boolean;
  onPlay: (setup: Setup, context: ChessContext) => void;
  onClose: () => void;
}

const SIDES: { value: SideChoice; label: string; icon: React.ReactNode }[] = [
  { value: "white", label: "White", icon: <CrownIcon aria-hidden size={24} weight="regular" /> },
  {
    value: "random",
    label: "Random",
    icon: <ShuffleIcon aria-hidden size={24} weight="regular" />,
  },
  { value: "black", label: "Black", icon: <CrownIcon aria-hidden size={24} weight="fill" /> },
];

const SYSTEM_ONES: SelectOption<SystemOneChoice>[] = [
  { value: "semif-qwen3.5-4b", label: "SemIf", description: "semif-qwen3.5-4b" },
  { value: "typesafe/jev-latest", label: "Jev (experimental)", description: "typesafe/jev-latest" },
  { value: "none", label: "None", description: "The LLM plays alone" },
];

const LLMS: SelectOption<LlmChoice>[] = [
  { value: "claude-opus-5-5", label: "Claude Opus 5.5" },
  { value: "claude-opus-5", label: "Claude Opus 5" },
  { value: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
  { value: "none", label: "None", description: "System 1 plays alone" },
  { value: "custom", label: "Custom model…", description: "Any model spec" },
];

export function NewGameDialog({ open, initial, canCancel, onPlay, onClose }: Props) {
  const [setup, setSetup] = useState(initial);
  const [advanced, setAdvanced] = useState(false);
  const pick =
    <K extends keyof Setup>(key: K) =>
    (value: Setup[K] | undefined) =>
      setSetup((s) => withKnob(s, key, value));
  const setKnob: SetKnob = (key, value) =>
    setSetup((s) => ({ ...s, knobs: withKnob(s.knobs, key, value) }));
  const matchup = matchupOf(setup);

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent
        title="New game"
        description="Choose your colour and the opponent."
        showClose={canCancel}
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
                <RadioCard
                  key={side.value}
                  value={side.value}
                  aria-label={side.label}
                  hideIndicator
                >
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
              value={setup.systemOne}
              options={SYSTEM_ONES}
              hideSearch
              onChange={pick("systemOne")}
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
                placeholder="openai:gpt-5.6-sol"
                hintText="Bare names route through the LLM Gateway; provider:model goes direct."
                autoFocus
              />
            )}
          </div>

          <div
            aria-label="matchup"
            className="rounded-md bg-surface-level-2 px-space-4 py-space-3"
            role="status"
          >
            <Text variant="sm" color={matchup.ok ? "primary" : "error"}>
              {matchup.ok ? matchupLine(matchup.context) : matchup.reason}
            </Text>
          </div>

          <div className="flex flex-col gap-space-4">
            <Button
              variant="plain"
              color="secondary"
              size="sm"
              className="self-start"
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
                  knobs={setup.knobs}
                  sections={sectionsOf(setup)}
                  onKnob={setKnob}
                />
              </div>
            )}
          </div>

          <div className="flex justify-end gap-space-2 border-t border-subtle pt-space-4">
            {canCancel && (
              <Button variant="outlined" color="secondary" size="md" onClick={onClose}>
                Cancel
              </Button>
            )}
            {matchup.ok ? (
              <Button color="primary" size="md" onClick={() => onPlay(setup, matchup.context)}>
                Play
              </Button>
            ) : (
              <Button color="primary" size="md" disabled>
                Play
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
