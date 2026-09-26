import { isRecord } from "./settings";

/** `none`: the model has no known limit or can't be built. `failed` says nothing about the model. */
export type ModelLimit = { kind: "known"; tokens: number } | { kind: "none" } | { kind: "failed" };

const NONE: ModelLimit = { kind: "none" };
const FAILED: ModelLimit = { kind: "failed" };

/** Asks the server for a model's input limit: `summarize` triggers at a fraction of it. */
export async function fetchModelLimit(
  apiUrl: string,
  apiKey: string,
  model: string,
  fetcher: typeof fetch = fetch,
): Promise<ModelLimit> {
  try {
    const response = await fetcher(
      `${apiUrl}/ui/model-limit?${new URLSearchParams({ model }).toString()}`,
      { headers: apiKey ? { "x-api-key": apiKey } : {} },
    );
    if (!response.ok) return FAILED;
    const body: unknown = await response.json();
    if (!isRecord(body)) return FAILED;
    const tokens = body.max_input_tokens;
    if (tokens === null) return NONE;
    return typeof tokens === "number" ? { kind: "known", tokens } : FAILED;
  } catch {
    return FAILED;
  }
}
