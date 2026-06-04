// HEL-357: POST /api/observability/export — staged CSV export.
// Mocks the storage adapter, file_objects store, audit service, entitlement
// store, and the observability store so the route is exercised deterministically
// without Postgres/Redis/real buckets. The CSV serializer (./service) is left
// REAL so the route+serializer compose path is covered.
jest.mock("./store", () => ({
  observabilityStore: { listEvents: jest.fn() },
}));
jest.mock("../storage", () => ({
  getStorageAdapter: jest.fn(),
}));
jest.mock("../storage/fileObjectStore", () => ({
  fileObjectStore: { insert: jest.fn() },
}));
jest.mock("../auditing/auditService", () => ({
  auditService: { recordAction: jest.fn() },
}));
jest.mock("../billing/entitlements", () => ({
  entitlementStore: { get: jest.fn() },
}));

import express from "express";
import request from "supertest";
import router from "./routes";
import { observabilityStore } from "./store";
import { getStorageAdapter } from "../storage";
import { fileObjectStore } from "../storage/fileObjectStore";
import { auditService } from "../auditing/auditService";
import { entitlementStore } from "../billing/entitlements";
import type { ObservabilityEvent } from "./types";

const mockListEvents = observabilityStore.listEvents as jest.Mock;
const mockGetAdapter = getStorageAdapter as jest.Mock;
const mockInsert = fileObjectStore.insert as jest.Mock;
const mockRecordAction = auditService.recordAction as jest.Mock;
const mockEntitlementGet = entitlementStore.get as jest.Mock;

const WS = "11111111-1111-4111-8111-111111111111";

function makeAdapter() {
  return {
    provider: "memory",
    bucket: "test-bucket",
    putObject: jest.fn().mockResolvedValue({
      ref: { workspaceId: WS, collection: "export", objectId: "01ABCDEF-observability-export.csv" },
      storageKey: `workspaces/${WS}/export/01ABCDEF-observability-export.csv`,
      provider: "memory",
      bucket: "test-bucket",
      size: 100,
    }),
    getSignedDownloadUrl: jest.fn().mockResolvedValue("https://signed.example/download.csv"),
  };
}

let adapter: ReturnType<typeof makeAdapter>;

beforeEach(() => {
  jest.clearAllMocks();
  adapter = makeAdapter();
  mockGetAdapter.mockReturnValue(adapter);
  mockEntitlementGet.mockResolvedValue({ logRetentionDays: 14 });
  mockInsert.mockResolvedValue({ id: "file-123" });
  mockRecordAction.mockResolvedValue(undefined);
  delete process.env.OBSERVABILITY_EXPORT_MAX_ROWS;
  delete process.env.STORAGE_EXPORT_URL_TTL_SECONDS;
});

function buildApp({ withAuth = true, withWorkspace = true }: { withAuth?: boolean; withWorkspace?: boolean } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req: express.Request & { auth?: unknown; workspaceId?: string }, _res, next) => {
    if (withAuth) req.auth = { sub: "user-123", email: "t@e.com" };
    if (withWorkspace) req.workspaceId = WS;
    next();
  });
  app.use("/api/observability", router);
  return app;
}

function evt(seq: string): ObservabilityEvent {
  return {
    id: `e-${seq}`,
    sequence: seq,
    userId: "user-123",
    category: "run",
    type: "run.completed",
    actor: { type: "run", id: "run-1" },
    subject: { type: "execution", id: "exec-1" },
    summary: `event ${seq}`,
    payload: {},
    occurredAt: "2026-06-01T00:00:00.000Z",
  };
}

const page = (events: ObservabilityEvent[], nextCursor: string | null, hasMore: boolean) => ({
  events,
  nextCursor,
  hasMore,
  generatedAt: "2026-06-01T00:00:00.000Z",
});

