import { CentralCredentialStore } from "./centralCredentialStore";

describe("CentralCredentialStore", () => {
  it("stores encrypted secret bundles and decrypts them by record id", () => {
    const store = new CentralCredentialStore<{ accountId: string }, { apiKey?: string; refreshToken?: string }>({
      service: "central-store-basic",
    });

    const created = store.create({
      userId: "user-1",
      authMethod: "api_key",
      label: "Primary",
      metadata: { accountId: "acct_123" },
      secrets: { apiKey: "secret-1234", refreshToken: "refresh-5678" },
    });

    expect(created.secretPayloadEncrypted).not.toContain("secret-1234");

    const decrypted = store.getDecrypted(created.id);
    expect(decrypted?.record.label).toBe("Primary");
    expect(decrypted?.secrets).toEqual({
      apiKey: "secret-1234",
      refreshToken: "refresh-5678",
    });
  });

  it("keeps service buckets isolated while supporting different auth methods", () => {
    const oauthStore = new CentralCredentialStore<{ teamId: string }, { accessToken: string }>({
      service: "central-store-oauth",
    });
    const basicStore = new CentralCredentialStore<{ host: string }, { username: string; password: string }>({
      service: "central-store-basic-auth",
    });

    oauthStore.create({
      userId: "user-1",
      authMethod: "oauth2_pkce",
      label: "OAuth",
      metadata: { teamId: "T123" },
      secrets: { accessToken: "oauth-token-1234" },
    });
    basicStore.create({
      userId: "user-1",
      authMethod: "basic",
      label: "Basic",
      metadata: { host: "https://api.example.com" },
      secrets: { username: "alice", password: "password-9999" },
    });

    expect(oauthStore.listByUser("user-1")).toHaveLength(1);
    expect(oauthStore.listByUser("user-1")[0].authMethod).toBe("oauth2_pkce");
    expect(basicStore.listByUser("user-1")).toHaveLength(1);
    expect(basicStore.listByUser("user-1")[0].authMethod).toBe("basic");
  });
});
