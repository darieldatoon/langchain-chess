import { sessionHeaders, type Session } from "./auth/session";
import { isRecord } from "./settings";

/** What the server knows about a model. `failed` says nothing about the model. */
export type ModelFacts =
  | {
      kind: "known";
      /** Null: the model has no known limit or can't be built. */
      maxInputTokens: number | null;
      /** False only for a model known to take no reasoning effort. */
      takesEffort: boolean;
    }
  | { kind: "failed" };

const FAILED: ModelFacts = { kind: "failed" };

/**
 * Asks the server about a model: `summarize` triggers at a fraction of its input limit, and a
 * model that takes no reasoning effort must be sent none.
 */
export async function fetchModelFacts(
  apiUrl: string,
  session: Session,
  model: string,
  fetcher: typeof fetch = fetch,
): Promise<ModelFacts> {
  try {
    const response = await fetcher(
      `${apiUrl}/ui/model?${new URLSearchParams({ model }).toString()}`,
      { headers: await sessionHeaders(session) },
    );
    if (!response.ok) return FAILED;
    const body: unknown = await response.json();
    if (!isRecord(body)) return FAILED;
    const { max_input_tokens: tokens, takes_effort: takesEffort } = body;
    if (tokens !== null && typeof tokens !== "number") return FAILED;
    if (typeof takesEffort !== "boolean") return FAILED;
    return { kind: "known", maxInputTokens: tokens, takesEffort };
  } catch {
    return FAILED;
  }
}
