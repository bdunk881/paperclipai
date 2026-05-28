import {
  REQUIRE_APP_MFA_FOR_OAUTH_USERS,
  __resetWorkspaceFlagCacheForTests,
  isWorkspaceFlagEnabled,
} from "./workspaceFeatureFlags";

const queryPostgresMock = jest.fn();

jest.mock("../db/postgres", () => ({
  isPostgresPersistenceEnabled: () => true,
  queryPostgres: (sql: string, params: unknown[]) => queryPostgresMock(sql, params),
}));

describe("isWorkspaceFlagEnabled (HEL-280)", () => {
  beforeEach(() => {
    queryPostgresMock.mockReset();
    __resetWorkspaceFlagCacheForTests();
  });

  it("returns false when no workspaceId is provided (no DB hit)", async () => {
    await expect(isWorkspaceFlagEnabled(null, REQUIRE_APP_MFA_FOR_OAUTH_USERS)).resolves.toBe(false);
    await expect(isWorkspaceFlagEnabled(undefined, REQUIRE_APP_MFA_FOR_OAUTH_USERS)).resolves.toBe(false);
    expect(queryPostgresMock).not.toHaveBeenCalled();
  });

  it("returns false when the row does not exist", async () => {
    queryPostgresMock.mockResolvedValueOnce({ rows: [] });
    await expect(isWorkspaceFlagEnabled("ws-1", REQUIRE_APP_MFA_FOR_OAUTH_USERS)).resolves.toBe(false);
    expect(queryPostgresMock).toHaveBeenCalledTimes(1);
  });

  it("returns true when the row is enabled and not expired", async () => {
    queryPostgresMock.mockResolvedValueOnce({ rows: [{ enabled: true, expires_at: null }] });
    await expect(isWorkspaceFlagEnabled("ws-1", REQUIRE_APP_MFA_FOR_OAUTH_USERS)).resolves.toBe(true);
  });

  it("returns false when the row is expired", async () => {
    const past = new Date(Date.now() - 1000);
    queryPostgresMock.mockResolvedValueOnce({ rows: [{ enabled: true, expires_at: past }] });
    await expect(isWorkspaceFlagEnabled("ws-1", REQUIRE_APP_MFA_FOR_OAUTH_USERS)).resolves.toBe(false);
  });

  it("returns false when enabled=false even if not expired", async () => {
    queryPostgresMock.mockResolvedValueOnce({ rows: [{ enabled: false, expires_at: null }] });
    await expect(isWorkspaceFlagEnabled("ws-1", REQUIRE_APP_MFA_FOR_OAUTH_USERS)).resolves.toBe(false);
  });

  it("caches results so a second call within TTL does not re-hit the DB", async () => {
    queryPostgresMock.mockResolvedValueOnce({ rows: [{ enabled: true, expires_at: null }] });
    await isWorkspaceFlagEnabled("ws-1", REQUIRE_APP_MFA_FOR_OAUTH_USERS);
    await isWorkspaceFlagEnabled("ws-1", REQUIRE_APP_MFA_FOR_OAUTH_USERS);
    expect(queryPostgresMock).toHaveBeenCalledTimes(1);
  });
});
