import { sessionHeaders, type Session } from "./session";

export type KeyCheck =
  | { kind: "ok" }
  | { kind: "missing" }
  /** `detail` is the server's own reason, when it gave one. */
  | { kind: "rejected"; detail: string | null }
  | { kind: "unreachable"; message: string };

const AUTH_STATUSES = new Set([401, 403]);

async function detailOf(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { detail?: unknown };
    return typeof body.detail === "string" && body.detail ? body.detail : null;
  } catch {
    return null;
  }
}

/**
 * Asks the server whether it accepts the session, with the cheapest authenticated call there is.
 * `langgraph dev` accepts no credentials, so none are only "missing" when the server says so.
 */
export async function checkAccess(
  apiUrl: string,
  session: Session,
  fetcher: typeof fetch = fetch,
): Promise<KeyCheck> {
  let response: Response;
  try {
    response = await fetcher(`${apiUrl}/assistants/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await sessionHeaders(session)) },
      body: JSON.stringify({ limit: 1 }),
    });
  } catch (error) {
    return { kind: "unreachable", message: error instanceof Error ? error.message : String(error) };
  }
  if (!AUTH_STATUSES.has(response.status)) return { kind: "ok" };
  if (session.kind === "none") return { kind: "missing" };
  return { kind: "rejected", detail: await detailOf(response) };
}

export function keyCheckMessage(check: Exclude<KeyCheck, { kind: "ok" }>): {
  title: string;
  body: string;
} {
  switch (check.kind) {
    case "missing":
      return {
        title: "Sign-in needed",
        body:
          "Only members of this deployment's LangSmith organization can play here. Anyone can " +
          "run their own copy: see https://github.com/darieldatoon/langchain-chess.",
      };
    case "rejected":
      return {
        title: "Sign-in refused",
        body:
          (check.detail ? `${check.detail} ` : "The server refused your sign-in. ") +
          "Sign out in Settings and sign in again.",
      };
    case "unreachable":
      return { title: "Server unreachable", body: check.message };
  }
}
