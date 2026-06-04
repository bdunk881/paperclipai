import express from "express";
import request from "supertest";
import { createFileRoutes } from "./fileRoutes";
import { fileObjectStore } from "./fileObjectStore";
import { __resetStorageAdapterForTests } from "./index";

const WS_A = "11111111-1111-4111-8111-111111111111";
const WS_B = "22222222-2222-4222-8222-222222222222";

/** Mini app that stubs requireAuth + workspaceResolver (sets req.auth + req.workspaceId). */
function makeApp(ctx: { workspaceId: string; userId: string }): express.Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { auth: { sub: string } }).auth = { sub: ctx.userId };
    (req as unknown as { workspaceId: string }).workspaceId = ctx.workspaceId;
    next();
  });
  app.use("/api/files", createFileRoutes());
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: err.message });
  });
  return app;
}

const appA = () => makeApp({ workspaceId: WS_A, userId: "user-a" });
const appB = () => makeApp({ workspaceId: WS_B, userId: "user-b" });

function uploadUrl(app: express.Express, body: Record<string, unknown>) {
  return request(app).post("/api/files/upload-url").send(body);
}

describe("file routes (/api/files)", () => {
  let savedProvider: string | undefined;

  beforeAll(() => {
    savedProvider = process.env.STORAGE_PROVIDER;
    delete process.env.STORAGE_PROVIDER; // force the in-memory adapter
    process.env.AUTOFLOW_ALLOW_INMEMORY = "true";
  });

  afterAll(() => {
    if (savedProvider !== undefined) process.env.STORAGE_PROVIDER = savedProvider;
    __resetStorageAdapterForTests();
  });

  beforeEach(() => {
    fileObjectStore.__resetForTests();
    __resetStorageAdapterForTests();
  });

  it("POST /upload-url issues a signed PUT URL and creates a row", async () => {
    const res = await uploadUrl(appA(), {
      filename: "Report 2024.pdf",
      contentType: "application/pdf",
      sizeBytes: 1024,
    });
    expect(res.status).toBe(201);
    expect(res.body.fileId).toBeTruthy();
    expect(res.body.method).toBe("PUT");
    expect(res.body.uploadUrl).toMatch(/^memory:\/\//);
    expect(Date.parse(res.body.expiresAt)).toBeGreaterThan(0);
  });

  it("rejects a disallowed mime type with 400", async () => {
    const res = await uploadUrl(appA(), { filename: "evil.exe", contentType: "application/x-msdownload" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("mime_not_allowed");
  });

  it("rejects an oversize upload with 400", async () => {
    const res = await uploadUrl(appA(), {
      filename: "big.pdf",
      contentType: "application/pdf",
      sizeBytes: 60 * 1024 * 1024,
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("size_exceeded");
  });

  it("requires both filename and contentType", async () => {
    expect((await uploadUrl(appA(), { contentType: "application/pdf" })).status).toBe(400);
    expect((await uploadUrl(appA(), { filename: "a.pdf" })).status).toBe(400);
  });

  it("GET /:fileId 302-redirects the owner to a signed download URL", async () => {
    const app = appA();
    const created = await uploadUrl(app, { filename: "a.pdf", contentType: "application/pdf" });
    const res = await request(app).get(`/api/files/${created.body.fileId}`).redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^memory:\/\//);
  });

  it("GET /:fileId returns 404 for another workspace's fileId (no existence leak)", async () => {
    const created = await uploadUrl(appA(), { filename: "a.pdf", contentType: "application/pdf" });
    const res = await request(appB()).get(`/api/files/${created.body.fileId}`).redirects(0);
    expect(res.status).toBe(404);
  });

  it("DELETE /:fileId soft-deletes; subsequent GET is 404; foreign delete is 404", async () => {
    const app = appA();
    const created = await uploadUrl(app, { filename: "a.pdf", contentType: "application/pdf" });
    const fileId = created.body.fileId;

    expect((await request(app).delete(`/api/files/${fileId}`)).status).toBe(204);
    expect((await request(app).get(`/api/files/${fileId}`).redirects(0)).status).toBe(404);
    expect((await request(appB()).delete(`/api/files/${fileId}`)).status).toBe(404);
  });
});
