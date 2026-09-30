import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@langchain/macaw-components/DropdownMenu";
import { Text } from "@langchain/macaw-components/Text";
import { CheckIcon } from "@phosphor-icons/react/dist/ssr/Check";
import type { ReactNode } from "react";
import { BOARD_SCALE, type Animation, type DisplayPrefs, type MoveInput } from "../prefs";
import { TOUCH_TARGET } from "../touch";
import { MenuGroup } from "./BoardMenu";

interface Props {
  prefs: DisplayPrefs;
  onChange: (prefs: DisplayPrefs) => void;
  /** The board-size slider, on `full` and `wide` only. */
  boardSize: boolean;
  app: "web" | "review";
}

const ANIMATIONS: readonly [Animation, string][] = [
  ["off", "Off"],
  ["fast", "Fast"],
  ["normal", "Normal"],
];
const INPUTS: readonly [MoveInput, string][] = [
  ["both", "Click and drag"],
  ["click", "Click only"],
  ["drag", "Drag only"],
];

type Flag = {
  [K in keyof DisplayPrefs]: DisplayPrefs[K] extends boolean ? K : never;
}[keyof DisplayPrefs];

/** Menu items keep the menu open, so several preferences can be set in one go. */
const keepOpen = (event: Event) => event.preventDefault();

function Check({ on }: { on: boolean }) {
  return (
    <span aria-hidden className="flex size-4 shrink-0 items-center">
      {on && <CheckIcon size={14} />}
    </span>
  );
}

/** The board menu's Display, Input and (web) Alerts groups: one `DisplayPrefs`. */
export function DisplayMenu({ prefs, onChange, boardSize, app }: Props) {
  const set = <K extends keyof DisplayPrefs>(key: K, value: DisplayPrefs[K]) =>
    onChange({ ...prefs, [key]: value });
  const toggle = (key: Flag, label: string) => (
    <DropdownMenuItem
      role="menuitemcheckbox"
      aria-checked={prefs[key]}
      className={TOUCH_TARGET}
      onSelect={(event) => {
        keepOpen(event);
        set(key, !prefs[key]);
      }}
    >
      <Check on={prefs[key]} />
      {label}
    </DropdownMenuItem>
  );
  const choice = <K extends "animation" | "moveInput">(
    key: K,
    label: string,
    options: readonly [DisplayPrefs[K], string][],
  ): ReactNode => (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className={TOUCH_TARGET}>
        <span className="size-4 shrink-0" />
        {label}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent aria-label={label}>
        {options.map(([value, name]) => (
          <DropdownMenuItem
            key={value}
            role="menuitemradio"
            aria-checked={prefs[key] === value}
            className={TOUCH_TARGET}
            onSelect={(event) => {
              keepOpen(event);
              set(key, value);
            }}
          >
            <Check on={prefs[key] === value} />
            {name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );

  return (
    <>
      <DropdownMenuSeparator />
      <MenuGroup label="Display">
        {toggle("showMaterial", "Show material")}
        {toggle("showLegalMoves", "Show legal moves")}
        {toggle("coordinates", "Coordinates")}
        {choice("animation", "Animation", ANIMATIONS)}
        {boardSize && (
          <label className="flex flex-col gap-space-1 px-space-2 py-space-2">
            <Text variant="sm" as="span">
              Board size {Math.round(prefs.boardScale * 100)}%
            </Text>
            {/* Native: Macaw's Slider can't name its thumb or size it for touch. */}
            <input
              type="range"
              aria-label="Board size"
              min={BOARD_SCALE.min}
              max={BOARD_SCALE.max}
              step={BOARD_SCALE.step}
              value={prefs.boardScale}
              className="w-full accent-[var(--bg-brand)] [@media(pointer:coarse)]:h-11"
              onChange={(event) => set("boardScale", Number(event.currentTarget.value))}
            />
          </label>
        )}
        {toggle("wheelSteps", "Wheel steps through moves")}
        {app === "review" && toggle("mistakeNotes", "Mistake notes")}
      </MenuGroup>
      <DropdownMenuSeparator />
      <MenuGroup label="Input">
        {choice("moveInput", "Moving pieces", INPUTS)}
        {toggle("autoQueen", "Always promote to a queen")}
      </MenuGroup>
      {app === "web" && (
        <>
          <DropdownMenuSeparator />
          <MenuGroup label="Alerts">{toggle("tabTitle", "Tab title on your turn")}</MenuGroup>
        </>
      )}
    </>
  );
}
