import Markdown from "react-markdown";
import { money, seconds, sourceClass, sourceLabel } from "../format";
import type { PlayContext, PlyView } from "../types";

export function PlyDetails({ ply, context }: { ply: PlyView | null; context: PlayContext }) {
  if (!ply) {
    return (
      <section className="card">
        <h2>Last reply</h2>
        <p className="muted">Make a move to see how the opponent decided.</p>
      </section>
    );
  }
  const gate = ply[context.gate === "margin" ? "jev_margin" : "jev_confidence"];
  const showGate = context.policy === "hybrid" && gate != null;
  return (
    <section className="card" aria-label="last reply">
      <h2>Last reply</h2>
      <div>
        <span className={`badge ${sourceClass(ply.source)}`}>{sourceLabel(ply.source)}</span>{" "}
        <strong className="mono">{ply.san}</strong>
      </div>
      <dl className="facts">
        <dt>Model</dt>
        <dd>{ply.model}</dd>
        <dt>Latency</dt>
        <dd>{seconds(ply.latency_ms)}</dd>
        <dt>Cost</dt>
        <dd>{money(ply.cost_usd)}</dd>
        {(ply.reasoning_tokens ?? 0) > 0 && (
          <>
            <dt>Reasoning tokens</dt>
            <dd>{ply.reasoning_tokens}</dd>
          </>
        )}
        {(ply.illegal_attempts ?? 0) > 0 && (
          <>
            <dt>Illegal attempts</dt>
            <dd>{ply.illegal_attempts}</dd>
          </>
        )}
      </dl>
      {showGate && (
        <p className="gate">
          Gate: {context.gate} {gate.toFixed(2)} vs threshold {context.threshold.toFixed(2)},{" "}
          {ply.escalated ? "escalated to the LLM" : "Jev was sure enough"}.
        </p>
      )}
      {ply.jev_top && ply.jev_top.length > 0 && (
        <div className="bars" aria-label="jev candidates">
          {ply.jev_top.map((c) => (
            <div key={c.uci} className={`bar ${c.uci === ply.uci ? "played" : ""}`}>
              <span>{c.san}</span>
              <span className="track">
                <span className="fill" style={{ width: `${Math.round(c.probability * 100)}%` }} />
              </span>
              <span className="pct">{(c.probability * 100).toFixed(0)}%</span>
            </div>
          ))}
        </div>
      )}
      {ply.raw_reply && (
        <details className="reply">
          <summary>LLM reply</summary>
          <div className="markdown">
            <Markdown>{ply.raw_reply}</Markdown>
          </div>
        </details>
      )}
    </section>
  );
}
