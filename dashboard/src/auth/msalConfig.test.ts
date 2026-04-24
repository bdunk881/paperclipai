import { afterEach, describe, expect, it, vi } from "vitest";

async function loadConfig() {
  vi.resetModules();
  return import(`./msalConfig?ts=${Date.now()}`);
}

describe("msalConfig env parsing", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("falls back to the branded authority defaults when env vars are empty", async () => {
    const { msalConfig } = await loadConfig();

    expect(msalConfig.auth.clientId).toBe("2dfd3a08-277c-4893-b07d-eca5ae322310");
    expect(msalConfig.auth.authority).toBe(
      "https://auth.helloautoflow.com/5e4f1080-8afc-4005-b05e-32b21e69363a"
    );
    expect(msalConfig.auth.knownAuthorities).toEqual(["auth.helloautoflow.com"]);
  });

  it("ignores client id env overrides and keeps the pinned app registration id", async () => {
    vi.stubEnv("VITE_AZURE_CIAM_CLIENT_ID", "not-a-guid");
    vi.stubEnv("VITE_AZURE_CIAM_TENANT_SUBDOMAIN", "autoflowciam");

    const { msalConfig } = await loadConfig();

    expect(msalConfig.auth.clientId).toBe("2dfd3a08-277c-4893-b07d-eca5ae322310");
  });

  it("ignores legacy tenant env vars and keeps the branded authority default", async () => {
    vi.stubEnv("VITE_AZURE_CIAM_TENANT_SUBDOMAIN", "autoflowciam");
    vi.stubEnv("VITE_AZURE_CIAM_TENANT_DOMAIN", "autoflowciam.onmicrosoft.com");

    const { msalConfig } = await loadConfig();

    expect(msalConfig.auth.authority).toBe(
      "https://auth.helloautoflow.com/5e4f1080-8afc-4005-b05e-32b21e69363a"
    );
    expect(msalConfig.auth.knownAuthorities).toEqual(["auth.helloautoflow.com"]);
  });

  it("uses the branded tenant id env override when provided", async () => {
    vi.stubEnv("VITE_AZURE_CIAM_TENANT_ID", "11111111-2222-3333-4444-555555555555");

    const { msalConfig } = await loadConfig();

    expect(msalConfig.auth.authority).toBe(
      "https://auth.helloautoflow.com/11111111-2222-3333-4444-555555555555"
    );
    expect(msalConfig.auth.knownAuthorities).toEqual(["auth.helloautoflow.com"]);
  });

  it("uses the branded authority env override when provided", async () => {
    vi.stubEnv("VITE_AZURE_CIAM_AUTHORITY", "https://auth-staging.helloautoflow.com/");
    vi.stubEnv(
      "VITE_AZURE_CIAM_KNOWN_AUTHORITIES",
      "auth-staging.helloautoflow.com, login.contoso.com"
    );

    const { msalConfig } = await loadConfig();

    expect(msalConfig.auth.authority).toBe("https://auth-staging.helloautoflow.com");
    expect(msalConfig.auth.knownAuthorities).toEqual([
      "auth-staging.helloautoflow.com",
      "login.contoso.com",
    ]);
  });

  it("falls back when authority format is invalid", async () => {
    vi.stubEnv("VITE_AZURE_CIAM_AUTHORITY", "http://auth.helloautoflow.com");

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { msalConfig } = await loadConfig();

    expect(msalConfig.auth.authority).toBe(
      "https://auth.helloautoflow.com/5e4f1080-8afc-4005-b05e-32b21e69363a"
    );
    expect(warnSpy).toHaveBeenCalledWith(
      "[MSAL] Invalid VITE_AZURE_CIAM_AUTHORITY format. Using fallback authority."
    );
  });

  it("falls back when knownAuthorities format is invalid", async () => {
    vi.stubEnv("VITE_AZURE_CIAM_KNOWN_AUTHORITIES", "auth.helloautoflow.com,bad host");

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { msalConfig } = await loadConfig();

    expect(msalConfig.auth.knownAuthorities).toEqual(["auth.helloautoflow.com"]);
    expect(warnSpy).toHaveBeenCalledWith(
      "[MSAL] Invalid VITE_AZURE_CIAM_KNOWN_AUTHORITIES format. Using fallback knownAuthorities."
    );
  });

  it("uses the authority host as knownAuthorities fallback for custom env overrides", async () => {
    vi.stubEnv("VITE_AZURE_CIAM_AUTHORITY", "https://login.contoso.com/custom-path");

    const { msalConfig } = await loadConfig();

    expect(msalConfig.auth.authority).toBe("https://login.contoso.com/custom-path");
    expect(msalConfig.auth.knownAuthorities).toEqual(["login.contoso.com"]);
    expect(msalConfig.auth.redirectUri).toBe("http://localhost:3000/auth/callback");
  });
});
