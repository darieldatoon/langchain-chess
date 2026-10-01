import { Badge } from "@langchain/macaw-components/Badge";
import { Card } from "@langchain/macaw-components/Card";
import { IconButton } from "@langchain/macaw-components/IconButton";
import { Popover, PopoverContent, PopoverTrigger } from "@langchain/macaw-components/Popover";
import { Spinner } from "@langchain/macaw-components/Spinner";
import { Switch } from "@langchain/macaw-components/Switch";
import { Text } from "@langchain/macaw-components/Text";
import { ThinkingState } from "@langchain/macaw-components/ThinkingState";
import { cn } from "@langchain/macaw-components/utils/cn";
import { CaretDownIcon } from "@phosphor-icons/react/dist/ssr/CaretDown";
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr/CaretRight";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/ssr/CheckCircle";
import { GearSixIcon } from "@phosphor-icons/react/dist/ssr/GearSix";
import { WarningCircleIcon } from "@phosphor-icons/react/dist/ssr/WarningCircle";
import type { ReactNode } from "react";
import { sanAt } from "../chess";
import { costText, seconds, sourceClass, sourceLabel, type SourceClass } from "../format";
import { systemOneMeta, turnCost } from "../selectors";
import { stageStatuses, type StageStatus } from "../stages";
import { TOUCH_TARGET } from "../touch";
import { paceRatio, stageStats, type GameSoFar, type Stat } from "../turnStats";
import {
  gateLine,
  llmNotes,
  moveHeading,
  rankNote,
  soFarLine,
  sourcesLine,
  statText,
  tokenLine,
} from "../turnText";
import type {
  Ply,
  RankedMove,
  ReplyState,
  Stages,
  SystemOneLive,
  SystemOneMeta,
  TurnRecord,
  TurnView,
} from "../types";
import { Analysis } from "./Analysis";
import { Hint } from "./Hint";
import { MoveBar } from "./MoveBar";

const BADGE_COLORS: Record<SourceClass, "primary" | "special" | "secondary" | "warning" | "plain"> =
  {
    systemone: "primary",
    llm: "special",
    forced: "secondary",
    external: "plain",
    other: "warning",
  };

/** Previews of System 1's moves, each from the position the reply was chosen in. */
export interface MovePreview {
  onPin: (uci: string) => void;
  /** Fine pointers only: null when the pointer leaves. */
  onHover?: (uci: string | null) => void;
  /** The move whose preview is pinned. */
  pinned: string | null;
}

interface Props {
  reply: ReplyState;
  view: TurnView;
  onViewChange: (view: TurnView) => void;
  /** The "Game so far" footer, from `accountingPrefix` and `gameSoFar`; null has none. */
  soFar?: GameSoFar | null;
  /** What an empty card says: there's no move to show yet. */
  placeholder?: string;
  title?: string;
  /** The card's accessible name. */
  label?: string;
  preview?: MovePreview;
}

type Show = keyof TurnView["show"];

const CUSTOMIZE: readonly [Show, string][] = [
  ["topMoves", "System 1's moves"],
  ["gate", "Why the LLM was called"],
  ["analysis", "Analysis"],
  ["stageStats", "Stage time and cost"],
  ["gameSoFar", "Game so far"],
  ["tokens", "Token details"],
];

/** One stage as the card draws it: the facts both a pending and a committed turn have. */
interface StageData {
  turn: TurnRecord | null;
  fenBefore: string;
  stages: Extract<Stages, { kind: "pipeline" }>;
  systemOne: SystemOneMeta | SystemOneLive | null;
  /** The committed ply; null while pending. */
  ply: Ply | null;
  analysis: string | null;
  status: "pending" | "committed";
  /** What stopped a pending turn, when the app saw it. */
  error: string | null;
}

/**
 * The agent's turn, stage by stage. From the first update that carries the real pending turn
 * through its commit, every enabled slot is reserved, so data arriving never changes the card's
 * shape: only Customize and the chevrons do. Do not make a slot conditional on the data.
 */
