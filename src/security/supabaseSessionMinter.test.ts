/**
 * Unit coverage for the passwordless-login session bridge. Mocks both the
 * service-role admin client (getUserById + generateLink) and the anon client
 * (verifyOtp) so we can assert the magic-link → verifyOtp handshake without a
 * live Supabase project.
 */

const getUserByIdMock = jest.fn();
const generateLinkMock = jest.fn();
const verifyOtpMock = jest.fn();
const isAdminConfiguredMock = jest.fn(() => true);

jest.mock("../adminConsole/supabaseAdminClient", () => ({
  isSupabaseAdminConfigured: () => isAdminConfiguredMock(),
  getSupabaseAdminClient: () => ({
    auth: { admin: { getUserById: getUserByIdMock, generateLink: generateLinkMock } },
  }),
}));

jest.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: { verifyOtp: verifyOtpMock } }),
}));

import {
  isSupabaseSessionMintingConfigured,
  mintSupabaseSessionForUser,
  SupabaseUserNotFoundError,
} from "./supabaseSessionMinter";

describe("supabaseSessionMinter", () => {
  const env = { ...process.env };

  beforeEach(() => {
    getUserByIdMock.mockReset();
    generateLinkMock.mockReset();
    verifyOtpMock.mockReset();
    isAdminConfiguredMock.mockReturnValue(true);
    process.env.SUPABASE_URL = "https://proj.supabase.co";
    process.env.SUPABASE_PUBLISHABLE_KEY = "anon-key";
  });

  afterAll(() => {
    process.env = env;
  });

  it("reports configured only when admin + url + anon key are all present", () => {
    expect(isSupabaseSessionMintingConfigured()).toBe(true);
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
    expect(isSupabaseSessionMintingConfigured()).toBe(false);
    process.env.SUPABASE_PUBLISHABLE_KEY = "anon-key";
    isAdminConfiguredMock.mockReturnValue(false);
    expect(isSupabaseSessionMintingConfigured()).toBe(false);
  });

  it("bridges generateLink → verifyOtp into a session", async () => {
    getUserByIdMock.mockResolvedValue({ data: { user: { id: "u-1", email: "u@example.com" } }, error: null });
    generateLinkMock.mockResolvedValue({ data: { properties: { hashed_token: "hashed-123" } }, error: null });
    verifyOtpMock.mockResolvedValue({
      data: { session: { access_token: "at", refresh_token: "rt", expires_at: 999 } },
      error: null,
    });

    const session = await mintSupabaseSessionForUser("u-1");

    expect(generateLinkMock).toHaveBeenCalledWith({ type: "magiclink", email: "u@example.com" });
    expect(verifyOtpMock).toHaveBeenCalledWith({ type: "magiclink", token_hash: "hashed-123" });
    expect(session).toEqual({
      accessToken: "at",
      refreshToken: "rt",
      expiresAt: 999,
      user: { id: "u-1", email: "u@example.com" },
    });
  });

  it("throws SupabaseUserNotFoundError when the account is gone (orphaned passkey)", async () => {
    getUserByIdMock.mockResolvedValue({ data: { user: null }, error: { message: "404: User not found" } });
    const err = await mintSupabaseSessionForUser("2b4a7dfb").catch((e) => e);
    expect(err).toBeInstanceOf(SupabaseUserNotFoundError);
    expect((err as SupabaseUserNotFoundError).userId).toBe("2b4a7dfb");
    expect(generateLinkMock).not.toHaveBeenCalled();
  });

  it("throws when the user has no email", async () => {
    getUserByIdMock.mockResolvedValue({ data: { user: { id: "u-1", email: null } }, error: null });
    await expect(mintSupabaseSessionForUser("u-1")).rejects.toThrow(/resolve email/i);
    expect(generateLinkMock).not.toHaveBeenCalled();
  });

  it("throws when generateLink returns no token hash", async () => {
    getUserByIdMock.mockResolvedValue({ data: { user: { id: "u-1", email: "u@example.com" } }, error: null });
    generateLinkMock.mockResolvedValue({ data: { properties: {} }, error: null });
    await expect(mintSupabaseSessionForUser("u-1")).rejects.toThrow(/generateLink/i);
    expect(verifyOtpMock).not.toHaveBeenCalled();
  });

  it("throws when verifyOtp yields no session", async () => {
    getUserByIdMock.mockResolvedValue({ data: { user: { id: "u-1", email: "u@example.com" } }, error: null });
    generateLinkMock.mockResolvedValue({ data: { properties: { hashed_token: "h" } }, error: null });
    verifyOtpMock.mockResolvedValue({ data: { session: null }, error: { message: "bad" } });
    await expect(mintSupabaseSessionForUser("u-1")).rejects.toThrow(/verifyOtp/i);
  });
});
