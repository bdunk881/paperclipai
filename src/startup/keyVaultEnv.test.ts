import {
  deriveKeyVaultSecretName,
  hydrateProcessEnvFromKeyVault,
  resolveKeyVaultSecretTargets,
} from "./keyVaultEnv";

describe("deriveKeyVaultSecretName", () => {
  it("converts env names to lowercase hyphenated secret names", () => {
    expect(deriveKeyVaultSecretName("CONTROL_PLANE_SECRET_KEY")).toBe(
      "control-plane-secret-key"
    );
  });
});

describe("resolveKeyVaultSecretTargets", () => {
  it("derives secret names from required env names", () => {
    expect(
      resolveKeyVaultSecretTargets({
        KEY_VAULT_REQUIRED_SECRETS: "APP_BASE_URL,CONTROL_PLANE_SECRET_KEY",
      })
    ).toEqual([
      { envName: "APP_BASE_URL", secretName: "app-base-url" },
      {
        envName: "CONTROL_PLANE_SECRET_KEY",
        secretName: "control-plane-secret-key",
      },
    ]);
  });

  it("lets explicit mappings override derived secret names", () => {
    expect(
      resolveKeyVaultSecretTargets({
        KEY_VAULT_REQUIRED_SECRETS: "APP_BASE_URL",
        KEY_VAULT_SECRET_MAPPINGS: "APP_BASE_URL=custom-secret-name",
      })
    ).toEqual([{ envName: "APP_BASE_URL", secretName: "custom-secret-name" }]);
  });
});

describe("hydrateProcessEnvFromKeyVault", () => {
  const logger = {
    log: jest.fn(),
    warn: jest.fn(),
  };

  beforeEach(() => {
    logger.log.mockReset();
    logger.warn.mockReset();
  });

  it("is a no-op when no vault URL is configured", async () => {
    const env: NodeJS.ProcessEnv = {};

    await expect(hydrateProcessEnvFromKeyVault(logger, env)).resolves.toBe(false);
  });

  it("hydrates missing env vars from derived secret names", async () => {
    const env: NodeJS.ProcessEnv = {
      KEY_VAULT_URL: "https://example.vault.azure.net/",
      KEY_VAULT_REQUIRED_SECRETS: "APP_BASE_URL,CONTROL_PLANE_SECRET_KEY",
    };

    const secrets: Record<string, string> = {
      "app-base-url": "https://app.helloautoflow.com",
      "control-plane-secret-key": "super-secret",
    };

    const createClient = jest.fn(() => ({
      getSecret: jest.fn(async (name: string) => ({ value: secrets[name] })),
    }));

    await expect(hydrateProcessEnvFromKeyVault(logger, env, createClient)).resolves.toBe(true);

    expect(env.APP_BASE_URL).toBe("https://app.helloautoflow.com");
    expect(env.CONTROL_PLANE_SECRET_KEY).toBe("super-secret");
  });

  it("skips already populated env vars unless overriding is enabled", async () => {
    const env: NodeJS.ProcessEnv = {
      KEY_VAULT_URL: "https://example.vault.azure.net/",
      KEY_VAULT_REQUIRED_SECRETS: "APP_BASE_URL",
      APP_BASE_URL: "https://already-set.example.com",
    };

    const getSecret = jest.fn(async () => ({ value: "https://from-vault.example.com" }));

    await expect(
      hydrateProcessEnvFromKeyVault(logger, env, () => ({ getSecret }))
    ).resolves.toBe(true);

    expect(getSecret).not.toHaveBeenCalled();
    expect(env.APP_BASE_URL).toBe("https://already-set.example.com");
  });

  it("throws when a required secret is missing", async () => {
    const env: NodeJS.ProcessEnv = {
      KEY_VAULT_URL: "https://example.vault.azure.net/",
      KEY_VAULT_REQUIRED_SECRETS: "APP_BASE_URL",
    };

    await expect(
      hydrateProcessEnvFromKeyVault(logger, env, () => ({
        getSecret: jest.fn(async () => ({ value: undefined })),
      }))
    ).rejects.toThrow('Secret "app-base-url" for env "APP_BASE_URL" is missing or empty');
  });
});
