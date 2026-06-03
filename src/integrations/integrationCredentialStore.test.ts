import { createCipheriv, randomBytes, scryptSync } from "node:crypto";
import { IntegrationCredentials } from "./integrationManifest";

const ENV_KEYS = [
  "NODE_ENV",
  "AUTOFLOW_ALLOW_INMEMORY",
  "AUTOFLOW_DISABLE_PG_PERSISTENCE",
  "DATABASE_URL",
  "CONNECTOR_CREDENTIAL_ENCRYPTION_KEY",
  "CONNECTOR_CREDENTIALS_ENCRYPTION_KEY",
  "CONNECTOR_CREDENTIAL_ENCRYPTION_KEY_V2",
  "CONNECTOR_CREDENTIALS_ENCRYPTION_KEY_V2",
  "CONNECTOR_CREDENTIAL_ENCRYPTION_KEY_PREVIOUS",
  "CONNECTOR_CREDENTIALS_ENCRYPTION_KEY_PREVIOUS",
  "CONNECTOR_CREDENTIAL_ENCRYPTION_KEY_PREVIOUS_KEYS",
  "CONNECTOR_CREDENTIALS_ENCRYPTION_KEY_PREVIOUS_KEYS",
  "INTEGRATION_CREDENTIAL_ENCRYPTION_KEY",
  "LLM_CONFIG_ENCRYPTION_KEY",
  "LLM_CONFIG_ENCRYPTION_KEY_V2",
] as const;

type StoreModule = typeof import("./integrationCredentialStore");

const originalEnv = new Map<string, string | undefined>();
for (const key of ENV_KEYS) {
  originalEnv.set(key, process.env[key]);
}

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    const original = originalEnv.get(key);
    if (original === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = original;
    }
  }
}

function resetToTestEnv(): void {
  restoreEnv();
  process.env.NODE_ENV = "test";
  process.env.AUTOFLOW_ALLOW_INMEMORY = "true";
  process.env.AUTOFLOW_DISABLE_PG_PERSISTENCE = "1";
  delete process.env.CONNECTOR_CREDENTIAL_ENCRYPTION_KEY;
  delete process.env.CONNECTOR_CREDENTIALS_ENCRYPTION_KEY;
  delete process.env.CONNECTOR_CREDENTIAL_ENCRYPTION_KEY_V2;
  delete process.env.CONNECTOR_CREDENTIALS_ENCRYPTION_KEY_V2;
  delete process.env.CONNECTOR_CREDENTIAL_ENCRYPTION_KEY_PREVIOUS;
  delete process.env.CONNECTOR_CREDENTIALS_ENCRYPTION_KEY_PREVIOUS;
  delete process.env.CONNECTOR_CREDENTIAL_ENCRYPTION_KEY_PREVIOUS_KEYS;
  delete process.env.CONNECTOR_CREDENTIALS_ENCRYPTION_KEY_PREVIOUS_KEYS;
  delete process.env.INTEGRATION_CREDENTIAL_ENCRYPTION_KEY;
  delete process.env.LLM_CONFIG_ENCRYPTION_KEY;
  delete process.env.LLM_CONFIG_ENCRYPTION_KEY_V2;
}

function loadStore(): StoreModule["integrationCredentialStore"] {
  jest.resetModules();
  return require("./integrationCredentialStore").integrationCredentialStore as StoreModule["integrationCredentialStore"];
}