export function PlyDetails({
  reply,
  view,
  onViewChange,
  soFar = null,
  title = "Last Reply",
  label = "last reply",
  placeholder = "No reply yet.",
  preview,
}: Props) {
  const running = reply.status === "pending" && reply.activity === "running";
  const heading = (
    <div className="flex items-center justify-between gap-space-2">
      <Text variant="h4" as="h2" color="secondary">
        {title}
      </Text>
      <Customize view={view} onViewChange={onViewChange} />
    </div>
  );
  const footer = view.show.gameSoFar && soFar && (
    <Footer
      soFar={soFar}
      pace={
        reply.status === "played" && reply.reply.turn
          ? paceRatio(reply.reply.ply.latency_ms, soFar)
          : null
      }
    />
  );
  // A paid turn can end the game before any move, so even an empty card keeps the footer.
  if (reply.status === "none") {
    return (
      <Card intent="neutral" className="flex flex-col gap-space-3" aria-label={label}>
        {heading}
        <Text variant="sm" color="tertiary">
          {placeholder}
        </Text>
        {footer}
      </Card>
    );
  }
  return (
    <Card
      intent="neutral"
      className="flex flex-col gap-space-3"
      aria-label={label}
      aria-busy={running}
    >
      {heading}
      <Header reply={reply} />
      <Body reply={reply} view={view} onViewChange={onViewChange} preview={preview} />
      {footer}
    </Card>
  );
}

/** Two lines in every state: the move and its totals (or progress), then who played what. */
function Header({ reply }: { reply: Exclude<ReplyState, { status: "none" }> }) {
  const fenBefore = reply.status === "played" ? reply.reply.fenBefore : reply.fenBefore;
  const ply =
    reply.status === "played" ? reply.reply.ply : reply.status === "external" ? reply.ply : null;
  let right: ReactNode = null;
  if (reply.status === "played") {
    const { turn, ply: played } = reply.reply;
    right = (
      <span aria-label="turn totals">
        {seconds(played.latency_ms)} · <Cost cost={turn ? turnCost(turn.calls) : null} />
      </span>
    );
  } else if (reply.status === "pending") {
    right =
      reply.activity === "running" ? (
        <ThinkingState label="Thinking…" tone="brand" size="sm" showElapsed />
      ) : (
        "Stopped"
      );
  }
  return (
    <div className="flex flex-col gap-space-1" data-slot="header">
      <Line slot="header-move">
        <Text variant="sm" color="secondary" as="span" className="whitespace-nowrap">
          {moveHeading(fenBefore)}
        </Text>
        <span className="ml-auto text-sm whitespace-nowrap text-secondary tabular-nums">
          {right}
        </span>
      </Line>
      <Line slot="header-source">
        {ply && (
          <>
            <Badge
              color={BADGE_COLORS[sourceClass(ply.source)]}
              size="sm"
              className="whitespace-nowrap"
            >
              {sourceLabel(ply.source)}
            </Badge>
            <Text variant="md" weight="semibold" as="span" className="font-mono">
              {ply.san}
            </Text>
          </>
        )}
      </Line>
    </div>
  );
}

