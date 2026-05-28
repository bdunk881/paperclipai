/**
 * Regression guard for HEL-298. `PostgresMfaRepository` MUST wrap every
 * read and write inside `withUserContext` because migration 083 put FORCE
 * ROW LEVEL SECURITY on `mfa_webauthn_credentials`, `mfa_recovery_codes`,
 * and `user_mfa_policy`. Without the wrapper, every SELECT returns 0 rows
 * (because `app_current_user_id()` is NULL) and every INSERT throws
 * `new row violates row-level security policy`. That's exactly the
 * failure mode HEL-298 fixes.
 *
 * These tests don't talk to Postgres — they mock the pool and assert
 * each method runs `BEGIN` + `SELECT set_config('app.current_user_id', $1, true)`
 * before the actual query, with the userId we expect. If the wrapper
 * regresses (someone reverts to raw `queryPostgres`), these tests fail.
 *
 * The live cross-tenant assertion (FORCE RLS actually denying writes
 * without the GUC) lives in `src/db/rls.integration.test.ts` and runs
 * against the live Postgres role in CI.
 */

import { PostgresMfaRepository } from "./mfaRepository";

const clientQueryMock = jest.fn();
const releaseMock = jest.fn();
const connectMock = jest.fn(async () => ({
  query: clientQueryMock,
  release: releaseMock,
}));

jest.mock("../db/postgres", () => ({
  isPostgresPersistenceEnabled: () => true,
  getPostgresPool: () => ({ connect: connectMock }),
}));

function lastSetUserIdParam(): string | undefined {
  for (const call of clientQueryMock.mock.calls) {
    const [sql, params] = call as [string, unknown[] | undefined];
    if (sql.includes("set_config('app.current_user_id'")) {
      return (params?.[0] as string | undefined) ?? undefined;
    }
  }
  return undefined;
}

function sqlCalls(): string[] {
  return clientQueryMock.mock.calls.map(([sql]) => sql as string);
}

