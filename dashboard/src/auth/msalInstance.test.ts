import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getActiveAccountMock,
  getAllAccountsMock,
  handleRedirectPromiseMock,
  initializeMock,
  setActiveAccountMock,
} = vi.hoisted(() => ({
  getActiveAccountMock: vi.fn(),
  getAllAccountsMock: vi.fn(() => []),
  handleRedirectPromiseMock: vi.fn(() => Promise.resolve(null)),
  initializeMock: vi.fn(() => Promise.resolve()),
  setActiveAccountMock: vi.fn(),
}));

vi.mock("@azure/msal-browser", () => ({
  PublicClientApplication: vi.fn(() => ({
    getActiveAccount: getActiveAccountMock,
    getAllAccounts: getAllAccountsMock,
    handleRedirectPromise: handleRedirectPromiseMock,
    initialize: initializeMock,
    setActiveAccount: setActiveAccountMock,
  })),
}));

describe("initializeMsalInstance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getActiveAccountMock.mockReturnValue(null);
    getAllAccountsMock.mockReturnValue([]);
    handleRedirectPromiseMock.mockResolvedValue(null);
  });

  it("processes any pending redirect result before returning the singleton instance", async () => {
    const redirectAccount = {
      homeAccountId: "home-1",
      localAccountId: "local-1",
      tenantId: "tenant-1",
      username: "user@example.com",
      name: "Example User",
    };
    handleRedirectPromiseMock.mockResolvedValueOnce({ account: redirectAccount });

    const { initializeMsalInstance } = await import(`./msalInstance?ts=${Date.now()}`);
    await initializeMsalInstance();

    expect(initializeMock).toHaveBeenCalledTimes(1);
    expect(handleRedirectPromiseMock).toHaveBeenCalledTimes(1);
    expect(setActiveAccountMock).toHaveBeenCalledWith(redirectAccount);
  });
});
