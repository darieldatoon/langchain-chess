import { useState } from "react";
import type { Settings } from "../settings";
import type { PlayContext } from "../types";

interface Props {
  settings: Settings;
  onSave: (settings: Settings) => void;
  onClose: () => void;
}

const MODELS = ["claude-opus-5", "gpt-5.6-sol"];

export function SettingsPanel({ settings, onSave, onClose }: Props) {
  const [apiKey, setApiKey] = useState(settings.apiKey);
  const [ctx, setCtx] = useState<PlayContext>(settings.context);
  const set = <K extends keyof PlayContext>(key: K, value: PlayContext[K]) =>
    setCtx((c) => ({ ...c, [key]: value }));
  const usesLlm = ctx.policy === "llm" || ctx.policy === "hybrid";
  const usesJev = ctx.policy === "jev" || ctx.policy === "hybrid";

  return (
    <div className="settings-backdrop" onClick={onClose} data-testid="backdrop">
      <aside
        className="settings"
        role="dialog"
        aria-label="Settings"
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <h2>Settings</h2>
          <button type="button" onClick={onClose} aria-label="Close settings">
            ×
          </button>
        </header>

        <h3>Connection</h3>
        <div className="field">
          <label htmlFor="api-key">LangSmith API key</label>
          <input
            id="api-key"
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="lsv2_…"
          />
          <span className="hint">Stored in this browser only. Not needed for `langgraph dev`.</span>
        </div>

        <h3>Game</h3>
        <div className="field">
          <label htmlFor="policy">Opponent</label>
          <select
            id="policy"
            value={ctx.policy}
            onChange={(e) => set("policy", e.target.value as PlayContext["policy"])}
          >
            <option value="hybrid">Hybrid: Jev, then LLM when unsure</option>
            <option value="jev">Jev only (System 1)</option>
            <option value="llm">LLM only (System 2)</option>
            <option value="random">Random mover</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="side">You play</label>
          <select
            id="side"
            value={ctx.human_side}
            onChange={(e) => set("human_side", e.target.value as PlayContext["human_side"])}
          >
            <option value="white">White</option>
            <option value="black">Black</option>
          </select>
          <span className="hint">Applies to the next new game.</span>
        </div>

        {usesLlm && (
          <>
            <h3>LLM</h3>
            <div className="field">
              <label htmlFor="model">Model</label>
              <input
                id="model"
                list="models"
                value={ctx.model}
                onChange={(e) => set("model", e.target.value)}
              />
              <datalist id="models">
                {MODELS.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
              <span className="hint">
                Bare names go through the LLM Gateway; `openai:gpt-5.6-sol` goes direct.
              </span>
            </div>
            <div className="field">
              <label htmlFor="effort">Reasoning effort</label>
              <select
                id="effort"
                value={ctx.reasoning_effort}
                onChange={(e) =>
                  set("reasoning_effort", e.target.value as PlayContext["reasoning_effort"])
                }
              >
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
              </select>
            </div>
            {ctx.policy === "llm" && (
              <div className="field inline">
                <input
                  id="legal"
                  type="checkbox"
                  checked={ctx.include_legal_moves}
                  onChange={(e) => set("include_legal_moves", e.target.checked)}
                />
                <label htmlFor="legal">List legal moves in the prompt</label>
              </div>
            )}
          </>
        )}

        {usesJev && (
          <>
            <h3>Jev</h3>
            <div className="field">
              <label htmlFor="style">Move descriptions</label>
              <select
                id="style"
                value={ctx.style}
                onChange={(e) => set("style", e.target.value as PlayContext["style"])}
              >
                <option value="rich">rich</option>
                <option value="terse">terse</option>
              </select>
            </div>
            <div className="field inline">
              <input
                id="eval"
                type="checkbox"
                checked={ctx.with_eval}
                onChange={(e) => set("with_eval", e.target.checked)}
              />
              <label htmlFor="eval">Ask for a position Score</label>
            </div>
            <div className="field inline">
              <input
                id="nouls"
                type="checkbox"
                checked={ctx.with_nouls}
                onChange={(e) => set("with_nouls", e.target.checked)}
              />
              <label htmlFor="nouls">Ask the Noul questions</label>
            </div>
          </>
        )}

        {ctx.policy === "hybrid" && (
          <>
            <h3>Gate</h3>
            <div className="field">
              <label htmlFor="threshold">Threshold</label>
              <div className="range">
                <input
                  id="threshold"
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={ctx.threshold}
                  onChange={(e) => set("threshold", Number(e.target.value))}
                />
                <output>{ctx.threshold.toFixed(2)}</output>
              </div>
              <span className="hint">0 is Jev alone, 1 hands every move to the LLM.</span>
            </div>
            <div className="field">
              <label htmlFor="gate">Signal</label>
              <select
                id="gate"
                value={ctx.gate}
                onChange={(e) => set("gate", e.target.value as PlayContext["gate"])}
              >
                <option value="margin">margin (top-1 minus top-2)</option>
                <option value="confidence">Choice confidence</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="k">Shortlist size</label>
              <input
                id="k"
                type="number"
                min={1}
                max={20}
                value={ctx.k}
                onChange={(e) => set("k", Number(e.target.value))}
              />
            </div>
          </>
        )}

        <div className="actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => onSave({ apiKey: apiKey.trim(), context: ctx })}
          >
            Save
          </button>
        </div>
      </aside>
    </div>
  );
}
