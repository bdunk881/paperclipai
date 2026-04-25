import { CredentialRegistry, SecretVault, maskSecret } from "./credentialRegistry";

interface TestCredential {
  id: string;
  userId: string;
  createdAt: string;
  revokedAt?: string;
  tokenEncrypted: string;
}

describe("CredentialRegistry", () => {
  const originalCurrent = process.env.TEST_CONNECTOR_KEY;
  const originalPrevious = process.env.TEST_CONNECTOR_PREVIOUS;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = "test";
    process.env.TEST_CONNECTOR_KEY = "current-key";
    process.env.TEST_CONNECTOR_PREVIOUS = "previous-key";
  });

  afterEach(() => {
    if (originalCurrent === undefined) {
      delete process.env.TEST_CONNECTOR_KEY;
    } else {
      process.env.TEST_CONNECTOR_KEY = originalCurrent;
    }

    if (originalPrevious === undefined) {
      delete process.env.TEST_CONNECTOR_PREVIOUS;
    } else {
      process.env.TEST_CONNECTOR_PREVIOUS = originalPrevious;
    }

    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it("keeps records isolated by service bucket", () => {
    const slackRegistry = new CredentialRegistry<TestCredential, { id: string }>({
      service: "test-slack",
      toPublic: (record) => ({ id: record.id }),
    });
    const posthogRegistry = new CredentialRegistry<TestCredential, { id: string }>({
      service: "test-posthog",
      toPublic: (record) => ({ id: record.id }),
    });

    slackRegistry.save({
      id: "slack-1",
      userId: "user-1",
      createdAt: "2026-04-19T00:00:00.000Z",
      tokenEncrypted: "unused",
    });
    posthogRegistry.save({
      id: "posthog-1",
      userId: "user-1",
      createdAt: "2026-04-19T00:00:00.000Z",
      tokenEncrypted: "unused",
    });

    expect(slackRegistry.listPublicByUser("user-1")).toEqual([{ id: "slack-1" }]);
    expect(posthogRegistry.listPublicByUser("user-1")).toEqual([{ id: "posthog-1" }]);
  });

  it("decrypts secrets encrypted with a previous key during rotation", () => {
    const previousVault = new SecretVault({
      currentKeyEnvVars: ["TEST_CONNECTOR_PREVIOUS"],
      salts: ["autoflow-connector-salt"],
    });
    const rotatingVault = new SecretVault({
      currentKeyEnvVars: ["TEST_CONNECTOR_KEY"],
      previousKeyEnvVars: ["TEST_CONNECTOR_PREVIOUS"],
      salts: ["autoflow-connector-salt"],
    });

    const ciphertext = previousVault.encrypt("rotating-secret");
    expect(rotatingVault.decrypt(ciphertext)).toBe("rotating-secret");
  });

  it.each(["staging", "production"])(
    "fails fast when no encryption key is configured in %s",
    (nodeEnv) => {
      delete process.env.TEST_CONNECTOR_KEY;
      process.env.NODE_ENV = nodeEnv;

      expect(
        () =>
          new SecretVault({
            currentKeyEnvVars: ["TEST_CONNECTOR_KEY"],
            salts: ["autoflow-connector-salt"],
          })
      ).toThrow(
        `Missing connector credential encryption key for NODE_ENV=${nodeEnv}. Set one of TEST_CONNECTOR_KEY before starting the server. Ephemeral random fallback is only allowed in development or test.`
      );
    }
  );

  it.each(["development", "test"])(
    "allows ephemeral fallback when no encryption key is configured in %s",
    (nodeEnv) => {
      delete process.env.TEST_CONNECTOR_KEY;
      process.env.NODE_ENV = nodeEnv;

      const vault = new SecretVault({
        currentKeyEnvVars: ["TEST_CONNECTOR_KEY"],
        salts: ["autoflow-connector-salt"],
      });

      const ciphertext = vault.encrypt("ephemeral-secret");
      expect(vault.decrypt(ciphertext)).toBe("ephemeral-secret");
    }
  );

  it("masks secrets consistently", () => {
    expect(maskSecret("abcdef1234")).toBe("****1234");
  });
});
