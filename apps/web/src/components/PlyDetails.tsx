import { Badge } from "@langchain/macaw-components/Badge";
import { Button } from "@langchain/macaw-components/Button";
import { Card } from "@langchain/macaw-components/Card";
import { ProgressBar } from "@langchain/macaw-components/ProgressBar";
import { Text } from "@langchain/macaw-components/Text";
import { Tooltip } from "@langchain/macaw-components/Tooltip";
import { useState } from "react";
import { sanAt } from "../chess";
import { costText, percent, seconds, sourceClass, sourceLabel, type SourceClass } from "../format";
import { systemOneMeta, turnCost } from "../selectors";
import type { RankedMove, SystemOneMeta } from "../types";
import type { Reply } from "../useGame";
import { Analysis } from "./Analysis";

const BADGE_COLORS: Record<SourceClass, "primary" | "special" | "secondary" | "warning" | "plain"> =
  {
    systemone: "primary",
    llm: "special",
    forced: "secondary",
    external: "plain",
    other: "warning",
  };

interface Props {
  reply: Reply | null;
  /** The opponent's reasoning as it streams, while it thinks; it replaces the last reply. */
  live?: string | null;
}

export function PlyDetails({ reply, live = null }: Props) {
  const [showReasoning, setShowReasoning] = useState(true);
  if (live !== null) {
    return (
      <Card intent="neutral" className="flex flex-col gap-space-3" aria-label="thinking">
        <Text variant="h4" as="h2" color="secondary">
          Reasoning
        </Text>
        <div className="markdown max-h-80 overflow-auto rounded-md bg-surface-level-3 p-space-3">
          <Analysis text={live} />
        </div>
      </Card>
    );
  }
  if (!reply) {
    return (
      <Card intent="neutral" className="flex flex-col gap-space-3">
        <Text variant="h4" as="h2" color="secondary">
          Last Reply
        </Text>
        <Text variant="sm" color="tertiary">
          Make a move to see how the opponent decided.
        </Text>
      </Card>
    );
  }
  const { ply, turn, fenBefore } = reply;
  const cost = costText(turn ? turnCost(turn.calls) : null);
  const reasoning = turn?.calls.reduce((sum, c) => sum + c.reasoning_tokens, 0) ?? 0;
  const illegal = turn?.illegal_attempts ?? 0;
  const s1 = systemOneMeta(ply);
  const source = sourceClass(ply.source);

  return (
    <Card intent="neutral" className="flex flex-col gap-space-3" aria-label="last reply">
      <Text variant="h4" as="h2" color="secondary">
        Last Reply
      </Text>
      <div className="flex items-center gap-space-2">
        <Badge color={BADGE_COLORS[source]} size="sm">
          {sourceLabel(ply.source)}
        </Badge>
        <Text variant="md" weight="semibold" as="span" className="font-mono">
          {ply.san}
        </Text>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-space-4 gap-y-space-1">
        <Fact label="Model" value={ply.model ?? "—"} />
        <Fact label="Latency" value={seconds(ply.latency_ms)} />
        <Fact
          label="Cost"
          value={
            cost.incomplete ? (
              <Tooltip title="Incomplete estimate: some calls were unpriced or approximated">
                <span aria-label={`${cost.text} (incomplete estimate)`}>{cost.text}</span>
              </Tooltip>
            ) : (
              cost.text
            )
          }
        />
        {reasoning > 0 && <Fact label="Reasoning Tokens" value={String(reasoning)} />}
        {illegal > 0 && <Fact label="Illegal Attempts" value={String(illegal)} />}
      </dl>
      {s1 && <SystemOne meta={s1} playedUci={ply.uci} fenBefore={fenBefore} />}
      {ply.analysis && (
        <div className="flex flex-col gap-space-2">
          <Button
            variant="plain"
            color="secondary"
            size="sm"
            className="self-start"
            onClick={() => setShowReasoning((s) => !s)}
          >
            {showReasoning ? "Hide reasoning" : "Show reasoning"}
          </Button>
          {showReasoning && (
            <div className="markdown max-h-80 overflow-auto rounded-md bg-surface-level-3 p-space-3">
              <Analysis text={ply.analysis} />
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function SystemOne({
  meta,
  playedUci,
  fenBefore,
}: {
  meta: SystemOneMeta;
  playedUci: string;
  fenBefore: string;
}) {
  if (meta.status === "skipped") {
    return (
      <Text variant="sm" color="error">
        System 1 skipped: {meta.error ?? "no reason given"}
      </Text>
    );
  }
  // Older games recorded only the shortlist handed to the LLM.
  const top = meta.top ?? meta.shortlist;
  const played = meta.played_move_result?.at(-1);
  // The move played stays visible even outside the top moves, unless it never reached the final.
  const extra: RankedMove | null =
    !top.some((m) => m.uci === playedUci) && played && played.heat === null && !played.bye
      ? { uci: playedUci, probability: played.probability }
      : null;
  if (top.length === 0) return null;
  return (
    <div className="flex flex-col gap-space-2" aria-label="system 1 moves">
      <Text variant="xs" color="tertiary">
        System 1&apos;s top moves
      </Text>
      {top.map((move) => (
        <MoveBar key={move.uci} move={move} played={move.uci === playedUci} fen={fenBefore} />
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

function MoveBar({ move, played, fen }: { move: RankedMove; played: boolean; fen: string }) {
  const san = sanAt(fen, move.uci);
  return (
    <div className="grid grid-cols-[6ch_1fr_5ch] items-center gap-space-2">
      <Text variant="sm" as="span" weight={played ? "semibold" : undefined} className="font-mono">
        {san}
      </Text>
      <ProgressBar
        value={Math.round(move.probability * 100)}
        size="sm"
        color={played ? "success" : "brand"}
        aria-label={`${san} ${played ? "(played) " : ""}probability`}
      />
      <Text variant="sm" color="tertiary" as="span" className="text-right font-mono">
        {percent(move.probability)}
      </Text>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
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