describe("POST /api/observability/export (HEL-357)", () => {
  it("returns 401 when there is no authenticated user", async () => {
    const app = buildApp({ withAuth: false });
    const res = await request(app).post("/api/observability/export").send({});
    expect(res.status).toBe(401);
    expect(mockListEvents).not.toHaveBeenCalled();
  });

  it("returns 400 when no workspace is resolved", async () => {
    const app = buildApp({ withWorkspace: false });
    const res = await request(app).post("/api/observability/export").send({});
    expect(res.status).toBe(400);
    expect(mockListEvents).not.toHaveBeenCalled();
  });

  it("paginates, stages the CSV through storage, and returns a signed URL", async () => {
    mockListEvents
      .mockResolvedValueOnce(page([evt("1"), evt("2")], "2:e-2", true))
      .mockResolvedValueOnce(page([evt("3")], "3:e-3", false));
    const app = buildApp();

    const res = await request(app).post("/api/observability/export").send({});

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      fileId: "file-123",
      downloadUrl: "https://signed.example/download.csv",
      rowCount: 3,
      truncated: false,
    });
    expect(typeof res.body.byteSize).toBe("number");
    expect(res.body.byteSize).toBeGreaterThan(0);
    expect(typeof res.body.expiresAt).toBe("string");

    // Paginated forward: two calls, cursor advanced from undefined → "2:e-2".
    expect(mockListEvents).toHaveBeenCalledTimes(2);
    expect(mockListEvents.mock.calls[0][0]).toMatchObject({
      workspaceId: WS,
      userId: "user-123",
      after: undefined,
      limit: 200,
    });
    expect(mockListEvents.mock.calls[1][0]).toMatchObject({ after: "2:e-2" });
    // since clamped to the entitlement window.
    expect(mockEntitlementGet).toHaveBeenCalledWith(WS);
    expect(typeof mockListEvents.mock.calls[0][0].since).toBe("string");

    // Staged to the export collection as text/csv.
    expect(adapter.putObject).toHaveBeenCalledTimes(1);
    const putArg = adapter.putObject.mock.calls[0][0];
    expect(putArg).toMatchObject({ workspaceId: WS, collection: "export", contentType: "text/csv" });
    expect(Buffer.isBuffer(putArg.body)).toBe(true);
    expect(putArg.contentLength).toBe(res.body.byteSize);

    // file_objects row created with retention=short + provider/bucket from the adapter.
    expect(mockInsert).toHaveBeenCalledWith(
      { workspaceId: WS, userId: "user-123" },
      expect.objectContaining({
        collection: "export",
        retentionClass: "short",
        mimeType: "text/csv",
        provider: "memory",
        bucket: "test-bucket",
        uploadedBy: "user-123",
      }),
    );

    // Signed download URL minted for the stored ref.
    expect(adapter.getSignedDownloadUrl).toHaveBeenCalledTimes(1);
    expect(adapter.getSignedDownloadUrl.mock.calls[0][0]).toMatchObject({ collection: "export" });
  });

  it("forwards categories (JSON array) into listEvents", async () => {
    mockListEvents.mockResolvedValueOnce(page([], null, false));
    const app = buildApp();
    await request(app).post("/api/observability/export").send({ categories: ["run", "issue"] });
    expect(mockListEvents.mock.calls[0][0]).toMatchObject({ categories: ["run", "issue"] });
  });

  it("marks the export truncated when the row cap is hit", async () => {
    process.env.OBSERVABILITY_EXPORT_MAX_ROWS = "2";
    mockListEvents.mockResolvedValueOnce(page([evt("1"), evt("2"), evt("3")], "3:e-3", true));
    const app = buildApp();

    const res = await request(app).post("/api/observability/export").send({});

    expect(res.status).toBe(201);
    expect(res.body.rowCount).toBe(2);
    expect(res.body.truncated).toBe(true);
    // Stopped after the first page once the cap was reached.
    expect(mockListEvents).toHaveBeenCalledTimes(1);
  });

  it("audits the export with the file_objects id", async () => {
    mockListEvents.mockResolvedValueOnce(page([evt("1")], null, false));
    const app = buildApp();
    await request(app).post("/api/observability/export").send({});

    expect(mockRecordAction).toHaveBeenCalledTimes(1);
    const [ctx, entry] = mockRecordAction.mock.calls[0];
    expect(ctx).toMatchObject({ workspaceId: WS, userId: "user-123", actorUserId: "user-123" });
    expect(entry).toMatchObject({
      category: "execution",
      action: "observability_export",
      target: { type: "file_object", id: "file-123" },
    });
    expect(entry.metadata).toMatchObject({ fileId: "file-123", rowCount: 1, retentionClass: "short" });
  });

  it("still succeeds when the audit write fails (best-effort)", async () => {
    mockListEvents.mockResolvedValueOnce(page([evt("1")], null, false));
    mockRecordAction.mockRejectedValueOnce(new Error("audit down"));
    const app = buildApp();

    const res = await request(app).post("/api/observability/export").send({});

    expect(res.status).toBe(201);
    expect(res.body.fileId).toBe("file-123");
  });
});
