import {
  REQUIRE_APP_MFA_FOR_OAUTH_USERS,
  __resetWorkspaceFlagCacheForTests,
  isWorkspaceFlagEnabled,
} from "./workspaceFeatureFlags";

const clientQueryMock = jest.fn();
const releaseMock = jest.fn();
const connectMock = jest.fn(async () => ({
  query: (sql: string, params?: unknown[]) => clientQueryMock(sql, params),
  release: releaseMock,
}));

jest.mock("../db/postgres", () => ({
  isPostgresPersistenceEnabled: () => true,
  getPostgresPool: () => ({ connect: connectMock }),
}));

// HEL-298: helper that returns the result row from the SELECT against
// workspace_feature_overrides while still simulating the BEGIN /
// set_config / COMMIT sequence withWorkspaceContext runs.
function mockTransactionWithRow(row: { enabled: boolean; expires_at: Date | null } | null): void {
  clientQueryMock.mockReset();
  clientQueryMock
    .mockResolvedValueOnce({ rows: [] }) // BEGIN
    .mockResolvedValueOnce({ rows: [] }) // set_config workspace
    .mockResolvedValueOnce({ rows: [] }) // set_config user
    .mockResolvedValueOnce({ rows: row ? [row] : [] }) // SELECT
    .mockResolvedValueOnce({ rows: [] }); // COMMIT
}

describe("isWorkspaceFlagEnabled (HEL-280, RLS-aware after HEL-298)", () => {
  beforeEach(() => {
    clientQueryMock.mockReset();
    releaseMock.mockReset();
    connectMock.mockClear();
    __resetWorkspaceFlagCacheForTests();
  });

  it("returns false when no workspaceId is provided (no DB hit)", async () => {
    await expect(
      isWorkspaceFlagEnabled(null, "u-1", REQUIRE_APP_MFA_FOR_OAUTH_USERS),
    ).resolves.toBe(false);
    await expect(
      isWorkspaceFlagEnabled(undefined, "u-1", REQUIRE_APP_MFA_FOR_OAUTH_USERS),
    ).resolves.toBe(false);
    expect(connectMock).not.toHaveBeenCalled();
  });

  it("returns false when no userId is provided (no DB hit)", async () => {
    await expect(
      isWorkspaceFlagEnabled("ws-1", null, REQUIRE_APP_MFA_FOR_OAUTH_USERS),
    ).resolves.toBe(false);
    expect(connectMock).not.toHaveBeenCalled();
  });

  it("returns false when the row does not exist", async () => {
    mockTransactionWithRow(null);
    await expect(
      isWorkspaceFlagEnabled("ws-1", "u-1", REQUIRE_APP_MFA_FOR_OAUTH_USERS),
    ).resolves.toBe(false);
    expect(connectMock).toHaveBeenCalledTimes(1);
  });

  it("returns true when the row is enabled and not expired", async () => {
    mockTransactionWithRow({ enabled: true, expires_at: null });
    await expect(
      isWorkspaceFlagEnabled("ws-1", "u-1", REQUIRE_APP_MFA_FOR_OAUTH_USERS),
    ).resolves.toBe(true);
  });

  it("returns false when the row is expired", async () => {
    const past = new Date(Date.now() - 1000);
    mockTransactionWithRow({ enabled: true, expires_at: past });
    await expect(
      isWorkspaceFlagEnabled("ws-1", "u-1", REQUIRE_APP_MFA_FOR_OAUTH_USERS),
    ).resolves.toBe(false);
  });

  it("returns false when enabled=false even if not expired", async () => {
    mockTransactionWithRow({ enabled: false, expires_at: null });
    await expect(
      isWorkspaceFlagEnabled("ws-1", "u-1", REQUIRE_APP_MFA_FOR_OAUTH_USERS),
    ).resolves.toBe(false);
  });

  it("caches results so a second call within TTL does not re-hit the DB", async () => {
    mockTransactionWithRow({ enabled: true, expires_at: null });
    await isWorkspaceFlagEnabled("ws-1", "u-1", REQUIRE_APP_MFA_FOR_OAUTH_USERS);
    await isWorkspaceFlagEnabled("ws-1", "u-1", REQUIRE_APP_MFA_FOR_OAUTH_USERS);
    expect(connectMock).toHaveBeenCalledTimes(1);
  });

  it("sets both workspace and user GUCs before reading the override row", async () => {
    mockTransactionWithRow({ enabled: true, expires_at: null });
    await isWorkspaceFlagEnabled("ws-1", "u-1", REQUIRE_APP_MFA_FOR_OAUTH_USERS);

    // BEGIN, then SET workspace, then SET user, then SELECT, then COMMIT.
    const sqls = clientQueryMock.mock.calls.map(([sql]) => sql as string);
    expect(sqls[0]).toBe("BEGIN");
    expect(sqls[1]).toContain("app.current_workspace_id");
    expect(sqls[2]).toContain("app.current_user_id");
    expect(sqls[3]).toContain("FROM workspace_feature_overrides");
    expect(sqls[4]).toBe("COMMIT");
  });
});
