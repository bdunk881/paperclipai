/**
 * HEL-298 then HEL-299: the registry now reads/writes inside
 * `withUserContext`, so the test mocks `getPostgresPool` instead of the
 * old `queryPostgres` helper. Each connect() returns a stub client that
 * resolves BEGIN / set_config / actual SQL / COMMIT in sequence — the
 * test pushes a row payload onto `flagRowQueue` when the real query
 * should return data; everything else returns empty.
 */

const clientQueryMock = jest.fn();
const releaseMock = jest.fn();
const connectMock = jest.fn(async () => ({
  query: clientQueryMock,
  release: releaseMock,
}));

jest.mock("../../db/postgres", () => ({
  inMemoryAllowed: jest.fn(() => true),
  isPostgresConfigured: jest.fn(),
  getPostgresPool: () => ({ connect: connectMock }),
}));

import { CredentialRegistry } from "./credentialRegistry";
import { isPostgresConfigured } from "../../db/postgres";

interface TestCredential {
  id: string;
  userId: string;
  createdAt: string;
  revokedAt?: string;
  tokenEncrypted: string;
}

const mockIsPostgresConfigured = jest.mocked(isPostgresConfigured);

// Helper: stage the next SELECT against connector_credentials to return
// these rows. Other queries (BEGIN, set_config, INSERT, DELETE, COMMIT)
// resolve to an empty result by default.
function stageSelectRows(rows: Array<Record<string, unknown>>): void {
  clientQueryMock.mockImplementation(async (sql: string) => {
    if (sql.startsWith("SELECT") && sql.includes("connector_credentials")) {
      return { rows, rowCount: rows.length, command: "SELECT", oid: 0, fields: [] };
    }
    return { rows: [], rowCount: 1, command: "OK", oid: 0, fields: [] };
  });
}

function sqlCalls(): string[] {
  return clientQueryMock.mock.calls.map(([sql]) => sql as string);
}

function findCall(predicate: (sql: string) => boolean): unknown[] | undefined {
  const call = clientQueryMock.mock.calls.find(([sql]) => predicate(sql as string));
  return call?.[1] as unknown[] | undefined;
}

