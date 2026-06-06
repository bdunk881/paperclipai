import {
  isComposioEnabled,
  composioApiKeyOrThrow,
  composioUserId,
  workspaceIdFromComposioUserId,
  warnIfComposioUnconfigured,
  resetComposioConfigWarningForTests,
} from "./config";

describe("composio broker config (HEL-721)", () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    resetComposioConfigWarningForTests();
  });

  describe("isComposioEnabled", () => {
    it("is false when the flag is off, even with a key", () => {
      process.env.COMPOSIO_ENABLED = "false";
      process.env.COMPOSIO_API_KEY = "ck_test";
      expect(isComposioEnabled()).toBe(false);
    });

    it("is false when the flag is on but the key is missing", () => {
      process.env.COMPOSIO_ENABLED = "true";
      delete process.env.COMPOSIO_API_KEY;
      expect(isComposioEnabled()).toBe(false);
    });

    it("is true only when the flag is on AND a key is present", () => {
      process.env.COMPOSIO_ENABLED = "true";
      process.env.COMPOSIO_API_KEY = "ck_test";
      expect(isComposioEnabled()).toBe(true);
    });
  });

  describe("composioApiKeyOrThrow", () => {
    it("throws a clear error when unset", () => {
      delete process.env.COMPOSIO_API_KEY;
      expect(() => composioApiKeyOrThrow()).toThrow(/COMPOSIO_API_KEY is not set/);
    });

    it("returns the trimmed key", () => {
      process.env.COMPOSIO_API_KEY = "  ck_test  ";
      expect(composioApiKeyOrThrow()).toBe("ck_test");
    });
  });

  describe("composioUserId — the tenancy seam of the shared-project model", () => {
    it("prefixes the workspaceId with ws_", () => {
      expect(composioUserId("ws-123")).toBe("ws_ws-123");
    });

    it("throws on an empty/blank workspaceId (tenancy guard)", () => {
      expect(() => composioUserId("")).toThrow(/workspaceId/);
      expect(() => composioUserId("   ")).toThrow(/workspaceId/);
    });

    it("round-trips with workspaceIdFromComposioUserId", () => {
      expect(workspaceIdFromComposioUserId(composioUserId("abc"))).toBe("abc");
    });

    it("returns null for non-broker userIds", () => {
      expect(workspaceIdFromComposioUserId("user_123")).toBeNull();
      expect(workspaceIdFromComposioUserId("ws_")).toBeNull();
      expect(workspaceIdFromComposioUserId("")).toBeNull();
    });
  });

  describe("warnIfComposioUnconfigured", () => {
    it("warns exactly once when the flag is on but the key is missing", () => {
      process.env.COMPOSIO_ENABLED = "true";
      delete process.env.COMPOSIO_API_KEY;
      const log = jest.fn();
      warnIfComposioUnconfigured(log);
      warnIfComposioUnconfigured(log);
      expect(log).toHaveBeenCalledTimes(1);
      expect(log.mock.calls[0][0]).toMatch(/COMPOSIO_API_KEY is unset/);
    });

    it("does not warn when properly configured", () => {
      process.env.COMPOSIO_ENABLED = "true";
      process.env.COMPOSIO_API_KEY = "ck_test";
      const log = jest.fn();
      warnIfComposioUnconfigured(log);
      expect(log).not.toHaveBeenCalled();
    });

    it("does not warn when the flag is off", () => {
      process.env.COMPOSIO_ENABLED = "false";
      delete process.env.COMPOSIO_API_KEY;
      const log = jest.fn();
      warnIfComposioUnconfigured(log);
      expect(log).not.toHaveBeenCalled();
    });

    it("warns on a deployed env when the OAuth redirect origins are unset (HEL-750)", () => {
      process.env.COMPOSIO_ENABLED = "true";
      process.env.COMPOSIO_API_KEY = "ck_test";
      process.env.NODE_ENV = "production";
      delete process.env.DASHBOARD_APP_URL;
      delete process.env.COMPOSIO_REDIRECT_BASE_URL;
      const log = jest.fn();
      warnIfComposioUnconfigured(log);
      const messages = log.mock.calls.map((c) => c[0]).join("\n");
      expect(messages).toMatch(/DASHBOARD_APP_URL is unset/);
      expect(messages).toMatch(/COMPOSIO_REDIRECT_BASE_URL is unset/);
    });

    it("does not warn about redirects when the origins are pinned", () => {
      process.env.COMPOSIO_ENABLED = "true";
      process.env.COMPOSIO_API_KEY = "ck_test";
      process.env.NODE_ENV = "production";
      process.env.DASHBOARD_APP_URL = "https://dev.helloautoflow.com";
      process.env.COMPOSIO_REDIRECT_BASE_URL = "https://dev-api.helloautoflow.com";
      const log = jest.fn();
      warnIfComposioUnconfigured(log);
      expect(log).not.toHaveBeenCalled();
    });

    it("does not warn about redirects on a non-deployed (local) env", () => {
      process.env.COMPOSIO_ENABLED = "true";
      process.env.COMPOSIO_API_KEY = "ck_test";
      process.env.NODE_ENV = "development";
      delete process.env.DASHBOARD_APP_URL;
      delete process.env.COMPOSIO_REDIRECT_BASE_URL;
      const log = jest.fn();
      warnIfComposioUnconfigured(log);
      expect(log).not.toHaveBeenCalled();
    });
  });
});
