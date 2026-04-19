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
    vi.stubEnv("VITE_AZURE_CLIENT_ID", "   ");
    vi.stubEnv("VITE_AZURE_TENANT_SUBDOMAIN", "");

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { msalConfig } = await loadConfig();

    expect(msalConfig.auth.clientId).toBe("2dfd3a08-277c-4893-b07d-eca5ae322310");
    expect(msalConfig.auth.authority).toBe(
      "https://autoflowciam.ciamlogin.com/autoflowciam.onmicrosoft.com"
    );
    expect(msalConfig.auth.knownAuthorities).toEqual(["autoflowciam.ciamlogin.com"]);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("falls back when tenant subdomain format is invalid", async () => {
    vi.stubEnv("VITE_AZURE_CLIENT_ID", "2dfd3a08-277c-4893-b07d-eca5ae322310");
    vi.stubEnv("VITE_AZURE_TENANT_SUBDOMAIN", "bad subdomain");

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { msalConfig } = await loadConfig();

    expect(msalConfig.auth.authority).toBe(
      "https://autoflowciam.ciamlogin.com/autoflowciam.onmicrosoft.com"
    );
    expect(warnSpy).toHaveBeenCalledWith(
      "[MSAL] Invalid VITE_AZURE_TENANT_SUBDOMAIN format. Using built-in CIAM default."
    );
  });

  it("uses valid env values when provided", async () => {
    vi.stubEnv("VITE_AZURE_CLIENT_ID", "11111111-2222-4333-8444-555555555555");
    vi.stubEnv("VITE_AZURE_TENANT_SUBDOMAIN", "MyTenant01");

    const { msalConfig } = await loadConfig();

    expect(msalConfig.auth.clientId).toBe("11111111-2222-4333-8444-555555555555");
    expect(msalConfig.auth.authority).toBe(
      "https://mytenant01.ciamlogin.com/mytenant01.onmicrosoft.com"
    );
    expect(msalConfig.auth.knownAuthorities).toEqual(["mytenant01.ciamlogin.com"]);
  });
});
