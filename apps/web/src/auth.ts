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
      return {
        title: "LangSmith API key needed",
        body:
          "Only members of this deployment's LangSmith workspace can play here, with a key from " +
          "that workspace. Anyone can run their own copy: see " +
          "https://github.com/darieldatoon/langchain-chess.",
      };
    case "rejected":
      return {
        title: "API key rejected",
        body:
          "The server refused this key. It takes keys from its own LangSmith workspace only; " +
          "check the key in Settings.",
      };
    case "unreachable":
      return { title: "Server unreachable", body: check.message };
  }
}
