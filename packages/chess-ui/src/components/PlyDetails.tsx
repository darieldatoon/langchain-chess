import { Badge } from "@langchain/macaw-components/Badge";
import { Button } from "@langchain/macaw-components/Button";
import { Card } from "@langchain/macaw-components/Card";
import { Spinner, SpinnerIcon } from "@langchain/macaw-components/Spinner";
import { Text } from "@langchain/macaw-components/Text";
import { Tooltip } from "@langchain/macaw-components/Tooltip";
import type { ReactNode } from "react";
import {
  clockText,
  costText,
  seconds,
  sourceClass,
  sourceLabel,
  type SourceClass,
} from "../format";
import { systemOneMeta, turnCost } from "../selectors";
import type { PlyView, RankedMove, Reply, ReplyState } from "../types";
import { Analysis } from "./Analysis";
import { MoveBar } from "./MoveBar";

const BADGE_COLORS: Record<SourceClass, "primary" | "special" | "secondary" | "warning" | "plain"> =
  {
    systemone: "primary",
    llm: "special",
    forced: "secondary",
    external: "plain",
    other: "warning",
  };

interface Props {
  reply: ReplyState;
  view: PlyView;
  onViewChange: (view: PlyView) => void;
  title?: string;
  /** A timed game: every card has a Clock row, the mover's time after the move. */
  timed?: boolean;
}

/**
 * Every section and fact row renders in every state, so the card keeps its shape between moves;
 * do not make one conditional on the ply.
 */
export function PlyDetails({
  reply,
  view,
  onViewChange,
  title = "Last Reply",
  timed = false,
}: Props) {
  if (reply.status === "none") {
    return (
      <Card intent="neutral" className="flex flex-col gap-space-3">
        <Text variant="h4" as="h2" color="secondary">
          {title}
        </Text>
        <Text variant="sm" color="tertiary">
          Make a move to see how the opponent decided.
        </Text>
      </Card>
    );
  }
  const played = reply.status === "played" ? reply.reply : null;
  const thinking = played === null;

  return (
    <Card
      intent="neutral"
      className="flex flex-col gap-space-3"
      aria-label="last reply"
      aria-busy={thinking}
    >
      <Text variant="h4" as="h2" color="secondary">
        {title}
      </Text>
      <div className="flex min-h-6 items-center gap-space-2">
        {played ? (
          <>
            <Badge color={BADGE_COLORS[sourceClass(played.ply.source)]} size="sm">
              {sourceLabel(played.ply.source)}
            </Badge>
            <Text variant="md" weight="semibold" as="span" className="font-mono">
              {played.ply.san}
            </Text>
          </>
        ) : (
          <Loading />
        )}
      </div>
      <Facts reply={played} timed={timed} />
      <Section
        label="top moves"
        open={view.topMoves}
        loading={thinking}
        onToggle={() => onViewChange({ ...view, topMoves: !view.topMoves })}
      >
        {/* Room for the caption and five moves, k's default, so a spinner holds the height. */}
        <div className="min-h-[9rem]">{played ? <TopMoves reply={played} /> : <Loading />}</div>
      </Section>
      <Section
        label="reasoning"
        open={view.reasoning}
        loading={thinking}
        onToggle={() => onViewChange({ ...view, reasoning: !view.reasoning })}
      >
        <div className="markdown h-80 overflow-auto rounded-md bg-surface-level-3 p-space-3">
          <Reasoning
            text={reply.status === "played" ? reply.reply.ply.analysis : reply.reasoning}
            thinking={thinking}
          />
        </div>
      </Section>
    </Card>
  );
}

function Reasoning({ text, thinking }: { text: string | null; thinking: boolean }) {
  if (text) return <Analysis text={text} />;
  if (thinking) return <Loading />;
  return (
    <Text variant="sm" color="tertiary">
      No reasoning for this move.
    </Text>
  );
}

/** A Show/Hide toggle over its body; hidden, the toggle spins while the body is loading. */
function Section({
  label,
  open,
  loading,
  onToggle,
  children,
}: {
  label: string;
  open: boolean;
  loading: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-space-2">
      <Button
        variant="plain"
        color="secondary"
        size="sm"
        className="self-start"
        aria-expanded={open}
        rightDecorator={loading && !open ? SpinnerIcon : undefined}
        onClick={onToggle}
      >
        {open ? `Hide ${label}` : `Show ${label}`}
      </Button>
      {open && children}
    </div>
  );
}

/** The fact rows, each a spinner until the move lands. */
function Facts({ reply, timed }: { reply: Reply | null; timed: boolean }) {
  const turn = reply?.turn ?? null;
  const cost = costText(turn ? turnCost(turn.calls) : null);
  const value = (fact: (reply: Reply) => ReactNode) => (reply ? fact(reply) : <Loading />);
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-space-4 gap-y-space-1">
      <Fact label="Model" value={value(({ ply }) => ply.model ?? "—")} />
      <Fact label="Latency" value={value(({ ply }) => seconds(ply.latency_ms))} />
      {timed && (
        <Fact
          label="Clock"
          value={value(({ ply }) =>
            typeof ply.clock_ms === "number" ? clockText(ply.clock_ms) : "—",
          )}
        />
      )}
      <Fact
        label="Cost"
        value={value(() =>
          cost.incomplete ? (
            <Tooltip title="Incomplete estimate: some calls were unpriced or approximated">
              <span aria-label={`${cost.text} (incomplete estimate)`}>{cost.text}</span>
            </Tooltip>
          ) : (
            cost.text
          ),
        )}
      />
      <Fact
        label="Reasoning Tokens"
        value={value(() =>
          turn ? String(turn.calls.reduce((sum, c) => sum + c.reasoning_tokens, 0)) : "—",
        )}
      />
      <Fact
        label="Illegal Attempts"
        value={value(() => (turn ? String(turn.illegal_attempts) : "—"))}
      />
    </dl>
  );
}

function TopMoves({ reply: { ply, fenBefore } }: { reply: Reply }) {
  const meta = systemOneMeta(ply);
  if (meta?.status === "skipped") {
    return (
      <Text variant="sm" color="error">
        System 1 skipped: {meta.error ?? "no reason given"}
      </Text>
    );
  }
  // Older games recorded only the shortlist handed to the LLM.
  const top = meta ? (meta.top ?? meta.shortlist) : [];
  if (top.length === 0) {
    return (
      <Text variant="sm" color="tertiary">
        No System 1 moves.
      </Text>
    );
  }
  const played = meta?.played_move_result?.at(-1);
  // The move played stays visible even outside the top moves, unless it never reached the final.
  const extra: RankedMove | null =
    !top.some((m) => m.uci === ply.uci) && played && played.heat === null && !played.bye
      ? { uci: ply.uci, probability: played.probability }
      : null;
  return (
    <div className="flex flex-col gap-space-2" aria-label="system 1 moves">
      <Text variant="xs" color="tertiary">
        System 1&apos;s top moves
      </Text>
      {top.map((move) => (
        <MoveBar key={move.uci} move={move} played={move.uci === ply.uci} fen={fenBefore} />
      ))}
      {extra && (
        <>
          <Text variant="xs" color="tertiary" aria-hidden>
            …
          </Text>
          <MoveBar move={extra} played fen={fenBefore} />
        </>
      )}
    </div>
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

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <>
      <Text variant="sm" color="secondary" as="span">
        {label}
      </Text>
      <Text variant="sm" as="span" className="font-mono">
        {value}
      </Text>
    </>
  );
}