describe("CredentialRegistry persistence", () => {
  beforeEach(() => {
    mockIsPostgresConfigured.mockReset();
    clientQueryMock.mockReset();
    releaseMock.mockReset();
    connectMock.mockClear();
    mockIsPostgresConfigured.mockReturnValue(false);
    // Default: every query resolves with empty rows.
    clientQueryMock.mockResolvedValue({ rows: [], rowCount: 1, command: "OK", oid: 0, fields: [] });
  });

  it("persists saved records inside withUserContext when Postgres is enabled", async () => {
    const registry = new CredentialRegistry<TestCredential, { id: string }>({
      service: "persist-save",
      toPublic: (record) => ({ id: record.id }),
    });

    mockIsPostgresConfigured.mockReturnValue(true);

    registry.save({
      id: "cred-1",
      userId: "user-1",
      createdAt: "2026-04-21T00:00:00.000Z",
      tokenEncrypted: "ciphertext",
    });

    // Persist is fire-and-forget — wait for the next microtask tick.
    await new Promise((resolve) => setImmediate(resolve));

    // HEL-299: the INSERT must run inside withUserContext bound to the
    // record's userId.
    const setConfigParams = findCall((sql) => sql.includes("set_config('app.current_user_id'"));
    expect(setConfigParams?.[0]).toBe("user-1");

    const insertParams = findCall((sql) => sql.startsWith("INSERT INTO connector_credentials"));
    expect(insertParams).toEqual([
      "persist-save",
      "cred-1",
      "user-1",
      "2026-04-21T00:00:00.000Z",
      null,
      JSON.stringify({
        id: "cred-1",
        userId: "user-1",
        createdAt: "2026-04-21T00:00:00.000Z",
        tokenEncrypted: "ciphertext",
        keyVersion: 1,
      }),
      1,
    ]);

    expect(sqlCalls()).toContain("BEGIN");
    expect(sqlCalls()).toContain("COMMIT");
  });

  it("hydrates cold-cache records from Postgres inside withUserContext", async () => {
    const registry = new CredentialRegistry<TestCredential, { id: string }>({
      service: "persist-read",
      toPublic: (record) => ({ id: record.id }),
    });

    mockIsPostgresConfigured.mockReturnValue(true);
    stageSelectRows([
      {
        id: "cred-2",
        user_id: "user-2",
        record_data: {
          id: "cred-2",
          userId: "user-2",
          createdAt: "2026-04-21T00:00:00.000Z",
          tokenEncrypted: "ciphertext-2",
        },
      },
    ]);

    // HEL-299: userId is now required.
    const loaded = await registry.getByIdAsync("cred-2", "user-2");
    expect(loaded).toEqual({
      id: "cred-2",
      userId: "user-2",
      createdAt: "2026-04-21T00:00:00.000Z",
      tokenEncrypted: "ciphertext-2",
    });

    // Confirm the GUC was set to user-2 before the SELECT.
    const setConfigParams = findCall((sql) => sql.includes("set_config('app.current_user_id'"));
    expect(setConfigParams?.[0]).toBe("user-2");

    const selectParams = findCall(
      (sql) => sql.startsWith("SELECT") && sql.includes("FROM connector_credentials"),
    );
    expect(selectParams).toEqual(["persist-read", "cred-2", "user-2"]);
  });

  it("merges persisted records into a warm cache during async listing", async () => {
    const registry = new CredentialRegistry<TestCredential, { id: string }>({
      service: "persist-list",
      toPublic: (record) => ({ id: record.id }),
    });

    mockIsPostgresConfigured.mockReturnValue(true);

    registry.save({
      id: "local-cred",
      userId: "user-3",
      createdAt: "2026-04-22T00:00:00.000Z",
      tokenEncrypted: "ciphertext-local",
    });

    // Wait for the fire-and-forget INSERT.
    await new Promise((resolve) => setImmediate(resolve));
    clientQueryMock.mockReset();
    clientQueryMock.mockResolvedValue({ rows: [], rowCount: 1, command: "OK", oid: 0, fields: [] });
    stageSelectRows([
      {
        id: "persisted-cred",
        user_id: "user-3",
        record_data: {
          id: "persisted-cred",
          userId: "user-3",
          createdAt: "2026-04-21T00:00:00.000Z",
          tokenEncrypted: "ciphertext-persisted",
        },
      },
    ]);

    const records = await registry.listStoredByUserAsync("user-3");

    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "local-cred" }),
        expect.objectContaining({ id: "persisted-cred" }),
      ]),
    );
    expect(records).toHaveLength(2);

    // HEL-182 + HEL-299: the SELECT filters at the SQL layer AND runs
    // inside withUserContext (proven by the set_config call).
    const setConfigParams = findCall((sql) => sql.includes("set_config('app.current_user_id'"));
    expect(setConfigParams?.[0]).toBe("user-3");

    const selectParams = findCall(
      (sql) => sql.startsWith("SELECT") && sql.includes("FROM connector_credentials"),
    );
    expect(selectParams).toEqual(["persist-list", "user-3"]);
  });

  it("groups persistent deletes by owning user (HEL-299)", async () => {
    const registry = new CredentialRegistry<TestCredential, { id: string }>({
      service: "persist-delete",
      toPublic: (record) => ({ id: record.id }),
    });

    mockIsPostgresConfigured.mockReturnValue(true);

    // Seed three records owned by two distinct users.
    registry.save({
      id: "cred-a1",
      userId: "user-a",
      createdAt: "2026-04-21T00:00:00.000Z",
      tokenEncrypted: "c-a1",
    });
    registry.save({
      id: "cred-a2",
      userId: "user-a",
      createdAt: "2026-04-21T00:01:00.000Z",
      tokenEncrypted: "c-a2",
    });
    registry.save({
      id: "cred-b1",
      userId: "user-b",
      createdAt: "2026-04-21T00:02:00.000Z",
      tokenEncrypted: "c-b1",
    });

    await new Promise((resolve) => setImmediate(resolve));
    clientQueryMock.mockReset();
    clientQueryMock.mockResolvedValue({ rows: [], rowCount: 1, command: "OK", oid: 0, fields: [] });

    // Purge everything — should produce one DELETE per user with that user's GUC.
    registry.purge(() => true);

    await new Promise((resolve) => setImmediate(resolve));

    // Expect at least two set_config calls — one per user.
    const userIdsSet = clientQueryMock.mock.calls
      .filter(([sql]) => (sql as string).includes("set_config('app.current_user_id'"))
      .map(([, params]) => (params as unknown[])[0] as string);
    expect(new Set(userIdsSet)).toEqual(new Set(["user-a", "user-b"]));

    const deleteCalls = clientQueryMock.mock.calls.filter(([sql]) =>
      (sql as string).startsWith("DELETE FROM connector_credentials"),
    );
    expect(deleteCalls).toHaveLength(2);
    for (const [, params] of deleteCalls) {
      const [service, ids, userId] = params as [string, string[], string];
      expect(service).toBe("persist-delete");
      expect(typeof userId).toBe("string");
      if (userId === "user-a") expect(ids.sort()).toEqual(["cred-a1", "cred-a2"]);
      if (userId === "user-b") expect(ids).toEqual(["cred-b1"]);
    }
  });

  it("does not resurrect a credential revoked on another instance (HEL-594)", async () => {
    const registry = new CredentialRegistry<TestCredential, { id: string }>({
      service: "revoke-merge",
      toPublic: (record) => ({ id: record.id }),
    });
    mockIsPostgresConfigured.mockReturnValue(true);

    // This process holds an active copy in its bucket (also persisted).
    registry.save({
      id: "cred-x",
      userId: "user-9",
      createdAt: "2026-05-01T00:00:00.000Z",
      tokenEncrypted: "ct",
    });
    await new Promise((resolve) => setImmediate(resolve));
    clientQueryMock.mockReset();
    clientQueryMock.mockResolvedValue({ rows: [], rowCount: 1, command: "OK", oid: 0, fields: [] });

    // Another instance revoked it: the persisted row now carries revokedAt while
    // our bucket still has the active copy.
    stageSelectRows([
      {
        id: "cred-x",
        user_id: "user-9",
        record_data: {
          id: "cred-x",
          userId: "user-9",
          createdAt: "2026-05-01T00:00:00.000Z",
          tokenEncrypted: "ct",
          revokedAt: "2026-05-02T00:00:00.000Z",
        },
      },
    ]);

    // Active lookup must honor the persisted revocation, not the stale local copy.
    const active = await registry.listStoredByUserAsync("user-9", false);
    expect(active).toHaveLength(0);

    // And the stale copy is evicted from the bucket, so the sync getters can't
    // serve it as active either.
    expect(registry.getById("cred-x")).toBeNull();

    // includeRevoked still surfaces it (from Postgres) for listings/audit.
    const all = await registry.listStoredByUserAsync("user-9", true);
    expect(all).toHaveLength(1);
    expect(all[0].revokedAt).toBe("2026-05-02T00:00:00.000Z");
  });
});
