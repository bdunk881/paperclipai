import { readFileSync } from "fs";
import path from "path";

describe("keyVaultSecrets contract", () => {
  it("maps Apollo OAuth Key Vault entries into runtime env vars", () => {
    const source = readFileSync(path.join(__dirname, "keyVaultSecrets.ts"), "utf8");

    expect(source).toContain('"apollo-client-id": "APOLLO_CLIENT_ID"');
    expect(source).toContain('"apollo-client-secret": "APOLLO_CLIENT_SECRET"');
    expect(source).toContain('"apollo-redirect-uri": "APOLLO_REDIRECT_URI"');
    expect(source).toContain('"apollo-webhook-secret": "APOLLO_WEBHOOK_SECRET"');
  });
});
