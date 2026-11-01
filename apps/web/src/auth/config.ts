/** The "Sign in with LangSmith" OAuth app, and the org whose members the server admits. */
export interface LangSmithApp {
  readonly clientId: string;
  readonly organizationId: string;
  /** The org's SSO login (`/sso/login/<slug>`); null when it has none. */
  readonly ssoSlug: string | null;
}

export type LangSmithAppConfig =
  /** A null app offers only API keys. */
  | { readonly ok: true; readonly app: LangSmithApp | null }
  | { readonly ok: false; readonly problem: string };

type Env = Record<string, string | boolean | undefined>;

const text = (env: Env, name: string) => {
  const value = env[name];
  return typeof value === "string" ? value.trim() : "";
};

/** Build variables, set in the Pages workflow and `.env.development.local`. */
export function langsmithAppConfig(env: Env = import.meta.env): LangSmithAppConfig {
  const clientId = text(env, "VITE_OAUTH_CLIENT_ID");
  const organizationId = text(env, "VITE_LANGSMITH_ORGANIZATION_ID");
  if (!clientId) return { ok: true, app: null };
  if (!organizationId) {
    return {
      ok: false,
      problem: "VITE_OAUTH_CLIENT_ID is set without VITE_LANGSMITH_ORGANIZATION_ID.",
    };
  }
  const ssoSlug = text(env, "VITE_LANGSMITH_SSO_SLUG") || null;
  return { ok: true, app: { clientId, organizationId, ssoSlug } };
}
