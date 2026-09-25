export type KeyCheck =
  | { kind: "ok" }
  | { kind: "missing" }
  | { kind: "rejected" }
  | { kind: "unreachable"; message: string };

const AUTH_STATUSES = new Set([401, 403]);

/**
 * Asks the server whether it accepts `apiKey`, with the cheapest authenticated call there is.
 * `langgraph dev` accepts anything, so an empty key is only "missing" when the server says so.
 */
export async function checkApiKey(
  apiUrl: string,
  apiKey: string,
  fetcher: typeof fetch = fetch,
): Promise<KeyCheck> {
  let response: Response;
  try {
    response = await fetcher(`${apiUrl}/assistants/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(apiKey ? { "x-api-key": apiKey } : {}) },
      body: JSON.stringify({ limit: 1 }),
    });
  } catch (error) {
    return { kind: "unreachable", message: error instanceof Error ? error.message : String(error) };
  }
  if (!AUTH_STATUSES.has(response.status)) return { kind: "ok" };
  return apiKey ? { kind: "rejected" } : { kind: "missing" };
}

export function keyCheckMessage(check: Exclude<KeyCheck, { kind: "ok" }>): {
  title: string;
  body: string;
} {
  switch (check.kind) {
    case "missing":
      return { title: "LangSmith API key needed", body: "This server needs an API key to play." };
    case "rejected":
      return {
        title: "API key rejected",
        body: "The server refused this key. Check it in Settings.",
      };
    case "unreachable":
      return { title: "Server unreachable", body: check.message };
  }
}
