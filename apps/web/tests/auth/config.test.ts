import { describe, expect, it } from "vite-plus/test";
import { langsmithAppConfig } from "../../src/auth/config";

describe("langsmithAppConfig", () => {
  it("offers API keys only without a client id", () => {
    expect(langsmithAppConfig({})).toEqual({ ok: true, app: null });
    expect(langsmithAppConfig({ VITE_OAUTH_CLIENT_ID: "  ", DEV: true })).toEqual({
      ok: true,
      app: null,
    });
  });

  it("reads the app, trimmed, with SSO only when its slug is set", () => {
    const env = { VITE_OAUTH_CLIENT_ID: " lsc_x ", VITE_LANGSMITH_ORGANIZATION_ID: "org-1 " };
    expect(langsmithAppConfig(env)).toEqual({
      ok: true,
      app: { clientId: "lsc_x", organizationId: "org-1", ssoSlug: null },
    });
    expect(langsmithAppConfig({ ...env, VITE_LANGSMITH_SSO_SLUG: "acme" })).toMatchObject({
      app: { ssoSlug: "acme" },
    });
  });

  it("refuses a client id without the org it admits", () => {
    expect(langsmithAppConfig({ VITE_OAUTH_CLIENT_ID: "lsc_x" })).toEqual({
      ok: false,
      problem: "VITE_OAUTH_CLIENT_ID is set without VITE_LANGSMITH_ORGANIZATION_ID.",
    });
  });

  it("reads the build's own variables by default", () => {
    expect(langsmithAppConfig().ok).toBe(true);
  });
});