function Body({
  reply,
  view,
  onViewChange,
  preview,
}: {
  reply: Exclude<ReplyState, { status: "none" }>;
  view: TurnView;
  onViewChange: (view: TurnView) => void;
  preview: MovePreview | undefined;
}) {
  if (reply.status === "external") {
    return (
      <Line slot="external">
        <Text variant="sm" color="tertiary">
          {reply.label}
        </Text>
      </Line>
    );
  }
  const stages = reply.status === "played" ? reply.reply.stages : reply.stages;
  if (stages.kind === "forced") {
    return (
      <Line slot="forced">
        <Text variant="sm" color="secondary">
          Only legal move
        </Text>
      </Line>
    );
  }
  const data: StageData =
    reply.status === "played"
      ? {
          turn: reply.reply.turn,
          fenBefore: reply.reply.fenBefore,
          stages,
          systemOne: systemOneMeta(reply.reply.ply),
          ply: reply.reply.ply,
          analysis: reply.reply.ply.analysis,
          status: "committed",
          error: null,
        }
      : {
          turn: reply.turn,
          fenBefore: reply.fenBefore,
          stages,
          systemOne: reply.systemOne,
          ply: null,
          analysis: reply.analysis,
          status: "pending",
          error: reply.error,
        };
  const statuses = stageStatuses(reply);
  const stats = stageStats(data.turn, data.systemOne, data.status, stages);
  const toggle = (stage: keyof TurnView["open"]) =>
    onViewChange({ ...view, open: { ...view.open, [stage]: !view.open[stage] } });
  return (
    <div className="flex flex-col gap-space-3">
      {statuses.systemOne && (
        <Stage
          slot="systemone"
          number="①"
          name="System 1"
          model={data.systemOne?.model ?? null}
          status={statuses.systemOne}
          stat={stats.systemOne}
          view={view}
          open={view.open.systemOne}
          onToggle={() => toggle("systemOne")}
        >
          <SystemOneBody
            data={data}
            status={statuses.systemOne}
            hybrid={stages.systemOne && stages.llm}
            view={view}
            preview={preview}
          />
        </Stage>
      )}
      {statuses.llm && (
        <Stage
          slot="llm"
          number={statuses.systemOne ? "②" : "①"}
          name="LLM"
          model={llmModel(data)}
          status={statuses.llm}
          stat={stats.llm}
          view={view}
          open={view.open.llm}
          onToggle={() => toggle("llm")}
        >
          <LlmBody data={data} status={statuses.llm} summaryCost={stats.summaryCost} view={view} />
        </Stage>
      )}
    </div>
  );
}

function llmModel({ ply, turn }: StageData): string | null {
  if (ply?.source === "llm" && ply.model) return ply.model;
  return turn?.calls.find((c) => c.kind === "llm")?.model ?? null;
}

const STATUS_TEXT: Record<StageStatus, string> = {
  waiting: "Waiting",
  running: "Running",
  done: "Done",
  skipped: "Skipped",
  "not-needed": "Not needed",
  failed: "Failed",
};

function StatusMark({ status }: { status: StageStatus }) {
  switch (status) {
    case "running":
      return (
        <span role="img" aria-label="Running" className="inline-flex text-tertiary">
          <Spinner size="xs" />
        </span>
      );
    case "done":
      return (
        <span role="img" aria-label="Done" className="inline-flex text-success-primary">
          <CheckCircleIcon size={16} />
        </span>
      );
    case "failed":
      return (
        <Text variant="sm" color="error" as="span" className="inline-flex items-center gap-1">
          Failed <WarningCircleIcon size={16} aria-hidden />
        </Text>
      );
    default:
      return (
        <Text variant="sm" color="tertiary" as="span">
          {STATUS_TEXT[status]}
        </Text>
      );
  }
}

/** A stage's own time and cost: "…" while it hasn't finished, nothing when it wasn't needed. */
function StageFigures({ status, stat }: { status: StageStatus; stat: Stat }) {
  if (status === "not-needed") return null;
  const unfinished = status === "waiting" || status === "running";
  return (
    <span
      className="text-sm whitespace-nowrap text-secondary tabular-nums"
      aria-label="stage time and cost"
    >
      {unfinished ? "…" : statText(stat.modelMs, stat.cost)}
    </span>
  );
}

function Stage({
  slot,
  number,
  name,
  model,
  status,
  stat,
  view,
  open,
  onToggle,
  children,
}: {
  slot: string;
  number: string;
  name: string;
  model: string | null;
  status: StageStatus;
  stat: Stat | null;
  view: TurnView;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-space-2" aria-label={`${name} stage`}>
      <div className="flex min-h-6 items-center gap-space-2" data-slot={`stage-${slot}`}>
        <Text
          variant="sm"
          weight="semibold"
          as="span"
          className="min-w-0 truncate"
          title={model ? `${name} · ${model}` : undefined}
        >
          {number} {name}
          {model && (
            <Text variant="sm" color="secondary" as="span" weight="normal">
              {" "}
              · {model}
            </Text>
          )}
        </Text>
        <span className="ml-auto flex shrink-0 items-center gap-space-2">
          {view.show.stageStats && stat && <StageFigures status={status} stat={stat} />}
          <StatusMark status={status} />
          <IconButton
            icon={open ? CaretDownIcon : CaretRightIcon}
            label={`${open ? "Hide" : "Show"} ${name}`}
            aria-expanded={open}
            size="sm"
            variant="plain"
            color="secondary"
            className={TOUCH_TARGET}
            onClick={onToggle}
          />
        </span>
      </div>
      {view.show.tokens && stat && (
        <Line slot={`tokens-${slot}`}>
          <Text
            variant="xs"
            color="tertiary"
            className="truncate font-mono"
            aria-label="token details"
            title={tokenLine(stat.tokens)}
          >
            {tokenLine(stat.tokens)}
          </Text>
        </Line>
      )}
      {open && children}
    </section>
  );
}