describe("PostgresMfaRepository (HEL-298 RLS context wrapping)", () => {
  let repo: PostgresMfaRepository;

  beforeEach(() => {
    clientQueryMock.mockReset();
    releaseMock.mockReset();
    connectMock.mockClear();
    // Default: every query returns empty rowset. Individual tests override.
    clientQueryMock.mockResolvedValue({ rows: [], rowCount: 0 });
    repo = new PostgresMfaRepository();
  });

  it("listWebauthnCredentials runs inside withUserContext with the right userId", async () => {
    await repo.listWebauthnCredentials("u-1");
    expect(lastSetUserIdParam()).toBe("u-1");
    expect(sqlCalls()[0]).toBe("BEGIN");
    expect(sqlCalls().at(-1)).toBe("COMMIT");
    expect(sqlCalls().some((s) => s.includes("FROM mfa_webauthn_credentials"))).toBe(true);
    expect(releaseMock).toHaveBeenCalled();
  });

  it("findWebauthnCredentialById scopes the lookup by userId in BOTH the GUC and the WHERE clause", async () => {
    await repo.findWebauthnCredentialById("u-1", "cred-abc");
    expect(lastSetUserIdParam()).toBe("u-1");
    const selectCall = clientQueryMock.mock.calls.find(([sql]) =>
      (sql as string).includes("FROM mfa_webauthn_credentials"),
    );
    expect(selectCall).toBeDefined();
    const [sql, params] = selectCall as [string, unknown[]];
    expect(sql).toContain("user_id = $2");
    expect(params).toEqual(["cred-abc", "u-1"]);
  });

  it("insertWebauthnCredential uses the input.userId for the GUC", async () => {
    clientQueryMock.mockImplementation(async (sql: string) => {
      if (sql.startsWith("INSERT INTO mfa_webauthn_credentials")) {
        return {
          rows: [
            {
              id: "row-1",
              user_id: "u-1",
              credential_id: "cred-abc",
              public_key: Buffer.from("k"),
              sign_count: "0",
              transports: [],
              device_name: null,
              aaguid: null,
              backed_up: false,
              created_at: new Date(),
              last_used_at: null,
            },
          ],
        };
      }
      return { rows: [] };
    });
    await repo.insertWebauthnCredential({
      userId: "u-1",
      credentialId: "cred-abc",
      publicKey: Buffer.from("k"),
      signCount: 0n,
      transports: [],
    });
    expect(lastSetUserIdParam()).toBe("u-1");
  });

  it("updateWebauthnSignCount scopes by userId in both the GUC and the WHERE clause", async () => {
    await repo.updateWebauthnSignCount("u-1", "cred-abc", 5n, new Date(0));
    expect(lastSetUserIdParam()).toBe("u-1");
    const updateCall = clientQueryMock.mock.calls.find(([sql]) =>
      (sql as string).startsWith("UPDATE mfa_webauthn_credentials"),
    );
    expect(updateCall).toBeDefined();
    expect(updateCall![0]).toContain("user_id = $4");
  });

  it("deleteWebauthnCredential runs inside withUserContext", async () => {
    clientQueryMock.mockResolvedValue({ rows: [], rowCount: 0 });
    await repo.deleteWebauthnCredential("u-1", "cred-abc");
    expect(lastSetUserIdParam()).toBe("u-1");
  });

  it("replaceRecoveryCodes runs DELETE + per-code INSERTs inside one user-context transaction", async () => {
    await repo.replaceRecoveryCodes("u-1", ["h1", "h2", "h3"]);
    expect(lastSetUserIdParam()).toBe("u-1");
    // Only ONE connect/BEGIN/COMMIT for the whole replace operation.
    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(sqlCalls().filter((s) => s === "BEGIN")).toHaveLength(1);
    expect(sqlCalls().filter((s) => s === "COMMIT")).toHaveLength(1);
    expect(sqlCalls().filter((s) => s.startsWith("INSERT INTO mfa_recovery_codes"))).toHaveLength(3);
  });

  it("countActiveRecoveryCodes runs inside withUserContext", async () => {
    clientQueryMock.mockResolvedValue({ rows: [{ count: "7" }], rowCount: 1 });
    // The BEGIN / set_config / COMMIT also resolve via the default mock.
    const n = await repo.countActiveRecoveryCodes("u-1");
    expect(n).toBe(7);
    expect(lastSetUserIdParam()).toBe("u-1");
  });

  it("consumeRecoveryCode runs SELECT + UPDATE inside one user-context transaction", async () => {
    clientQueryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM mfa_recovery_codes")) {
        return { rows: [{ id: "rc-1", code_hash: "h1" }] };
      }
      return { rows: [] };
    });
    const ok = await repo.consumeRecoveryCode("u-1", async () => true);
    expect(ok).toBe(true);
    expect(lastSetUserIdParam()).toBe("u-1");
    expect(connectMock).toHaveBeenCalledTimes(1);
  });

  it("getPolicy runs inside withUserContext and returns null on no row", async () => {
    const result = await repo.getPolicy("u-1");
    expect(result).toBeNull();
    expect(lastSetUserIdParam()).toBe("u-1");
  });

  it("upsertPolicy runs inside withUserContext", async () => {
    clientQueryMock.mockImplementation(async (sql: string) => {
      if (sql.startsWith("INSERT INTO user_mfa_policy")) {
        return {
          rows: [
            {
              user_id: "u-1",
              has_webauthn: false,
              has_totp: true,
              recovery_codes_issued_at: null,
              enrollment_completed_at: new Date(),
              last_verified_at: null,
              last_verified_method: null,
              created_at: new Date(),
              updated_at: new Date(),
            },
          ],
        };
      }
      return { rows: [] };
    });
    const policy = await repo.upsertPolicy("u-1", { hasTotp: true });
    expect(policy.userId).toBe("u-1");
    expect(lastSetUserIdParam()).toBe("u-1");
  });
});
