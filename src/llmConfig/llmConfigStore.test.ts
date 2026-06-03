/**
 * HEL-298 → HEL-299: the credential registry under llmConfigStore now
 * reads/writes via `withUserContext`, so the test mocks `getPostgresPool`
 * instead of `queryPostgres`. The cold-lookup hydration path now goes
 * through `listStoredByUserAsync(userId)` (the cross-tenant
 * `listStoredAsync` is bucket-only after HEL-299), so the staged SELECT
 * is the user-scoped variant.
 */

const clientQueryMock = jest.fn();
const releaseMock = jest.fn();
const connectMock = jest.fn(async () => ({
  query: clientQueryMock,
  release: releaseMock,
}));

jest.mock("../db/postgres", () => ({
  inMemoryAllowed: jest.fn(() => true),
  isPostgresConfigured: jest.fn(),
  getPostgresPool: () => ({ connect: connectMock }),
}));

import { isPostgresConfigured } from "../db/postgres";
import { llmConfigStore } from "./llmConfigStore";

const mockIsPostgresConfigured = jest.mocked(isPostgresConfigured);

function stageSelectRows(rows: Array<Record<string, unknown>>): void {
  clientQueryMock.mockImplementation(async (sql: string) => {
    if (sql.startsWith("SELECT") && sql.includes("connector_credentials")) {
      return { rows, rowCount: rows.length, command: "SELECT", oid: 0, fields: [] };
    }
    return { rows: [], rowCount: 1, command: "OK", oid: 0, fields: [] };
  });
}

function findCall(predicate: (sql: string) => boolean): unknown[] | undefined {
  const call = clientQueryMock.mock.calls.find(([sql]) => predicate(sql as string));
  return call?.[1] as unknown[] | undefined;
}

function findInsertParams(): unknown[] | undefined {
  return findCall((sql) => sql.startsWith("INSERT INTO connector_credentials"));
}

