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

    await expect(loadConfig()).rejects.toThrow(
      "Missing required VITE_AZURE_CIAM_CLIENT_ID environment variable."
    );
  });

  it("throws when client id format is invalid", async () => {
    vi.stubEnv("VITE_AZURE_CIAM_CLIENT_ID", "not-a-guid");
    vi.stubEnv("VITE_AZURE_CIAM_TENANT_SUBDOMAIN", "autoflowciam");

    await expect(loadConfig()).rejects.toThrow(
      "Invalid VITE_AZURE_CIAM_CLIENT_ID format. Expected a GUID."
    );
  });

  it("throws when tenant subdomain is missing", async () => {
    vi.stubEnv("VITE_AZURE_CIAM_CLIENT_ID", "2dfd3a08-277c-4893-b07d-eca5ae322310");
    vi.stubEnv("VITE_AZURE_CIAM_TENANT_SUBDOMAIN", "");

    await expect(loadConfig()).rejects.toThrow(
      "Missing required VITE_AZURE_CIAM_TENANT_SUBDOMAIN environment variable."
    );
  });

  it("throws when tenant subdomain format is invalid", async () => {
    vi.stubEnv("VITE_AZURE_CIAM_CLIENT_ID", "2dfd3a08-277c-4893-b07d-eca5ae322310");
    vi.stubEnv("VITE_AZURE_CIAM_TENANT_SUBDOMAIN", "bad subdomain");

    await expect(loadConfig()).rejects.toThrow(
      "Invalid VITE_AZURE_CIAM_TENANT_SUBDOMAIN format."
    );
  });

  it("throws when tenant domain format is invalid", async () => {
    vi.stubEnv("VITE_AZURE_CIAM_CLIENT_ID", "2dfd3a08-277c-4893-b07d-eca5ae322310");
    vi.stubEnv("VITE_AZURE_CIAM_TENANT_SUBDOMAIN", "autoflowciam");
    vi.stubEnv("VITE_AZURE_CIAM_TENANT_DOMAIN", "https://tenant.onmicrosoft.com");

    await expect(loadConfig()).rejects.toThrow(
      "Invalid VITE_AZURE_CIAM_TENANT_DOMAIN format."
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