function legacyEncrypt(credentials: IntegrationCredentials, seed: string): string {
  const key = scryptSync(seed, "autoflow-integration-salt", 32) as Buffer;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(credentials), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

describe("integrationCredentialStore connector secret envelope", () => {
  afterEach(() => {
    jest.dontMock("../db/postgres");
    jest.resetModules();
    restoreEnv();
  });

  it("writes generic credentials with connectorSecretVault key-version metadata", async () => {
    resetToTestEnv();
    process.env.CONNECTOR_CREDENTIAL_ENCRYPTION_KEY_V2 = "connector-v2-key";
    const integrationCredentialStore = loadStore();

    const created = await integrationCredentialStore.create({
      userId: "user-1",
      integrationSlug: "github",
      label: "GitHub",
      credentials: { token: "ghp_secret_1234" },
    });

    expect(created).not.toHaveProperty("credentialsEncrypted");
    expect(created).not.toHaveProperty("keyVersion");

    const raw = integrationCredentialStore.__unsafeGetCachedForTests(created.id);
    expect(raw?.credentialsEncrypted).toMatch(/^v2:/);
    expect(raw?.credentialsEncrypted).not.toContain("ghp_secret_1234");
    expect(raw?.keyVersion).toBe(2);

    const decrypted = await integrationCredentialStore.getDecrypted(created.id, "user-1");
    expect(decrypted?.credentials).toEqual({ token: "ghp_secret_1234" });
  });

  it("reads legacy integration-key ciphertext and rewraps it with the connector vault", async () => {
    resetToTestEnv();
    process.env.CONNECTOR_CREDENTIAL_ENCRYPTION_KEY_V2 = "connector-v2-key";
    process.env.INTEGRATION_CREDENTIAL_ENCRYPTION_KEY = "legacy-integration-key";
    const integrationCredentialStore = loadStore();
    const legacyCiphertext = legacyEncrypt(
      { token: "legacy-token", refreshToken: "legacy-refresh" },
      "legacy-integration-key",
    );

    integrationCredentialStore.__unsafeSetCachedForTests({
      id: "legacy-connection",
      userId: "legacy-user",
      integrationSlug: "hubspot",
      label: "Legacy HubSpot",
      isDefault: true,
      createdAt: "2026-06-03T00:00:00.000Z",
      updatedAt: "2026-06-03T00:00:00.000Z",
      credentialsEncrypted: legacyCiphertext,
    });

    const decrypted = await integrationCredentialStore.getDecrypted("legacy-connection", "legacy-user");

    expect(decrypted?.credentials).toEqual({
      token: "legacy-token",
      refreshToken: "legacy-refresh",
    });
    expect(decrypted?.connection).not.toHaveProperty("keyVersion");

    const migrated = integrationCredentialStore.__unsafeGetCachedForTests("legacy-connection");
    expect(migrated?.credentialsEncrypted).toMatch(/^v2:/);
    expect(migrated?.credentialsEncrypted).not.toBe(legacyCiphertext);
    expect(migrated?.keyVersion).toBe(2);
  });

  it("reloads connector-vault credentials from persisted rows after restart", async () => {
    resetToTestEnv();
    process.env.CONNECTOR_CREDENTIAL_ENCRYPTION_KEY_V2 = "connector-v2-key";
    process.env.DATABASE_URL = "postgres://test";
    delete process.env.AUTOFLOW_DISABLE_PG_PERSISTENCE;

    type StoredRow = {
      id: string;
      user_id: string;
      record_data: unknown;
      key_version: number | null;
    };
    const rows = new Map<string, StoredRow>();
    const client = {
      query: jest.fn(async (sql: string, params: unknown[] = []) => {
        if (sql.includes("INSERT INTO connector_credentials")) {
          const [, id, userId, , recordData, keyVersion] = params;
          rows.set(String(id), {
            id: String(id),
            user_id: String(userId),
            record_data: JSON.parse(String(recordData)),
            key_version: typeof keyVersion === "number" ? keyVersion : null,
          });
          return { rows: [] };
        }

        if (sql.includes("SELECT id, record_data, key_version FROM connector_credentials")) {
          const [, id] = params;
          const row = rows.get(String(id));
          return { rows: row ? [row] : [] };
        }

        return { rows: [] };
      }),
      release: jest.fn(),
    };
    const pool = {
      connect: jest.fn(async () => client),
    };
    const installPostgresMock = () => {
      jest.doMock("../db/postgres", () => ({
        getPostgresPool: () => pool,
        inMemoryAllowed: () => false,
        isPostgresPersistenceEnabled: () => true,
      }));
    };

    installPostgresMock();
    const integrationCredentialStore = loadStore();
    const created = await integrationCredentialStore.create({
      userId: "restart-user",
      integrationSlug: "github",
      label: "Restart GitHub",
      credentials: { token: "restart-token" },
    });

    const persisted = rows.get(created.id);
    expect(persisted?.key_version).toBe(2);
    expect((persisted?.record_data as { credentialsEncrypted?: string }).credentialsEncrypted).toMatch(/^v2:/);

    jest.resetModules();
    installPostgresMock();
    const reloadedStore = loadStore();
    const reloaded = await reloadedStore.getDecrypted(created.id, "restart-user");

    expect(reloaded?.connection).toMatchObject({
      id: created.id,
      userId: "restart-user",
      integrationSlug: "github",
      label: "Restart GitHub",
    });
    expect(reloaded?.credentials).toEqual({ token: "restart-token" });
  });

  it("fails fast in production when only the legacy integration key is configured", () => {
    resetToTestEnv();
    process.env.NODE_ENV = "production";
    process.env.AUTOFLOW_ALLOW_INMEMORY = "false";
    process.env.INTEGRATION_CREDENTIAL_ENCRYPTION_KEY = "legacy-only-key";

    expect(() => {
      jest.isolateModules(() => {
        require("./integrationCredentialStore");
      });
    }).toThrow(/Missing connector credential encryption key for NODE_ENV=production/);
  });
});
