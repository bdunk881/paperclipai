jest.mock("../../db/postgres", () => ({
  isPostgresConfigured: jest.fn(),
  queryPostgres: jest.fn(),
}));

import { CredentialRegistry } from "./credentialRegistry";
import { isPostgresConfigured, queryPostgres } from "../../db/postgres";

interface TestCredential {
  id: string;
  userId: string;
  createdAt: string;
  revokedAt?: string;
  tokenEncrypted: string;
}

const mockIsPostgresConfigured = jest.mocked(isPostgresConfigured);
const mockQueryPostgres = jest.mocked(queryPostgres);

describe("CredentialRegistry persistence", () => {
  beforeEach(() => {
    mockIsPostgresConfigured.mockReset();
    mockQueryPostgres.mockReset();
    mockIsPostgresConfigured.mockReturnValue(false);
  });

  it("persists saved records when Postgres is enabled", async () => {
    const registry = new CredentialRegistry<TestCredential, { id: string }>({
      service: "persist-save",
      toPublic: (record) => ({ id: record.id }),
    });

    mockIsPostgresConfigured.mockReturnValue(true);
    mockQueryPostgres.mockResolvedValue({
      rows: [],
      rowCount: 1,
      command: "INSERT",
      oid: 0,
      fields: [],
    });

    registry.save({
      id: "cred-1",
      userId: "user-1",
      createdAt: "2026-04-21T00:00:00.000Z",
      tokenEncrypted: "ciphertext",
    });

    await Promise.resolve();

    expect(mockQueryPostgres).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO connector_credentials"),
      [
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
        }),
      ]
    );
  });

  it("hydrates cold-cache records from Postgres", async () => {
    const registry = new CredentialRegistry<TestCredential, { id: string }>({
      service: "persist-read",
      toPublic: (record) => ({ id: record.id }),
    });

    mockIsPostgresConfigured.mockReturnValue(true);
    mockQueryPostgres.mockResolvedValue({
      rows: [
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
      ],
      rowCount: 1,
      command: "SELECT",
      oid: 0,
      fields: [],
    });

    const loaded = await registry.getByIdAsync("cred-2");
    expect(loaded).toEqual({
      id: "cred-2",
      userId: "user-2",
      createdAt: "2026-04-21T00:00:00.000Z",
      tokenEncrypted: "ciphertext-2",
    });

    const publicRecords = await registry.listPublicByUserAsync("user-2");
    expect(publicRecords).toEqual([{ id: "cred-2" }]);
  });

  it("falls back to in-memory records when connector_credentials is unavailable", async () => {
    const registry = new CredentialRegistry<TestCredential, { id: string }>({
      service: "persist-fallback",
      toPublic: (record) => ({ id: record.id }),
    });

    registry.save({
      id: "local-only",
      userId: "user-4",
      createdAt: "2026-04-22T00:00:00.000Z",
      tokenEncrypted: "ciphertext-local",
    });

    mockIsPostgresConfigured.mockReturnValue(true);
    mockQueryPostgres.mockRejectedValue(
      Object.assign(new Error('relation "connector_credentials" does not exist'), {
        code: "42P01",
      })
    );

    const records = await registry.listStoredByUserAsync("user-4");

    expect(records).toEqual([
      {
        id: "local-only",
        userId: "user-4",
        createdAt: "2026-04-22T00:00:00.000Z",
        tokenEncrypted: "ciphertext-local",
      },
    ]);
  });

  it("merges persisted records into a warm cache during async listing", async () => {
    const registry = new CredentialRegistry<TestCredential, { id: string }>({
      service: "persist-list",
      toPublic: (record) => ({ id: record.id }),
    });

    mockIsPostgresConfigured.mockReturnValue(true);
    mockQueryPostgres.mockResolvedValue({
      rows: [],
      rowCount: 1,
      command: "INSERT",
      oid: 0,
      fields: [],
    });

    registry.save({
      id: "local-cred",
      userId: "user-3",
      createdAt: "2026-04-22T00:00:00.000Z",
      tokenEncrypted: "ciphertext-local",
    });

    await Promise.resolve();

    mockQueryPostgres.mockReset();
    mockQueryPostgres.mockResolvedValue({
      rows: [
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
      ],
      rowCount: 1,
      command: "SELECT",
      oid: 0,
      fields: [],
    });

    const records = await registry.listStoredByUserAsync("user-3");

    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "local-cred" }),
        expect.objectContaining({ id: "persisted-cred" }),
      ])
    );
    expect(records).toHaveLength(2);
    expect(mockQueryPostgres).toHaveBeenCalledWith(
      "SELECT id, user_id, record_data FROM connector_credentials WHERE service = $1 ORDER BY created_at DESC",
      ["persist-list"]
    );
  });
});
