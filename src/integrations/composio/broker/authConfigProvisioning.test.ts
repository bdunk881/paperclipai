import {
  provisionManagedAuthConfig,
  normalizeToolkitSlug,
  resetAuthConfigProvisioningForTests,
} from "./authConfigProvisioning";
import { getComposioBroker } from "./client";

jest.mock("./client", () => ({
  getComposioBroker: jest.fn(),
  resetComposioBrokerForTests: jest.fn(),
}));

const getBroker = getComposioBroker as jest.MockedFunction<typeof getComposioBroker>;

describe("authConfigProvisioning (HEL-739)", () => {
  const ORIGINAL_ENV = { ...process.env };
  const listMock = jest.fn();
  const createMock = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    resetAuthConfigProvisioningForTests();
    process.env = { ...ORIGINAL_ENV, COMPOSIO_ENABLED: "true", COMPOSIO_API_KEY: "ck_test" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getBroker.mockResolvedValue({ authConfigs: { list: listMock, create: createMock } } as any);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("creates a managed auth config on a cold cache when none exists, then caches it", async () => {
    listMock.mockResolvedValue({ items: [] });
    createMock.mockResolvedValue({ id: "ac_new", toolkit: "github", isComposioManaged: true });

    const first = await provisionManagedAuthConfig("GitHub");
    expect(first).toBe("ac_new");
    // toolkit normalized to a lowercase slug for the SDK call
    expect(createMock).toHaveBeenCalledWith("github", { type: "use_composio_managed_auth" });

    // Second call is served from cache — no extra create.
    const second = await provisionManagedAuthConfig("github");
    expect(second).toBe("ac_new");
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("reuses an existing ENABLED managed config without creating", async () => {
    listMock.mockResolvedValue({
      items: [{ id: "ac_existing", status: "ENABLED" }],
    });

    const result = await provisionManagedAuthConfig("github");
    expect(result).toBe("ac_existing");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("skips a DISABLED config and creates a fresh one", async () => {
    listMock.mockResolvedValue({
      items: [{ id: "ac_disabled", status: "DISABLED" }],
    });
    createMock.mockResolvedValue({ id: "ac_fresh" });

    const result = await provisionManagedAuthConfig("github");
    expect(result).toBe("ac_fresh");
  });

  it("falls back to create when list throws", async () => {
    listMock.mockRejectedValue(new Error("transient list failure"));
    createMock.mockResolvedValue({ id: "ac_fallback" });

    const result = await provisionManagedAuthConfig("github");
    expect(result).toBe("ac_fallback");
  });

  it("throws when the broker is disabled and nothing is cached", async () => {
    delete process.env.COMPOSIO_API_KEY;
    await expect(provisionManagedAuthConfig("github")).rejects.toThrow(/not enabled/i);
    expect(getBroker).not.toHaveBeenCalled();
  });

  it("normalizeToolkitSlug lowercases/trims and rejects empties", () => {
    expect(normalizeToolkitSlug("  GitHub ")).toBe("github");
    expect(() => normalizeToolkitSlug("")).toThrow(/non-empty toolkit/);
    expect(() => normalizeToolkitSlug("   ")).toThrow(/non-empty toolkit/);
  });
});
