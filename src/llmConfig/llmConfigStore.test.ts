jest.mock("../db/postgres", () => ({
  isPostgresConfigured: jest.fn(),
  queryPostgres: jest.fn(),
}));

import { isPostgresConfigured, queryPostgres } from "../db/postgres";
import { llmConfigStore } from "./llmConfigStore";

const mockIsPostgresConfigured = jest.mocked(isPostgresConfigured);
const mockQueryPostgres = jest.mocked(queryPostgres);

describe("llmConfigStore async persistence", () => {
  beforeEach(() => {
    llmConfigStore.clear();
    mockIsPostgresConfigured.mockReset();
    mockQueryPostgres.mockReset();
    mockIsPostgresConfigured.mockReturnValue(false);
  });

  async function createConfig(params: {
    userId: string;
    provider: "openai" | "anthropic";
    label: string;
    model: string;
    apiKey: string;
  }) {
    const created = llmConfigStore.create({
      userId: params.userId,
      provider: params.provider,
      label: params.label,
      model: params.model,
      credentials: { apiKey: params.apiKey },
    });
    await Promise.resolve();
    return created;
  }

  it("persists created configs when Postgres is enabled", async () => {
    mockIsPostgresConfigured.mockReturnValue(true);
    mockQueryPostgres.mockResolvedValue({
      rows: [],
      rowCount: 1,
      command: "INSERT",
      oid: 0,
      fields: [],
    });

    const created = await createConfig({
      userId: "user-a",
      provider: "openai",
      label: "Primary",
      model: "gpt-4o",
      apiKey: "sk-test-created1234",
    });

    expect(created.apiKeyMasked).toBe("****1234");
    expect(mockQueryPostgres).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO connector_credentials"),
      expect.arrayContaining([
        "llm-config",
        created.id,
        "user-a",
      ])
    );
  });

  it("hydrates and decrypts the default config from Postgres on cold lookup", async () => {
    mockIsPostgresConfigured.mockReturnValue(true);
    mockQueryPostgres.mockResolvedValue({
      rows: [],
      rowCount: 1,
      command: "INSERT",
      oid: 0,
      fields: [],
    });

    const created = await createConfig({
      userId: "user-a",
      provider: "anthropic",
      label: "Claude",
      model: "claude-3-5-sonnet-20241022",
      apiKey: "sk-ant-coldlookup",
    });
    const persistedRecordJson = mockQueryPostgres.mock.calls[0]?.[1]?.[5] as string | undefined;
    const persistedRecord = persistedRecordJson
      ? (JSON.parse(persistedRecordJson) as Record<string, unknown>)
      : undefined;

    expect(persistedRecord?.["secretPayloadEncrypted"]).toBeDefined();

    llmConfigStore.clear();
    mockQueryPostgres.mockReset();
    mockQueryPostgres.mockResolvedValue({
      rows: [
        {
          id: created.id,
          user_id: "user-a",
          record_data: {
            ...(persistedRecord ?? {}),
            id: created.id,
            userId: "user-a",
            authMethod: "anthropic",
            label: "Claude",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            metadata: {
              provider: "anthropic",
              model: "claude-3-5-sonnet-20241022",
              credentialSummary: { apiKeyMasked: "****okup" },
              apiKeyMasked: "****okup",
              isDefault: true,
            },
          },
        },
      ],
      rowCount: 1,
      command: "SELECT",
      oid: 0,
      fields: [],
    });

    const resolved = await llmConfigStore.getDecryptedDefaultAsync("user-a");

    expect(resolved).toEqual(
      expect.objectContaining({
        apiKey: "sk-ant-coldlookup",
        config: expect.objectContaining({
          id: created.id,
          userId: "user-a",
          isDefault: true,
        }),
      })
    );
    expect(mockQueryPostgres).toHaveBeenCalledWith(
      "SELECT id, user_id, record_data FROM connector_credentials WHERE service = $1 ORDER BY created_at DESC",
      ["llm-config"]
    );
  });

  it("promotes the latest persisted config when a legacy record has no default", async () => {
    mockIsPostgresConfigured.mockReturnValue(true);
    const createdAt = "2026-04-20T00:00:00.000Z";
    const updatedAt = "2026-04-20T00:00:00.000Z";
    const created = await createConfig({
      userId: "user-a",
      provider: "anthropic",
      label: "Claude",
      model: "claude-3-5-sonnet-20241022",
      apiKey: "sk-ant-legacy1234",
    });
    const persistedRecordJson = mockQueryPostgres.mock.calls[0]?.[1]?.[5] as string | undefined;
    const persistedRecord = persistedRecordJson
      ? (JSON.parse(persistedRecordJson) as Record<string, unknown>)
      : undefined;

    llmConfigStore.clear();
    mockQueryPostgres.mockReset();
    mockQueryPostgres.mockResolvedValue({
      rows: [
        {
          id: created.id,
          user_id: "user-a",
          record_data: {
            ...(persistedRecord ?? {}),
            id: created.id,
            userId: "user-a",
            authMethod: "anthropic",
            label: "Claude",
            createdAt,
            updatedAt,
            metadata: {
              provider: "anthropic",
              model: "claude-3-5-sonnet-20241022",
              credentialSummary: { apiKeyMasked: "****1234" },
              apiKeyMasked: "****1234",
              isDefault: false,
            },
          },
        },
      ],
      rowCount: 1,
      command: "SELECT",
      oid: 0,
      fields: [],
    });

    const resolved = await llmConfigStore.getDecryptedDefaultAsync("user-a");

    expect(resolved).toEqual(
      expect.objectContaining({
        apiKey: "sk-ant-legacy1234",
        config: expect.objectContaining({
          id: created.id,
          isDefault: true,
        }),
      })
    );
    expect(mockQueryPostgres).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO connector_credentials"),
      expect.arrayContaining(["llm-config", created.id, "user-a"])
    );
  });

  it("merges persisted configs into a warm cache during async list", async () => {
    mockIsPostgresConfigured.mockReturnValue(true);
    mockQueryPostgres.mockResolvedValue({
      rows: [],
      rowCount: 1,
      command: "INSERT",
      oid: 0,
      fields: [],
    });

    const local = await createConfig({
      userId: "user-a",
      provider: "openai",
      label: "Warm cache",
      model: "gpt-4o",
      apiKey: "sk-test-local1234",
    });

    mockQueryPostgres.mockReset();
    mockQueryPostgres.mockResolvedValue({
      rows: [
        {
          id: "persisted-config",
          user_id: "user-a",
          record_data: {
            id: "persisted-config",
            userId: "user-a",
            authMethod: "anthropic",
            label: "Persisted",
            createdAt: "2026-04-20T00:00:00.000Z",
            updatedAt: "2026-04-20T00:00:00.000Z",
            metadata: {
              provider: "anthropic",
              model: "claude-3-5-sonnet-20241022",
              credentialSummary: { apiKeyMasked: "****5678" },
              apiKeyMasked: "****5678",
              isDefault: false,
            },
            secretPayloadEncrypted: "persisted-encrypted",
          },
        },
      ],
      rowCount: 1,
      command: "SELECT",
      oid: 0,
      fields: [],
    });

    const listed = await llmConfigStore.listAsync("user-a");

    expect(listed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: local.id, label: "Warm cache" }),
        expect.objectContaining({ id: "persisted-config", label: "Persisted" }),
      ])
    );
    expect(listed).toHaveLength(2);
    expect(mockQueryPostgres).toHaveBeenCalledWith(
      "SELECT id, user_id, record_data FROM connector_credentials WHERE service = $1 ORDER BY created_at DESC",
      ["llm-config"]
    );
  });
});
