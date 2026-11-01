import { Client } from "@langchain/langgraph-sdk";

/** How this tab reaches the server. */
export type Session =
  /** The server takes no credential: `langgraph dev`, or a local server serving the UI. */
  | { readonly kind: "none" }
  /** A LangSmith API key from the deployment's workspace, kept in this tab only. */
  | { readonly kind: "apiKey"; readonly apiKey: string }
  /** Signed in with LangSmith. Access tokens last five minutes: ask for one per request. */
  | {
      readonly kind: "oauth";
      readonly email: string | null;
      readonly accessToken: () => Promise<string>;
    };

export const NO_SESSION: Session = { kind: "none" };

export async function sessionHeaders(session: Session): Promise<Record<string, string>> {
  switch (session.kind) {
    case "none":
      return {};
    case "apiKey":
      return { "x-api-key": session.apiKey };
    case "oauth":
      return { Authorization: `Bearer ${await session.accessToken()}` };
  }
}

export function withHeaders(
  init: RequestInit | undefined,
  extra: Record<string, string>,
): RequestInit {
  const headers = new Headers(init?.headers);
  for (const [name, value] of Object.entries(extra)) headers.set(name, value);
  return { ...init, headers };
}

/** An SDK client that adds the session's credentials, fresh, to every request and stream. */
export function sessionClient(apiUrl: string, session: Session): Client {
  return new Client({
    apiUrl,
    // Null, not undefined: undefined makes the SDK look for a key in the environment.
    apiKey: null,
    onRequest: async (_url, init) => withHeaders(init, await sessionHeaders(session)),
  });
}
