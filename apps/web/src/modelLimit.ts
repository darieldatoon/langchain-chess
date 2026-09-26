import { isRecord } from "./settings";

/**
 * Asks the server for a model's input limit: `summarize` triggers at a fraction of it.
 * Null when the model has none, can't be built, or the server can't be reached.
 */
export async function fetchModelLimit(
  apiUrl: string,
  apiKey: string,
  model: string,
  fetcher: typeof fetch = fetch,
): Promise<number | null> {
  try {
    const response = await fetcher(
      `${apiUrl}/ui/model-limit?${new URLSearchParams({ model }).toString()}`,
      { headers: apiKey ? { "x-api-key": apiKey } : {} },
    );
    if (!response.ok) return null;
    const body: unknown = await response.json();
    return isRecord(body) && typeof body.max_input_tokens === "number"
      ? body.max_input_tokens
      : null;
  } catch {
    return null;
  }
}
