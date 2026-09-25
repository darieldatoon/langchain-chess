import { Badge } from "@langchain/macaw-components/Badge";
import { Button } from "@langchain/macaw-components/Button";
import { Card } from "@langchain/macaw-components/Card";
import { ProgressBar } from "@langchain/macaw-components/ProgressBar";
import { Text } from "@langchain/macaw-components/Text";
import { Tooltip } from "@langchain/macaw-components/Tooltip";
import { useState } from "react";
import Markdown from "react-markdown";
import { sanAt } from "../chess";
import {
  costText,
  percent,
  seconds,
  sourceClass,
  sourceLabel,
  standingLine,
  type SourceClass,
} from "../format";
import { systemOneMeta, turnCost } from "../selectors";
import type { SystemOneMeta } from "../types";
import type { Reply } from "../useGame";

const BADGE_COLORS: Record<SourceClass, "primary" | "special" | "secondary" | "warning" | "plain"> =
  {
    systemone: "primary",
    llm: "special",
    forced: "secondary",
    external: "plain",
    other: "warning",
  };

export function PlyDetails({ reply }: { reply: Reply | null }) {
  const [showReply, setShowReply] = useState(false);
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
            onClick={() => setShowReply((s) => !s)}
          >
            {showReply ? "Hide LLM reply" : "Show LLM reply"}
          </Button>
          {showReply && (
            <div className="markdown max-h-80 overflow-auto rounded-md bg-surface-level-3 p-space-3">
              <Markdown>{ply.analysis}</Markdown>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function gateLine(meta: SystemOneMeta): string | null {
  if (meta.signal === null || meta.threshold_used === null) return null;
  const verdict =
    meta.status === "played"
      ? "System 1 played"
      : `System 1 suggested ${meta.shortlist.length}${
          meta.followed === null
            ? ""
            : meta.followed
              ? ", the LLM followed"
              : ", the LLM went its own way"
        }`;
  return `Gate: ${meta.gate} ${meta.signal.toFixed(2)} vs threshold ${meta.threshold_used.toFixed(2)}, ${verdict}.`;
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
  const gate = gateLine(meta);
  const among = meta.finalist_conditional ? " among finalists" : "";
  return (
    <div className="flex flex-col gap-space-2">
      {gate && (
        <Text variant="sm" color="tertiary">
          {gate}
        </Text>
      )}
      {meta.played_move_result && (
        <Text variant="sm" color="tertiary">
          Played move: {standingLine(meta.played_move_result, meta.finalist_conditional)}
        </Text>
      )}
      {meta.shortlist.length > 0 && (
        <div className="flex flex-col gap-space-2" aria-label="system 1 candidates">
          <Text variant="xs" color="tertiary">
            Candidates, probabilities{among}
          </Text>
          {meta.shortlist.map((c) => {
            const san = sanAt(fenBefore, c.uci);
            return (
              <div key={c.uci} className="grid grid-cols-[6ch_1fr_5ch] items-center gap-space-2">
                <Text variant="sm" as="span" className="font-mono">
                  {san}
                </Text>
                <ProgressBar
                  value={Math.round(c.probability * 100)}
                  size="sm"
                  color={c.uci === playedUci ? "success" : "brand"}
                  aria-label={`${san} probability${among}`}
                />
                <Text variant="sm" color="tertiary" as="span" className="text-right font-mono">
                  {percent(c.probability)}
                </Text>
              </div>
            );
          })}
        </div>
      )}
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