function SystemOneBody({
  data,
  status,
  hybrid,
  view,
  preview,
}: {
  data: StageData;
  status: StageStatus;
  hybrid: boolean;
  view: TurnView;
  preview: MovePreview | undefined;
}) {
  const decision = data.systemOne;
  // Older games recorded only the shortlist handed to the LLM.
  const ranking = decision ? (decision.top ?? decision.shortlist) : [];
  const playedSan =
    decision?.status === "played" && ranking[0] ? sanAt(data.fenBefore, ranking[0].uci) : null;
  const gate = hybrid && decision ? gateLine(decision, playedSan) : null;
  return (
    <>
      {view.show.topMoves && (
        // Room for the caption, five moves and a played move outside them ("…" and its row).
        <div className="h-[12rem] overflow-y-auto" data-slot="top-moves">
          {status === "running" || status === "waiting" ? (
            <Loading />
          ) : status === "failed" ? (
            <Text variant="sm" color="error">
              {data.error ? `System 1 didn't finish: ${data.error}` : "System 1 didn't finish."}
            </Text>
          ) : decision?.status === "skipped" ? (
            <Text variant="sm" color="error">
              System 1 skipped: {decision.error ?? "no reason given"}
            </Text>
          ) : (
            <TopMoves
              ranking={ranking}
              fenBefore={data.fenBefore}
              played={data.ply && { uci: data.ply.uci, extra: extraOf(data.ply, ranking) }}
              preview={preview}
            />
          )}
        </div>
      )}
      {view.show.gate && hybrid && (
        // Two lines, so a narrow column still reads the whole decision.
        <div className="h-[2lh] text-sm" data-slot="gate">
          <Text variant="sm" color="secondary" className="line-clamp-2" title={gate ?? undefined}>
            {gate}
          </Text>
        </div>
      )}
    </>
  );
}

/** The played move outside the top moves, unless it never reached the final: today's rule. */
function extraOf(ply: Ply, ranking: readonly RankedMove[]): RankedMove | null {
  const played = systemOneMeta(ply)?.played_move_result?.at(-1);
  return !ranking.some((m) => m.uci === ply.uci) && played && played.heat === null && !played.bye
    ? { uci: ply.uci, probability: played.probability }
    : null;
}

function LlmBody({
  data,
  status,
  summaryCost,
  view,
}: {
  data: StageData;
  status: StageStatus;
  summaryCost: ReturnType<typeof turnCost>;
  view: TurnView;
}) {
  const ranking = data.systemOne ? (data.systemOne.top ?? data.systemOne.shortlist) : [];
  const rank =
    data.ply && data.systemOne && ranking.length > 0
      ? rankNote(ranking, data.ply.uci, data.ply.san)
      : null;
  const notes =
    status === "not-needed"
      ? null
      : llmNotes({
          error: status === "failed" ? data.error : null,
          illegalAttempts: data.turn?.illegal_attempts ?? 0,
          san: data.ply?.san ?? null,
          rank,
          summaryCost,
          summarized: data.turn?.calls.some((c) => c.kind === "summary") ?? false,
        });
  return (
    <>
      {view.show.analysis && (
        <div
          className="markdown h-80 overflow-auto rounded-md bg-surface-level-3 p-space-3"
          data-slot="analysis"
        >
          <AnalysisText status={status} text={data.analysis} />
        </div>
      )}
      <Line slot="notes">
        <Text variant="xs" color="tertiary" className="truncate" title={notes ?? undefined}>
          {notes}
        </Text>
      </Line>
    </>
  );
}

