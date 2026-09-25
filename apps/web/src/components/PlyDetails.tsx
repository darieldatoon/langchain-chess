import { Badge } from "@langchain/macaw-components/Badge";
import { Button } from "@langchain/macaw-components/Button";
import { Card } from "@langchain/macaw-components/Card";
import { ProgressBar } from "@langchain/macaw-components/ProgressBar";
import { Text } from "@langchain/macaw-components/Text";
import { useState } from "react";
import Markdown from "react-markdown";
import { money, seconds, sourceClass, sourceLabel } from "../format";
import type { PlayContext, PlyView } from "../types";

const BADGE_COLORS: Record<string, "primary" | "special" | "error" | "plain"> = {
  jev: "primary",
  llm: "special",
  fallback: "error",
};

export function PlyDetails({ ply, context }: { ply: PlyView | null; context: PlayContext }) {
  const [showReply, setShowReply] = useState(false);
  if (!ply) {
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
  const gate = ply[context.gate === "margin" ? "jev_margin" : "jev_confidence"];
  const showGate = context.policy === "hybrid" && gate != null;
  return (
    <Card intent="neutral" className="flex flex-col gap-space-3" aria-label="last reply">
      <Text variant="h4" as="h2" color="secondary">
        Last Reply
      </Text>
      <div className="flex items-center gap-space-2">
        <Badge color={BADGE_COLORS[sourceClass(ply.source)] ?? "plain"} size="sm">
          {sourceLabel(ply.source)}
        </Badge>
        <Text variant="md" weight="semibold" as="span" className="font-mono">
          {ply.san}
        </Text>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-space-4 gap-y-space-1">
        <Fact label="Model" value={ply.model} />
        <Fact label="Latency" value={seconds(ply.latency_ms)} />
        <Fact label="Cost" value={money(ply.cost_usd)} />
        {(ply.reasoning_tokens ?? 0) > 0 && (
          <Fact label="Reasoning Tokens" value={String(ply.reasoning_tokens)} />
        )}
        {(ply.illegal_attempts ?? 0) > 0 && (
          <Fact label="Illegal Attempts" value={String(ply.illegal_attempts)} />
        )}
      </dl>
      {showGate && (
        <Text variant="sm" color="tertiary">
          Gate: {context.gate} {gate.toFixed(2)} vs threshold {context.threshold.toFixed(2)},{" "}
          {ply.escalated ? "escalated to the LLM" : "Jev was sure enough"}.
        </Text>
      )}
      {ply.jev_top && ply.jev_top.length > 0 && (
        <div className="flex flex-col gap-space-2" aria-label="jev candidates">
          {ply.jev_top.map((c) => (
            <div key={c.uci} className="grid grid-cols-[5ch_1fr_5ch] items-center gap-space-2">
              <Text variant="sm" as="span" className="font-mono">
                {c.san}
              </Text>
              <ProgressBar
                value={Math.round(c.probability * 100)}
                size="sm"
                color={c.uci === ply.uci ? "success" : "brand"}
                aria-label={`${c.san} probability`}
              />
              <Text variant="sm" color="tertiary" as="span" className="text-right font-mono">
                {(c.probability * 100).toFixed(0)}%
              </Text>
            </div>
          ))}
        </div>
      )}
      {ply.raw_reply && (
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
              <Markdown>{ply.raw_reply}</Markdown>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
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
