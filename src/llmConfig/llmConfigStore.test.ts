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

  it("persists created configs when Postgres is enabled", async () => {
    mockIsPostgresConfigured.mockReturnValue(true);
    mockQueryPostgres.mockResolvedValue({
      rows: [],
      rowCount: 1,
      command: "INSERT",
      oid: 0,
      fields: [],
    });

    const created = await llmConfigStore.createAsync({
      userId: "user-a",
      provider: "openai",
      label: "Primary",
      model: "gpt-4o",
      apiKey: "sk-test-created1234",
    });

    expect(created.apiKeyMasked).toBe("****1234");
    const insertParams = mockQueryPostgres.mock.calls[0]?.[1] as unknown[] | undefined;
    const persistedRecord =
      typeof insertParams?.[5] === "string"
        ? (JSON.parse(insertParams[5] as string) as Record<string, unknown>)
        : undefined;

    expect(mockQueryPostgres).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO connector_credentials"),
      expect.arrayContaining([ "llm-config", created.id, "user-a" ])
    );
    expect(persistedRecord).toEqual(
      expect.objectContaining({
        id: created.id,
        userId: "user-a",
        authMethod: "openai",
        label: "Primary",
        metadata: expect.objectContaining({
          provider: "openai",
          model: "gpt-4o",
          apiKeyMasked: "****1234",
          isDefault: false,
        }),
        secretPayloadEncrypted: expect.any(String),
      }),
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

    const created = await llmConfigStore.createAsync({
      userId: "user-a",
      provider: "anthropic",
      label: "Claude",
      model: "claude-3-5-sonnet-20241022",
      apiKey: "sk-ant-coldlookup",
    });
    const insertParams = mockQueryPostgres.mock.calls[0]?.[1] as unknown[] | undefined;
    const persistedRecord =
      typeof insertParams?.[5] === "string"
        ? (JSON.parse(insertParams[5] as string) as Record<string, unknown>)
        : undefined;
    expect(persistedRecord?.secretPayloadEncrypted).toBeDefined();

    llmConfigStore.clear();
    mockQueryPostgres.mockReset();
    mockQueryPostgres.mockResolvedValue({
      rows: [
        {
          id: created.id,
          user_id: "user-a",
          record_data: {
            id: created.id,
            userId: "user-a",
            authMethod: "anthropic",
            label: "Claude",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            metadata: {
              provider: "anthropic",
              model: "claude-3-5-sonnet-20241022",
              credentialSummary: {
                apiKeyMasked: "****okup",
              },
              apiKeyMasked: "****okup",
              isDefault: true,
            },
            secretPayloadEncrypted: persistedRecord?.secretPayloadEncrypted,
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
          provider: "anthropic",
          isDefault: true,
        }),
      })
    );
    expect(mockQueryPostgres).toHaveBeenCalledWith(
      "SELECT id, user_id, record_data FROM connector_credentials WHERE service = $1 ORDER BY created_at DESC",
      ["llm-config"]
    );
  });
});
