/**
 * Tests for src/secrets/keyVaultSecrets.ts and the startup ordering contract.
 *
 * Covers:
 *   1. Dev fallback when AZURE_KEY_VAULT_URI is not set (no-op + warning).
 *   2. Fail-fast when Key Vault is configured but unreachable.
 *   3. Successful parallel secret load writes values into process.env.
 *   4. Missing secrets (404 / SecretNotFound) are skipped, not fatal.
 *   5. Unexpected errors (auth/network) are re-thrown to crash the process.
 *   6. Startup contract: consumers that snapshot env at import time observe
 *      vault-injected values when index.ts's dynamic-import order is honored.
 */

// Mock @azure/identity so we don't try to resolve real credentials in tests.
jest.mock("@azure/identity", () => ({
  DefaultAzureCredential: jest.fn().mockImplementation(() => ({})),
}));

// Mock SecretClient. Each test overrides the constructor implementation.
const mockGetSecret = jest.fn();
const mockListPropertiesOfSecrets = jest.fn();
jest.mock("@azure/keyvault-secrets", () => ({
  SecretClient: jest.fn().mockImplementation(() => ({
    getSecret: mockGetSecret,
    listPropertiesOfSecrets: mockListPropertiesOfSecrets,
  })),
}));

// ---------------------------------------------------------------------------
// Env / module-cache helpers
// ---------------------------------------------------------------------------

const ORIGINAL_ENV = { ...process.env };

/** Keys this test mutates so we can restore them between tests. */
const MANAGED_ENV_KEYS = [
  "AZURE_KEY_VAULT_URI",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_FLOW_PRICE_ID",
  "STRIPE_AUTOMATE_PRICE_ID",
  "STRIPE_SCALE_PRICE_ID",
  "LLM_CONFIG_ENCRYPTION_KEY",
  "DATABASE_URL",
  "REDIS_URL",
  "AZURE_CLIENT_SECRET",
];

function resetEnv(): void {
  for (const key of MANAGED_ENV_KEYS) {
    if (ORIGINAL_ENV[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = ORIGINAL_ENV[key];
    }
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.resetModules();
  resetEnv();
});

afterAll(() => {
  resetEnv();
});

// ---------------------------------------------------------------------------
// 1. Dev fallback
// ---------------------------------------------------------------------------

describe("loadSecretsFromKeyVault — dev fallback", () => {
  it("is a no-op when AZURE_KEY_VAULT_URI is not set", async () => {
    delete process.env.AZURE_KEY_VAULT_URI;
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    const { loadSecretsFromKeyVault } = await import("./keyVaultSecrets");
    await expect(loadSecretsFromKeyVault()).resolves.toBeUndefined();

    expect(mockGetSecret).not.toHaveBeenCalled();
    expect(mockListPropertiesOfSecrets).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("AZURE_KEY_VAULT_URI not set")
    );

    warnSpy.mockRestore();
  });

  it("does not mutate process.env when in dev fallback", async () => {
    delete process.env.AZURE_KEY_VAULT_URI;
    process.env.STRIPE_SECRET_KEY = "sk_local_dev";
    jest.spyOn(console, "warn").mockImplementation(() => {});

    const { loadSecretsFromKeyVault } = await import("./keyVaultSecrets");
    await loadSecretsFromKeyVault();

    expect(process.env.STRIPE_SECRET_KEY).toBe("sk_local_dev");
  });
});

// ---------------------------------------------------------------------------
// 2. Fail-fast when Key Vault is unreachable
// ---------------------------------------------------------------------------

