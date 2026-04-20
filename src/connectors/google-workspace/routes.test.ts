import { createHmac } from "crypto";
import express from "express";
import request from "supertest";
import { googleWorkspaceCredentialsStore } from "./credentialsStore";
import googleWorkspaceRoutes from "./routes";
import googleWorkspaceWebhookRoutes from "./webhookRoutes";

const USER_A = "user-alice";
const USER_B = "user-bob";

function asUser(userId: string) {
  return { "x-user-id": userId };
}

function createTestApp() {
  const app = express();
  app.use("/api/connectors/google-workspace", googleWorkspaceWebhookRoutes);
  app.use(express.json());
  app.use("/api/connectors/google-workspace", googleWorkspaceRoutes);
  return app;
}

beforeEach(() => {
  googleWorkspaceCredentialsStore.clear();
});

describe("Google Workspace connector credential entry", () => {
  it("creates OAuth credentials and never returns raw secret", async () => {
    const app = createTestApp();
    const res = await request(app)
      .post("/api/connectors/google-workspace/credentials")
      .set(asUser(USER_A))
      .send({
        authMethod: "oauth_pkce",
        label: "Google Workspace OAuth",
        clientId: "google-client-id",
        clientSecret: "google-super-secret",
        redirectUri: "https://app.autoflow.ai/oauth/callback/google-workspace",
        scopesRequested: ["https://www.googleapis.com/auth/drive.readonly"],
      });

    expect(res.status).toBe(201);
    expect(res.body.authMethod).toBe("oauth_pkce");
    expect(res.body.oauthClientSecretEncrypted).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain("super-secret");
  });

  it("creates API-key credentials with masked key", async () => {
    const app = createTestApp();
    const res = await request(app)
      .post("/api/connectors/google-workspace/credentials")
      .set(asUser(USER_A))
      .send({
        authMethod: "api_key",
        label: "Google Workspace API Key",
        apiKey: "google-api-key-123456",
      });

    expect(res.status).toBe(201);
    expect(res.body.authMethod).toBe("api_key");
    expect(res.body.apiKeyMasked).toBe("****3456");
    expect(res.body.apiKeyEncrypted).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain("123456");
  });

  it("lists only current user's credentials", async () => {
    const app = createTestApp();
    await request(app)
      .post("/api/connectors/google-workspace/credentials")
      .set(asUser(USER_A))
      .send({ authMethod: "api_key", label: "Alice key", apiKey: "alice-google-key-1111" });

    await request(app)
      .post("/api/connectors/google-workspace/credentials")
      .set(asUser(USER_B))
      .send({ authMethod: "api_key", label: "Bob key", apiKey: "bob-google-key-2222" });

    const listA = await request(app)
      .get("/api/connectors/google-workspace/credentials")
      .set(asUser(USER_A));

    expect(listA.status).toBe(200);
    expect(listA.body.total).toBe(1);
    expect(listA.body.credentials[0].label).toBe("Alice key");
  });

  it("stores OAuth tokens and marks credential active", async () => {
    const app = createTestApp();
    const created = await request(app)
      .post("/api/connectors/google-workspace/credentials")
      .set(asUser(USER_A))
      .send({
        authMethod: "oauth_pkce",
        label: "Google Workspace OAuth",
        clientId: "google-client-id",
        clientSecret: "google-super-secret",
        redirectUri: "https://app.autoflow.ai/oauth/callback/google-workspace",
      });

    const tokenRes = await request(app)
      .post(`/api/connectors/google-workspace/credentials/${created.body.id}/oauth/tokens`)
      .set(asUser(USER_A))
      .send({
        accessToken: "ya29.access-token-123456789",
        refreshToken: "1//refresh-token-abcdefghij",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        scopesGranted: ["https://www.googleapis.com/auth/drive.readonly"],
      });

    expect(tokenRes.status).toBe(200);
    expect(tokenRes.body.status).toBe("active");
    expect(typeof tokenRes.body.lastValidatedAt).toBe("string");
  });

  it("rejects webhook replay and invalid signatures", async () => {
    const app = createTestApp();
    const created = await request(app)
      .post("/api/connectors/google-workspace/credentials")
      .set(asUser(USER_A))
      .send({
        authMethod: "api_key",
        label: "Google Workspace API Key",
        apiKey: "google-api-key-999999",
        webhookSigningSecret: "google-webhook-secret",
      });

    const body = JSON.stringify({ type: "sync" });
    const signature = `sha256=${createHmac("sha256", "google-webhook-secret").update(body).digest("hex")}`;

    const invalid = await request(app)
      .post(`/api/connectors/google-workspace/webhooks/${created.body.id}`)
      .set("x-goog-message-number", "1")
      .set("x-goog-resource-state", "exists")
      .set("x-autoflow-signature", "sha256=bad")
      .send(body);

    expect(invalid.status).toBe(401);

    const accepted = await request(app)
      .post(`/api/connectors/google-workspace/webhooks/${created.body.id}`)
      .set("content-type", "application/json")
      .set("x-goog-message-number", "1")
      .set("x-goog-resource-state", "exists")
      .set("x-autoflow-signature", signature)
      .send(body);

    expect(accepted.status).toBe(202);

    const replay = await request(app)
      .post(`/api/connectors/google-workspace/webhooks/${created.body.id}`)
      .set("content-type", "application/json")
      .set("x-goog-message-number", "1")
      .set("x-goog-resource-state", "exists")
      .set("x-autoflow-signature", signature)
      .send(body);

    expect(replay.status).toBe(409);
  });

  it("returns connector health and revoked status", async () => {
    const app = createTestApp();
    const created = await request(app)
      .post("/api/connectors/google-workspace/credentials")
      .set(asUser(USER_A))
      .send({ authMethod: "api_key", label: "Google key", apiKey: "google-api-key-7777" });

    const revokeRes = await request(app)
      .delete(`/api/connectors/google-workspace/credentials/${created.body.id}`)
      .set(asUser(USER_A));

    expect(revokeRes.status).toBe(200);
    expect(revokeRes.body.status).toBe("revoked");

    const health = await request(app)
      .get("/api/connectors/google-workspace/health")
      .set(asUser(USER_A));

    expect(health.status).toBe(200);
    expect(health.body.connector).toBe("google_workspace");
    expect(health.body.total).toBe(1);
    expect(health.body.revoked).toBe(1);
    expect(health.body.status).toBe("degraded");
  });
});