function AnalysisText({ status, text }: { status: StageStatus; text: string | null }) {
  if (status === "not-needed") return null;
  if (text) return <Analysis text={text} />;
  if (status === "running" || status === "waiting") return <Loading />;
  return (
    <Text variant="sm" color="tertiary">
      {status === "failed" ? "No analysis before it stopped." : "No analysis for this move."}
    </Text>
  );
}

function TopMoves({
  ranking,
  fenBefore,
  played,
  preview,
}: {
  ranking: readonly RankedMove[];
  fenBefore: string;
  /** The move played and the "…" row for it outside the ranking; null while pending. */
  played: { uci: string; extra: RankedMove | null } | null;
  preview: MovePreview | undefined;
}) {
  if (ranking.length === 0) {
    return (
      <Text variant="sm" color="tertiary">
        No System 1 moves.
      </Text>
    );
  }
  const bar = (move: RankedMove) => (
    <MoveBar
      key={move.uci}
      move={move}
      played={move.uci === played?.uci}
      fen={fenBefore}
      onPin={preview && (() => preview.onPin(move.uci))}
      onHover={preview?.onHover && ((over) => preview.onHover?.(over ? move.uci : null))}
      pinned={preview?.pinned === move.uci}
    />
  );
  return (
    <div className="flex flex-col gap-space-2" aria-label="system 1 moves">
      <Text variant="xs" color="tertiary">
        System 1&apos;s top moves
      </Text>
      {ranking.map(bar)}
      {played?.extra && (
        <>
          <Text variant="xs" color="tertiary" aria-hidden>
            …
          </Text>
          {bar(played.extra)}
        </>
      )}
    </div>
  );
}

function Footer({ soFar, pace }: { soFar: GameSoFar; pace: number | null }) {
  const figures = soFarLine(soFar, pace);
  const sources = sourcesLine(soFar);
  return (
    <div
      className="flex flex-col gap-space-1 border-t border-primary pt-space-2"
      aria-label="game so far"
    >
      <Line slot="footer">
        <Text variant="sm" weight="medium" as="span">
          Game so far
        </Text>
        <span className="ml-auto text-sm whitespace-nowrap text-secondary tabular-nums">
          <Cost cost={soFar.cost} />
        </span>
      </Line>
      <Line slot="footer-figures">
        <Text variant="xs" color="secondary" as="span" className="truncate" title={figures}>
          {figures}
        </Text>
      </Line>
      <Line slot="footer-sources">
        <Text variant="xs" color="tertiary" as="span" className="truncate" title={sources}>
          {sources}
        </Text>
      </Line>
    </div>
  );
}

function Customize({
  view,
  onViewChange,
}: {
  view: TurnView;
  onViewChange: (v: TurnView) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton
          icon={GearSixIcon}
          label="Customize"
          size="sm"
          variant="plain"
          color="secondary"
          className={TOUCH_TARGET}
        />
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-64 flex-col gap-space-1 p-space-2">
        {CUSTOMIZE.map(([key, name]) => (
          <div key={key} className={cn("flex items-center", TOUCH_TARGET)}>
            <Switch
              label={name}
              checked={view.show[key]}
              onChange={(on) => onViewChange({ ...view, show: { ...view.show, [key]: on } })}
            />
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}

/** A one-line slot, reserved whether or not it has anything to say. Its text must not wrap. */
function Line({ slot, children }: { slot: string; children: ReactNode }) {
  return (
    <div className="flex h-6 min-w-0 items-center gap-space-2" data-slot={slot}>
      {children}
    </div>
  );
}

function Cost({ cost }: { cost: ReturnType<typeof turnCost> }) {
  const text = costText(cost);
  return text.incomplete ? (
    <Hint
      label={`${text.text} (incomplete estimate)`}
      text="Incomplete estimate: some calls were unpriced or approximated"
      className="font-mono text-primary"
    >
      {text.text}
    </Hint>
  ) : (
    <>{text.text}</>
  );
}

function Loading() {
  return (
    <span
      role="img"
      aria-label="loading"
      className="inline-flex h-[1lh] items-center align-top text-tertiary"
    >
      <Spinner size="xs" />
    </span>
  );
}
