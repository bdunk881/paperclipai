import express from "express";
import request from "supertest";
import { createApiKeyRoutes } from "./apiKeyRoutes";
import { ApiKeyStore } from "./apiKeyStore";

function buildApp(
  store: ApiKeyStore,
  options: { userId?: string | null; workspaceId?: string | null } = {},
) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const typed = req as typeof req & { auth?: { sub: string }; workspaceId?: string };
    if (options.userId !== null) {
      typed.auth = { sub: options.userId ?? "user-1" };
    }
    if (options.workspaceId !== null) {
      typed.workspaceId = options.workspaceId ?? "workspace-1";
    }
    next();
  });
  app.use("/api/api-keys", createApiKeyRoutes(store));
  return app;
}

describe("apiKeyRoutes", () => {
  let store: ApiKeyStore;

  beforeEach(() => {
    store = new ApiKeyStore();
  });

  it("creates a key, returns the secret once, and lists only masked metadata", async () => {
    const app = buildApp(store);

    const createRes = await request(app)
      .post("/api/api-keys")
      .send({ name: "Production automation" });

    expect(createRes.status).toBe(201);
    expect(createRes.body.secret).toMatch(/^afk_/);
    expect(createRes.body.key.name).toBe("Production automation");
    expect(createRes.body.key.maskedKey).toMatch(/^afk_.+\.\.\..{4}$/);

    const listRes = await request(app).get("/api/api-keys");
    expect(listRes.status).toBe(200);
    expect(listRes.body.total).toBe(1);
    expect(listRes.body.keys[0].maskedKey).toBe(createRes.body.key.maskedKey);
    expect(JSON.stringify(listRes.body)).not.toContain(createRes.body.secret);
  });

  it("rotates a key by revoking the old row and returning a new one-time secret", async () => {
    const app = buildApp(store);
    const created = await request(app)
      .post("/api/api-keys")
      .send({ name: "CLI access" });

    const rotateRes = await request(app)
      .post(`/api/api-keys/${created.body.key.id}/rotate`)
      .send();

    expect(rotateRes.status).toBe(200);
    expect(rotateRes.body.secret).toMatch(/^afk_/);
    expect(rotateRes.body.secret).not.toBe(created.body.secret);
    expect(rotateRes.body.key.rotatedFromKeyId).toBe(created.body.key.id);

    const listRes = await request(app).get("/api/api-keys");
    expect(listRes.body.keys).toHaveLength(2);
    const oldKey = listRes.body.keys.find((key: { id: string }) => key.id === created.body.key.id);
    expect(oldKey.revokedAt).toEqual(expect.any(String));
  });

  it("revokes keys and blocks cross-workspace access", async () => {
    const ws1 = buildApp(store, { workspaceId: "workspace-1" });
    const created = await request(ws1)
      .post("/api/api-keys")
      .send({ name: "Support console" });

    const ws2 = buildApp(store, { workspaceId: "workspace-2" });
    const foreignRevoke = await request(ws2).delete(`/api/api-keys/${created.body.key.id}`);
    expect(foreignRevoke.status).toBe(404);
    expect((await request(ws2).get("/api/api-keys")).body.keys).toEqual([]);

    const revokeRes = await request(ws1).delete(`/api/api-keys/${created.body.key.id}`);
    expect(revokeRes.status).toBe(204);

    const rotateRevoked = await request(ws1).post(`/api/api-keys/${created.body.key.id}/rotate`);
    expect(rotateRevoked.status).toBe(409);
  });

  it("validates auth, workspace context, and name", async () => {
    expect((await request(buildApp(store, { userId: null })).get("/api/api-keys")).status).toBe(401);
    expect((await request(buildApp(store, { workspaceId: null })).get("/api/api-keys")).status).toBe(400);
    const badName = await request(buildApp(store)).post("/api/api-keys").send({ name: "  " });
    expect(badName.status).toBe(400);
  });
});
