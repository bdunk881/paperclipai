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

  it("creates a new local user and identity when no match exists", async () => {
    queryPostgres
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "user-123",
            email: "alex@example.com",
            display_name: "Alex Example",
            avatar_url: "https://cdn.example.com/alex.png",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const user = await upsertLocalUserFromSocialProfile({
      provider: "google",
      providerSubject: "google-oauth-subject",
      email: "Alex@example.com",
      displayName: "Alex Example",
      avatarUrl: "https://cdn.example.com/alex.png",
      rawProfile: { id: "google-oauth-subject" },
    });

    expect(user).toEqual({
      id: "user-123",
      email: "alex@example.com",
      displayName: "Alex Example",
      avatarUrl: "https://cdn.example.com/alex.png",
    });
    expect(queryPostgres).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("WHERE email_normalized = $1"),
      ["alex@example.com"]
    );
    expect(queryPostgres).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("INSERT INTO auth_users"),
      ["Alex@example.com", "alex@example.com", "Alex Example", "https://cdn.example.com/alex.png"]
    );
    expect(queryPostgres).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining("INSERT INTO auth_user_identities"),
      [
        "google",
        "google-oauth-subject",
        "user-123",
        "Alex@example.com",
        JSON.stringify({ id: "google-oauth-subject" }),
      ]
    );
  });

  it("reuses an existing local user matched by provider identity", async () => {
    queryPostgres
      .mockResolvedValueOnce({
        rows: [
          {
            id: "user-identity",
            email: "alex@example.com",
            display_name: "Stored Alex",
            avatar_url: null,
            provider_profile: { id: "google-oauth-subject" },
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "user-identity",
            email: "alex@example.com",
            display_name: "Alex Example",
            avatar_url: "https://cdn.example.com/alex.png",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const user = await upsertLocalUserFromSocialProfile({
      provider: "google",
      providerSubject: "google-oauth-subject",
      email: "alex@example.com",
      displayName: "Alex Example",
      avatarUrl: "https://cdn.example.com/alex.png",
      rawProfile: { id: "google-oauth-subject" },
    });

    expect(user.id).toBe("user-identity");
    expect(queryPostgres).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("UPDATE auth_users"),
      [
        "user-identity",
        "alex@example.com",
        "alex@example.com",
        "Alex Example",
        "https://cdn.example.com/alex.png",
      ]
    );
  });
});