describe("loadSecretsFromKeyVault — fail-fast on unreachable Key Vault", () => {
  it("throws a descriptive error when health check fails", async () => {
    process.env.AZURE_KEY_VAULT_URI = "https://fake.vault.azure.net";
    mockListPropertiesOfSecrets.mockImplementation(() => ({
      next: () => Promise.reject(new Error("ENOTFOUND fake.vault.azure.net")),
    }));
    jest.spyOn(console, "log").mockImplementation(() => {});

    const { loadSecretsFromKeyVault } = await import("./keyVaultSecrets");
    await expect(loadSecretsFromKeyVault()).rejects.toThrow(
      /Key Vault health check failed/
    );
    await expect(loadSecretsFromKeyVault()).rejects.toThrow(
      /https:\/\/fake\.vault\.azure\.net/
    );

    // No secret loads should happen if health check fails.
    expect(mockGetSecret).not.toHaveBeenCalled();
  });

  it("surfaces the original error message in the wrapped error", async () => {
    process.env.AZURE_KEY_VAULT_URI = "https://fake.vault.azure.net";
    const originalError = new Error("AuthorizationFailed: missing RBAC");
    mockListPropertiesOfSecrets.mockImplementation(() => ({
      next: () => Promise.reject(originalError),
    }));
    jest.spyOn(console, "log").mockImplementation(() => {});

    const { loadSecretsFromKeyVault } = await import("./keyVaultSecrets");
    await expect(loadSecretsFromKeyVault()).rejects.toThrow(
      /AuthorizationFailed: missing RBAC/
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Successful secret load writes to process.env
// ---------------------------------------------------------------------------

describe("loadSecretsFromKeyVault — successful load", () => {
  function setupHealthyVault(): void {
    process.env.AZURE_KEY_VAULT_URI = "https://ok.vault.azure.net";
    mockListPropertiesOfSecrets.mockImplementation(() => ({
      next: () => Promise.resolve({ done: false, value: { name: "any" } }),
    }));
  }

  it("writes every mapped secret into process.env", async () => {
    setupHealthyVault();
    jest.spyOn(console, "log").mockImplementation(() => {});

    mockGetSecret.mockImplementation(async (kvName: string) => ({
      value: `vault-value-for-${kvName}`,
    }));

    const { loadSecretsFromKeyVault } = await import("./keyVaultSecrets");
    await loadSecretsFromKeyVault();

    expect(process.env.STRIPE_SECRET_KEY).toBe("vault-value-for-stripe-secret-key");
    expect(process.env.STRIPE_FLOW_PRICE_ID).toBe("vault-value-for-stripe-flow-price-id");
    expect(process.env.STRIPE_AUTOMATE_PRICE_ID).toBe(
      "vault-value-for-stripe-automate-price-id"
    );
    expect(process.env.STRIPE_SCALE_PRICE_ID).toBe(
      "vault-value-for-stripe-scale-price-id"
    );
    expect(process.env.LLM_CONFIG_ENCRYPTION_KEY).toBe(
      "vault-value-for-llm-config-encryption-key"
    );
    expect(process.env.DATABASE_URL).toBe("vault-value-for-database-url");
    expect(process.env.REDIS_URL).toBe("vault-value-for-redis-url");
    expect(process.env.AZURE_CLIENT_SECRET).toBe("vault-value-for-entra-client-secret");
  });

  it("skips secrets that are not found in Key Vault (gradual migration)", async () => {
    setupHealthyVault();
    jest.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    mockGetSecret.mockImplementation(async (kvName: string) => {
      if (kvName === "redis-url") {
        const err = new Error("SecretNotFound") as Error & { statusCode: number };
        err.statusCode = 404;
        throw err;
      }
      return { value: `ok-${kvName}` };
    });

    const { loadSecretsFromKeyVault } = await import("./keyVaultSecrets");
    await expect(loadSecretsFromKeyVault()).resolves.toBeUndefined();

    expect(process.env.STRIPE_SECRET_KEY).toBe("ok-stripe-secret-key");
    expect(process.env.REDIS_URL).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/redis-url.*not found/i)
    );
  });

  it("re-throws unexpected errors (auth, network) so process crashes fast", async () => {
    setupHealthyVault();
    jest.spyOn(console, "log").mockImplementation(() => {});

    mockGetSecret.mockImplementation(async () => {
      const err = new Error("Forbidden") as Error & { statusCode: number };
      err.statusCode = 403;
      throw err;
    });

    const { loadSecretsFromKeyVault } = await import("./keyVaultSecrets");
    await expect(loadSecretsFromKeyVault()).rejects.toThrow(/Forbidden/);
  });

  it("skips secrets whose value is explicitly null without overwriting existing env", async () => {
    setupHealthyVault();
    jest.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    // Sentinel value that MUST remain after load — proves the loader did not
    // overwrite existing env when the vault returned an explicit null value.
    process.env.DATABASE_URL = "pre-existing-db-url-do-not-overwrite";

    // One secret returns null, others succeed.
    mockGetSecret.mockImplementation(async (kvName: string) => {
      if (kvName === "database-url") return { value: null };
      return { value: `ok-${kvName}` };
    });

    const { loadSecretsFromKeyVault } = await import("./keyVaultSecrets");
    await loadSecretsFromKeyVault();

    expect(process.env.DATABASE_URL).toBe("pre-existing-db-url-do-not-overwrite");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/database-url.*no value/i)
    );
  });
});

// ---------------------------------------------------------------------------
// 4. Startup contract: env consumers see vault-injected values
// ---------------------------------------------------------------------------
//
// The production startup order in src/index.ts is:
//     1. await loadSecretsFromKeyVault()
//     2. dynamic import of ./app (which transitively imports modules that
//        snapshot process.env at module-eval time)
//
// These tests prove that if a consumer is imported AFTER the KV load, it
// reads the injected values — which is the contract src/index.ts relies on.
// If a future refactor regresses to a static top-level `import app` in
// index.ts, these tests still pass (they exercise the consumer modules
// directly) but they document the expected behavior.

describe("startup contract — env consumers observe KV-injected values", () => {
  it("stripeClient PRICING_TIERS reads vault-injected STRIPE_*_PRICE_IDs", async () => {
    process.env.AZURE_KEY_VAULT_URI = "https://ok.vault.azure.net";
    mockListPropertiesOfSecrets.mockImplementation(() => ({
      next: () => Promise.resolve({ done: false, value: { name: "any" } }),
    }));
    mockGetSecret.mockImplementation(async (kvName: string) => {
      if (kvName === "stripe-flow-price-id") return { value: "price_flow_from_vault" };
      if (kvName === "stripe-automate-price-id")
        return { value: "price_automate_from_vault" };
      if (kvName === "stripe-scale-price-id") return { value: "price_scale_from_vault" };
      return { value: `v-${kvName}` };
    });
    jest.spyOn(console, "log").mockImplementation(() => {});

    const { loadSecretsFromKeyVault } = await import("./keyVaultSecrets");
    await loadSecretsFromKeyVault();

    // Import stripeClient AFTER KV load — this mirrors index.ts's dynamic
    // import of ./app. PRICING_TIERS is evaluated now, reading the env that
    // loadSecretsFromKeyVault just populated.
    const { PRICING_TIERS } = await import("../billing/stripeClient");

    expect(PRICING_TIERS.flow.priceId).toBe("price_flow_from_vault");
    expect(PRICING_TIERS.automate.priceId).toBe("price_automate_from_vault");
    expect(PRICING_TIERS.scale.priceId).toBe("price_scale_from_vault");
  });

  it("stripeClient PRICING_TIERS has empty price IDs if imported BEFORE KV load (regression guard)", async () => {
    // No AZURE_KEY_VAULT_URI → dev fallback. Also no STRIPE_*_PRICE_ID in env.
    delete process.env.AZURE_KEY_VAULT_URI;
    delete process.env.STRIPE_FLOW_PRICE_ID;
    delete process.env.STRIPE_AUTOMATE_PRICE_ID;
    delete process.env.STRIPE_SCALE_PRICE_ID;
    jest.spyOn(console, "warn").mockImplementation(() => {});

    // Import stripeClient now — simulates the buggy case where ./app was
    // imported at the top of index.ts before secrets were loaded.
    const { PRICING_TIERS } = await import("../billing/stripeClient");

    // With no env values and no vault load, priceIds fall back to "".
    // This is exactly the failure mode the backend review flagged.
    expect(PRICING_TIERS.flow.priceId).toBe("");
    expect(PRICING_TIERS.automate.priceId).toBe("");
    expect(PRICING_TIERS.scale.priceId).toBe("");
  });
});
