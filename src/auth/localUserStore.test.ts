import { upsertLocalUserFromSocialProfile } from "./localUserStore";

const queryPostgres = jest.fn();

jest.mock("../db/postgres", () => ({
  isPostgresConfigured: () => true,
  queryPostgres: (...args: unknown[]) => queryPostgres(...args),
}));

describe("localUserStore", () => {
  beforeEach(() => {
    queryPostgres.mockReset();
  });

  it("upserts a social auth user by provider identity", async () => {
    queryPostgres.mockResolvedValueOnce({
      rows: [
        {
          id: "user-123",
          email: "alex@example.com",
          display_name: "Alex Example",
        },
      ],
    });

    const user = await upsertLocalUserFromSocialProfile({
      provider: "google",
      providerSubject: "google-oauth-subject",
      email: "Alex@example.com",
      displayName: "Alex Example",
    });

    expect(user).toEqual({
      id: "user-123",
      email: "alex@example.com",
      displayName: "Alex Example",
    });
    expect(queryPostgres).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO social_auth_users"),
      ["alex@example.com", "Alex Example", "google", "google-oauth-subject"]
    );
  });

  it("rejects provider profiles without an email address", async () => {
    await expect(
      upsertLocalUserFromSocialProfile({
        provider: "google",
        providerSubject: "google-oauth-subject",
        email: null,
        displayName: "Alex Example",
      })
    ).rejects.toThrow(/missing an email address/i);

    expect(queryPostgres).not.toHaveBeenCalled();
  });
});
