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

  it("falls back to built-in defaults when env vars are empty", async () => {
    vi.stubEnv("VITE_AZURE_CIAM_CLIENT_ID", "");
    vi.stubEnv("VITE_AZURE_CIAM_TENANT_SUBDOMAIN", "   ");

    const { msalConfig } = await loadConfig();

    expect(msalConfig.auth.clientId).toBe("2dfd3a08-277c-4893-b07d-eca5ae322310");
    expect(msalConfig.auth.authority).toBe(
      "https://autoflowciam.ciamlogin.com/autoflowciam.onmicrosoft.com"
    );
  });

  it("ignores client id env overrides and keeps the built-in app registration", async () => {
    vi.stubEnv("VITE_AZURE_CIAM_CLIENT_ID", "not-a-guid");
    vi.stubEnv("VITE_AZURE_CIAM_TENANT_SUBDOMAIN", "autoflowciam");

    const { msalConfig } = await loadConfig();

    expect(msalConfig.auth.clientId).toBe("2dfd3a08-277c-4893-b07d-eca5ae322310");
  });

  it("falls back to the default tenant subdomain when it is missing", async () => {
    vi.stubEnv("VITE_AZURE_CIAM_CLIENT_ID", "2dfd3a08-277c-4893-b07d-eca5ae322310");
    vi.stubEnv("VITE_AZURE_CIAM_TENANT_SUBDOMAIN", "");

    const { msalConfig } = await loadConfig();

    expect(msalConfig.auth.authority).toBe(
      "https://autoflowciam.ciamlogin.com/autoflowciam.onmicrosoft.com"
    );
  });

  it("warns and falls back when tenant subdomain format is invalid", async () => {
    vi.stubEnv("VITE_AZURE_CIAM_CLIENT_ID", "2dfd3a08-277c-4893-b07d-eca5ae322310");
    vi.stubEnv("VITE_AZURE_CIAM_TENANT_SUBDOMAIN", "bad subdomain");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { msalConfig } = await loadConfig();

    expect(warnSpy).toHaveBeenCalledWith(
      "[MSAL] Invalid VITE_AZURE_CIAM_TENANT_SUBDOMAIN format. Using built-in CIAM default."
    );
    expect(msalConfig.auth.authority).toBe(
      "https://autoflowciam.ciamlogin.com/autoflowciam.onmicrosoft.com"
    );
  });

  it("warns and falls back when tenant domain format is invalid", async () => {
    vi.stubEnv("VITE_AZURE_CIAM_CLIENT_ID", "2dfd3a08-277c-4893-b07d-eca5ae322310");
    vi.stubEnv("VITE_AZURE_CIAM_TENANT_SUBDOMAIN", "autoflowciam");
    vi.stubEnv("VITE_AZURE_CIAM_TENANT_DOMAIN", "https://tenant.onmicrosoft.com");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { msalConfig } = await loadConfig();

    expect(warnSpy).toHaveBeenCalledWith(
      "[MSAL] Invalid VITE_AZURE_CIAM_TENANT_DOMAIN format. Using derived CIAM domain."
    );
    expect(msalConfig.auth.authority).toBe(
      "https://autoflowciam.ciamlogin.com/autoflowciam.onmicrosoft.com"
    );
  });

  it("uses valid env values when provided", async () => {
    vi.stubEnv("VITE_AZURE_CIAM_CLIENT_ID", "2dfd3a08-277c-4893-b07d-eca5ae322310");
    vi.stubEnv("VITE_AZURE_CIAM_TENANT_SUBDOMAIN", "MyTenant01");
    vi.stubEnv("VITE_AZURE_CIAM_TENANT_DOMAIN", "mytenant01.onmicrosoft.com");

    const { msalConfig } = await loadConfig();

    expect(msalConfig.auth.clientId).toBe("2dfd3a08-277c-4893-b07d-eca5ae322310");
    expect(msalConfig.auth.authority).toBe(
      "https://mytenant01.ciamlogin.com/mytenant01.onmicrosoft.com"
    );
    expect(msalConfig.auth.knownAuthorities).toEqual(["mytenant01.ciamlogin.com"]);
  });
});