describe("llmConfigStore async persistence", () => {
  beforeEach(() => {
    llmConfigStore.clear();
    mockIsPostgresConfigured.mockReset();
    clientQueryMock.mockReset();
    releaseMock.mockReset();
    connectMock.mockClear();
    mockIsPostgresConfigured.mockReturnValue(false);
    clientQueryMock.mockResolvedValue({ rows: [], rowCount: 1, command: "OK", oid: 0, fields: [] });
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
    // Fire-and-forget persist runs on the next tick.
    await new Promise((resolve) => setImmediate(resolve));
    return created;
  }

  it("persists created configs inside withUserContext when Postgres is enabled", async () => {
    mockIsPostgresConfigured.mockReturnValue(true);

    const created = await createConfig({
      userId: "user-a",
      provider: "openai",
      label: "Primary",
      model: "gpt-4o",
      apiKey: "sk-test-created1234",
    });

    expect(created.apiKeyMasked).toBe("****1234");

    // HEL-299: persist runs in withUserContext bound to the record owner.
    const setConfigParams = findCall((sql) => sql.includes("set_config('app.current_user_id'"));
    expect(setConfigParams?.[0]).toBe("user-a");

    const insertParams = findInsertParams();
    expect(insertParams).toEqual(
      expect.arrayContaining(["llm-config", created.id, "user-a"]),
    );
  });

  it("hydrates and decrypts the default config from Postgres on cold lookup", async () => {
    mockIsPostgresConfigured.mockReturnValue(true);

    const created = await createConfig({
      userId: "user-a",
      provider: "anthropic",
      label: "Claude",
      model: "claude-3-5-sonnet-20241022",
      apiKey: "sk-ant-coldlookup",
    });
    const insertParams = findInsertParams();
    const persistedRecordJson = insertParams?.[5] as string | undefined;
    const persistedRecord = persistedRecordJson
      ? (JSON.parse(persistedRecordJson) as Record<string, unknown>)
      : undefined;

    expect(persistedRecord?.["secretPayloadEncrypted"]).toBeDefined();

    // Clear the local bucket and reset the mock to simulate a cold restart.
    llmConfigStore.clear();
    clientQueryMock.mockReset();
    clientQueryMock.mockResolvedValue({ rows: [], rowCount: 1, command: "OK", oid: 0, fields: [] });

    // HEL-299: cold lookup goes through listStoredByUserAsync(userId)
    // now (cross-tenant listStoredAsync is bucket-only). Stage the
    // hydrate response on the user-scoped SELECT.
    stageSelectRows([
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
    ]);

    const resolved = await llmConfigStore.getDecryptedDefaultAsync("user-a");

    expect(resolved).toEqual(
      expect.objectContaining({
        apiKey: "sk-ant-coldlookup",
        config: expect.objectContaining({
          id: created.id,
          userId: "user-a",
          isDefault: true,
        }),
      }),
    );

    // Confirm the SELECT ran inside withUserContext for user-a.
    const setConfigParams = findCall((sql) => sql.includes("set_config('app.current_user_id'"));
    expect(setConfigParams?.[0]).toBe("user-a");
  });

  it("getAsync + setDefaultAsync work on a cold process / other instance (HEL-494/B16)", async () => {
    mockIsPostgresConfigured.mockReturnValue(true);

    const created = await createConfig({
      userId: "user-a",
      provider: "anthropic",
      label: "Claude",
      model: "claude-3-5-sonnet-20241022",
      apiKey: "sk-ant-b16xxxx",
    });
    const insertParams = findInsertParams();
    const persistedRecordJson = insertParams?.[5] as string | undefined;
    const persistedRecord = persistedRecordJson
      ? (JSON.parse(persistedRecordJson) as Record<string, unknown>)
      : {};

    // Simulate a fresh process / the other Fly machine: the in-process bucket
    // is empty, the row only lives in Postgres.
    llmConfigStore.clear();
    clientQueryMock.mockReset();
    clientQueryMock.mockResolvedValue({ rows: [], rowCount: 1, command: "OK", oid: 0, fields: [] });
    stageSelectRows([
      {
        id: created.id,
        user_id: "user-a",
        record_data: {
          ...persistedRecord,
          id: created.id,
          userId: "user-a",
          authMethod: "anthropic",
          label: "Claude",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          metadata: {
            provider: "anthropic",
            model: "claude-3-5-sonnet-20241022",
            credentialSummary: { apiKeyMasked: "****xxxx" },
            apiKeyMasked: "****xxxx",
            isDefault: true,
          },
        },
      },
    ]);

    // The sync getter (in-process bucket only) misses on the cold process —
    // this is exactly the 404 the PATCH routes used to return.
    expect(llmConfigStore.get(created.id, "user-a")).toBeUndefined();

    // The DB-backed getAsync finds it (used by PATCH /:id).
    const fetched = await llmConfigStore.getAsync(created.id, "user-a");
    expect(fetched?.id).toBe(created.id);

    // setDefaultAsync (used by PATCH /:id/default) flips + durably persists.
    const updated = await llmConfigStore.setDefaultAsync(created.id, "user-a");
    expect(updated?.id).toBe(created.id);
    expect(updated?.isDefault).toBe(true);

    // The flag change was written back to Postgres (write-through upsert).
    // store.update persists fire-and-forget, so let it flush first.
    await new Promise((resolve) => setImmediate(resolve));
    const persistWrite = clientQueryMock.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO connector_credentials"),
    );
    expect(persistWrite).toBeDefined();
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
    const insertParams = findInsertParams();
    const persistedRecordJson = insertParams?.[5] as string | undefined;
    const persistedRecord = persistedRecordJson
      ? (JSON.parse(persistedRecordJson) as Record<string, unknown>)
      : undefined;

    llmConfigStore.clear();
    clientQueryMock.mockReset();
    clientQueryMock.mockResolvedValue({ rows: [], rowCount: 1, command: "OK", oid: 0, fields: [] });

    stageSelectRows([
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
    ]);

    const resolved = await llmConfigStore.getDecryptedDefaultAsync("user-a");

    expect(resolved).toEqual(
      expect.objectContaining({
        apiKey: "sk-ant-legacy1234",
        config: expect.objectContaining({
          id: created.id,
          isDefault: true,
        }),
      }),
    );

    // The promotion path persists an update — it should also go through
    // withUserContext bound to user-a.
    const setConfigCalls = clientQueryMock.mock.calls
      .filter(([sql]) => (sql as string).includes("set_config('app.current_user_id'"))
      .map(([, params]) => (params as unknown[])[0] as string);
    expect(setConfigCalls).toContain("user-a");
  });

  it("merges persisted configs into a warm cache during async list", async () => {
    mockIsPostgresConfigured.mockReturnValue(true);

    const local = await createConfig({
      userId: "user-a",
      provider: "openai",
      label: "Warm cache",
      model: "gpt-4o",
      apiKey: "sk-test-local1234",
    });

    clientQueryMock.mockReset();
    clientQueryMock.mockResolvedValue({ rows: [], rowCount: 1, command: "OK", oid: 0, fields: [] });
    stageSelectRows([
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
    ]);

    const listed = await llmConfigStore.listAsync("user-a");

    expect(listed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: local.id, label: "Warm cache" }),
        expect.objectContaining({ id: "persisted-config", label: "Persisted" }),
      ]),
    );
    expect(listed).toHaveLength(2);

    // HEL-299: the SELECT filters at SQL layer AND runs inside withUserContext.
    const setConfigParams = findCall((sql) => sql.includes("set_config('app.current_user_id'"));
    expect(setConfigParams?.[0]).toBe("user-a");

    const selectParams = findCall(
      (sql) => sql.startsWith("SELECT") && sql.includes("FROM connector_credentials"),
    );
    expect(selectParams).toEqual(["llm-config", "user-a"]);
  });
});
