import { SupabaseAuthTotpAdapter } from "./supabaseTotpAdapter";

/**
 * Regression coverage for the factor-listing endpoint. gotrue has no
 * `GET /factors` route (it responds 405), so `listFactors` must read the
 * `factors` array off `GET /user`. Without this, MfaService's
 * clear-stale-unverified-factors step silently no-ops and TOTP re-enrollment
 * keeps failing with a 422 friendly-name conflict.
 */
describe("SupabaseAuthTotpAdapter.listFactors", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = {
      ...ORIGINAL_ENV,
      SUPABASE_URL: "https://proj.supabase.co",
      SUPABASE_ANON_KEY: "anon-key",
    };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    jest.restoreAllMocks();
  });

  it("reads factors from GET /user and not the 405 /factors endpoint", async () => {
    const fetchMock = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          factors: [
            { id: "f-unverified", factor_type: "totp", status: "unverified", friendly_name: "a" },
            { id: "f-verified", factor_type: "totp", status: "verified", friendly_name: "b" },
            { id: "f-phone", factor_type: "phone", status: "unverified" },
            { id: "f-webauthn", factor_type: "webauthn", status: "verified" },
          ],
        }),
      } as unknown as Response);

    const adapter = new SupabaseAuthTotpAdapter();
    const factors = await adapter.listFactors("access-token");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = String((fetchMock.mock.calls[0] as unknown[])[0]);
    expect(calledUrl).toBe("https://proj.supabase.co/auth/v1/user");

    // Only totp + phone factors are returned (webauthn filtered out).
    expect(factors).toEqual([
      { id: "f-unverified", type: "totp", status: "unverified" },
      { id: "f-verified", type: "totp", status: "verified" },
      { id: "f-phone", type: "phone", status: "unverified" },
    ]);
  });

  it("returns an empty list when the user has no factors", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as unknown as Response);

    const adapter = new SupabaseAuthTotpAdapter();
    await expect(adapter.listFactors("access-token")).resolves.toEqual([]);
  });
});
