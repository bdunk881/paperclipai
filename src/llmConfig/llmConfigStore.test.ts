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
    expect(mockQueryPostgres).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO llm_configs"),
      expect.arrayContaining([
        created.id,
        "user-a",
        "openai",
        "Primary",
        "gpt-4o",
        "****1234",
        false,
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

    const created = await llmConfigStore.createAsync({
      userId: "user-a",
      provider: "anthropic",
      label: "Claude",
      model: "claude-3-5-sonnet-20241022",
      apiKey: "sk-ant-coldlookup",
    });
    const insertParams = mockQueryPostgres.mock.calls[0]?.[1] as unknown[] | undefined;
    const encryptedApiKey = typeof insertParams?.[5] === "string" ? insertParams[5] : undefined;
    expect(encryptedApiKey).toBeDefined();

    llmConfigStore.clear();
    mockQueryPostgres.mockReset();
    mockQueryPostgres.mockResolvedValue({
      rows: [
        {
          id: created.id,
          user_id: "user-a",
          provider: "anthropic",
          label: "Claude",
          model: "claude-3-5-sonnet-20241022",
          api_key_encrypted: encryptedApiKey,
          api_key_masked: "****okup",
          is_default: true,
          created_at: new Date().toISOString(),
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
      "SELECT * FROM llm_configs WHERE user_id = $1 AND is_default = true LIMIT 1",
      ["user-a"]
    );
  });
});
