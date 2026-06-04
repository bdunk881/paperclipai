jest.mock("../billing/credits/walletStore", () => ({
  grantCredits: jest.fn().mockResolvedValue({ granted: true, balanceAfter: 10000n, reason: "granted" }),
}));

// HEL-356: the DELETE handler enumerates file_objects and queues object-storage
// cleanup. Mock both so the route is tested deterministically without a real
// Postgres pool or Redis connection (mirrors the walletStore mock above).
jest.mock("../storage/fileObjectStore", () => ({
  fileObjectStore: {
    listByWorkspace: jest.fn().mockResolvedValue([]),
  },
}));

jest.mock("../queue/storageQueue", () => ({
  enqueueObjectDeletion: jest.fn().mockResolvedValue(undefined),
  getStorageDeletionQueue: jest.fn().mockReturnValue(null),
  resetStorageDeletionQueueForTests: jest.fn(),
}));

import express from "express";
import request from "supertest";
import type { AuthenticatedRequest } from "../auth/authMiddleware";
import { grantCredits } from "../billing/credits/walletStore";
import { createWorkspaceRoutes } from "./workspaceRoutes";
import { fileObjectStore } from "../storage/fileObjectStore";
import { enqueueObjectDeletion } from "../queue/storageQueue";

const mockGrantCredits = grantCredits as jest.Mock;
const mockListByWorkspace = fileObjectStore.listByWorkspace as jest.Mock;
const mockEnqueueObjectDeletion = enqueueObjectDeletion as jest.Mock;

beforeEach(() => {
  mockGrantCredits.mockClear();
  mockGrantCredits.mockResolvedValue({ granted: true, balanceAfter: 10000n, reason: "granted" });
  mockListByWorkspace.mockReset();
  mockListByWorkspace.mockResolvedValue([]);
  mockEnqueueObjectDeletion.mockReset();
  mockEnqueueObjectDeletion.mockResolvedValue(undefined);
});

function buildApp(queryImpl: jest.Mock, connectImpl?: jest.Mock) {
  const app = express();
  app.use(express.json());
  app.use((req: AuthenticatedRequest, _res, next) => {
    req.auth = { sub: "user-123", email: "test@example.com" };
    next();
  });
  app.use(
    "/api/workspaces",
    createWorkspaceRoutes({
      query: queryImpl,
      connect: connectImpl,
    } as never)
  );
  return app;
}

describe("workspaceRoutes", () => {
  it("lists member workspaces with derived slugs", async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [
        { id: "22222222-2222-4222-8222-222222222222", name: "Acme AI" },
        { id: "33333333-3333-4333-8333-333333333333", name: "Ops / North America" },
      ],
    });
    const app = buildApp(query);

    const res = await request(app)
      .get("/api/workspaces")
      .set("Authorization", "Bearer user-123");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        id: "22222222-2222-4222-8222-222222222222",
        name: "Acme AI",
        slug: "acme-ai",
      },
      {
        id: "33333333-3333-4333-8333-333333333333",
        name: "Ops / North America",
        slug: "ops-north-america",
      },
    ]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("FROM workspaces"), ["user-123"]);
  });

  it("auto-provisions a default workspace when the user has zero (HEL-83 follow-on)", async () => {
    const newWorkspaceId = "55555555-5555-4555-8555-555555555555";
    // 1st list query: 0 rows → triggers provision
    // 2nd list query (after provision): 1 row with the newly-created workspace
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: newWorkspaceId, name: "My Workspace" }] });

    // provisionDefaultWorkspace uses pool.connect() internally
    const provisionClient = {
      query: jest
        .fn()
        // BEGIN
        .mockResolvedValueOnce(undefined)
        // pg_advisory_xact_lock
        .mockResolvedValueOnce(undefined)
        // re-check inside lock — 0 rows
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // INSERT workspaces RETURNING id
        .mockResolvedValueOnce({ rows: [{ id: newWorkspaceId }], rowCount: 1 })
        // INSERT workspace_members
        .mockResolvedValueOnce(undefined)
        // COMMIT
        .mockResolvedValueOnce(undefined),
      release: jest.fn(),
    };
    const connect = jest.fn().mockResolvedValue(provisionClient);
    const app = buildApp(query, connect);

    const res = await request(app)
      .get("/api/workspaces")
      .set("Authorization", "Bearer user-123");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        id: newWorkspaceId,
        name: "My Workspace",
        slug: "my-workspace",
      },
    ]);
    // Two list queries (pre + post provision) + the provision INSERTs through the client.
    expect(query).toHaveBeenCalledTimes(2);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(provisionClient.release).toHaveBeenCalledTimes(1);
  });

  it("creates a workspace and returns a derived slug", async () => {
    const query = jest.fn();
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({
          rows: [{ id: "22222222-2222-4222-8222-222222222222", name: "Acme AI" }],
        })
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined),
      release: jest.fn(),
    };
    const connect = jest.fn().mockResolvedValue(client);
    const app = buildApp(query, connect);

    const res = await request(app)
      .post("/api/workspaces")
      .set("Authorization", "Bearer user-123")
      .send({ name: "Acme AI" });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: "22222222-2222-4222-8222-222222222222",
      name: "Acme AI",
      slug: "acme-ai",
    });
    expect(connect).toHaveBeenCalledTimes(1);
    expect(client.query).toHaveBeenNthCalledWith(1, "BEGIN");
    expect(client.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("INSERT INTO workspaces"),
      ["Acme AI", "user-123", expect.stringMatching(/^[0-9a-f]{64}$/)]
    );
    expect(client.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("INSERT INTO workspace_members"),
      ["22222222-2222-4222-8222-222222222222", "user-123"]
    );
    expect(client.query).toHaveBeenNthCalledWith(4, "COMMIT");
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  // PR A — signup-trial grant fires after workspace creation.
  it("grants signup-trial credits after workspace creation (best-effort)", async () => {
    const query = jest.fn();
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({
          rows: [{ id: "22222222-2222-4222-8222-222222222222", name: "Acme AI" }],
        })
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined),
      release: jest.fn(),
    };
    const connect = jest.fn().mockResolvedValue(client);
    const app = buildApp(query, connect);

    const res = await request(app)
      .post("/api/workspaces")
      .set("Authorization", "Bearer user-123")
      .send({ name: "Acme AI" });

    expect(res.status).toBe(201);
    expect(mockGrantCredits).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "22222222-2222-4222-8222-222222222222",
        userId: "user-123",
        credits: 10000n,
        grantType: "grant",
        idempotencyKey: "signup_trial__22222222-2222-4222-8222-222222222222",
      }),
    );
  });

  it("succeeds even when the signup-trial grant errors (best-effort)", async () => {
    mockGrantCredits.mockRejectedValueOnce(new Error("grant failed"));
    const query = jest.fn();
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({
          rows: [{ id: "22222222-2222-4222-8222-222222222222", name: "Acme AI" }],
        })
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined),
      release: jest.fn(),
    };
    const connect = jest.fn().mockResolvedValue(client);
    const app = buildApp(query, connect);

    const res = await request(app)
      .post("/api/workspaces")
      .set("Authorization", "Bearer user-123")
      .send({ name: "Acme AI" });

    // 201 success because workspace creation is the source of truth;
    // grant failures only log a warning.
    expect(res.status).toBe(201);
    expect(res.body.id).toBe("22222222-2222-4222-8222-222222222222");
  });

  it("skips the signup-trial grant when SIGNUP_TRIAL_CREDITS=0", async () => {
    const prev = process.env.SIGNUP_TRIAL_CREDITS;
    process.env.SIGNUP_TRIAL_CREDITS = "0";
    try {
      const query = jest.fn();
      const client = {
        query: jest
          .fn()
          .mockResolvedValueOnce(undefined)
          .mockResolvedValueOnce({
            rows: [{ id: "44444444-4444-4444-8444-444444444444", name: "Trial-off Co" }],
          })
          .mockResolvedValueOnce(undefined)
          .mockResolvedValueOnce(undefined),
        release: jest.fn(),
      };
      const connect = jest.fn().mockResolvedValue(client);
      const app = buildApp(query, connect);

      const res = await request(app)
        .post("/api/workspaces")
        .set("Authorization", "Bearer user-123")
        .send({ name: "Trial-off Co" });

      expect(res.status).toBe(201);
      expect(mockGrantCredits).not.toHaveBeenCalled();
    } finally {
      if (prev === undefined) delete process.env.SIGNUP_TRIAL_CREDITS;
      else process.env.SIGNUP_TRIAL_CREDITS = prev;
    }
  });

  // -----------------------------------------------------------------
  // PATCH /api/workspaces/:id (HEL-192 — rename)
  // -----------------------------------------------------------------
  describe("PATCH /api/workspaces/:id", () => {
    const WS_ID = "22222222-2222-4222-8222-222222222222";

    it("returns 400 when the id is not a UUID", async () => {
      const query = jest.fn();
      const app = buildApp(query);
      const res = await request(app)
        .patch("/api/workspaces/not-a-uuid")
        .set("Authorization", "Bearer user-123")
        .send({ name: "new" });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Invalid workspace ID/);
      expect(query).not.toHaveBeenCalled();
    });

    it("returns 400 when name is missing", async () => {
      const query = jest.fn();
      const app = buildApp(query);
      const res = await request(app)
        .patch(`/api/workspaces/${WS_ID}`)
        .set("Authorization", "Bearer user-123")
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/name is required/);
    });

    it("returns 404 when the workspace does not exist", async () => {
      const query = jest.fn().mockResolvedValueOnce({ rows: [] });
      const app = buildApp(query);
      const res = await request(app)
        .patch(`/api/workspaces/${WS_ID}`)
        .set("Authorization", "Bearer user-123")
        .send({ name: "rename" });
      expect(res.status).toBe(404);
    });

    it("returns 403 when the user is a non-admin member", async () => {
      const query = jest.fn().mockResolvedValueOnce({ rows: [{ role: "member" }] });
      const app = buildApp(query);
      const res = await request(app)
        .patch(`/api/workspaces/${WS_ID}`)
        .set("Authorization", "Bearer user-123")
        .send({ name: "rename" });
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/owners or admins/);
    });

    it("renames the workspace when the user is the owner", async () => {
      const query = jest
        .fn()
        .mockResolvedValueOnce({ rows: [{ role: "owner" }] })
        .mockResolvedValueOnce({ rows: [{ id: WS_ID, name: "New Name" }] });
      const app = buildApp(query);
      const res = await request(app)
        .patch(`/api/workspaces/${WS_ID}`)
        .set("Authorization", "Bearer user-123")
        .send({ name: "New Name" });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id: WS_ID, name: "New Name", slug: "new-name" });
      expect(query).toHaveBeenCalledTimes(2);
    });
  });

  // -----------------------------------------------------------------
  // DELETE /api/workspaces/:id (HEL-356 — owner-only destructive delete)
  //
  // Owner-only, typed confirmation, active-subscription guard, then queue
  // object-storage cleanup for every file_objects row BEFORE the workspace
  // DELETE (whose ON DELETE CASCADE FKs remove the child rows).
  // -----------------------------------------------------------------
  describe("DELETE /api/workspaces/:id", () => {
    const WS_ID = "22222222-2222-4222-8222-222222222222";
    const WS_NAME = "Acme AI";

    function ownerRow() {
      return { rows: [{ name: WS_NAME, owner_user_id: "user-123" }] };
    }

    it("returns 400 when the id is not a UUID", async () => {
      const query = jest.fn();
      const app = buildApp(query);
      const res = await request(app)
        .delete("/api/workspaces/not-a-uuid")
        .set("Authorization", "Bearer user-123")
        .send({ confirm: WS_NAME });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Invalid workspace ID/);
      expect(query).not.toHaveBeenCalled();
      expect(mockEnqueueObjectDeletion).not.toHaveBeenCalled();
    });

    it("returns 404 when the workspace does not exist", async () => {
      const query = jest.fn().mockResolvedValueOnce({ rows: [] });
      const app = buildApp(query);
      const res = await request(app)
        .delete(`/api/workspaces/${WS_ID}`)
        .set("Authorization", "Bearer user-123")
        .send({ confirm: WS_NAME });
      expect(res.status).toBe(404);
      // Stops after the ownership SELECT — no cleanup, no DELETE.
      expect(query).toHaveBeenCalledTimes(1);
      expect(mockEnqueueObjectDeletion).not.toHaveBeenCalled();
    });

    it("returns 404 (opaque) when the caller is not the owner", async () => {
      const query = jest
        .fn()
        .mockResolvedValueOnce({ rows: [{ name: WS_NAME, owner_user_id: "someone-else" }] });
      const app = buildApp(query);
      const res = await request(app)
        .delete(`/api/workspaces/${WS_ID}`)
        .set("Authorization", "Bearer user-123")
        .send({ confirm: WS_NAME });
      // Opaque 404 — never leak another user's workspace existence.
      expect(res.status).toBe(404);
      expect(query).toHaveBeenCalledTimes(1);
      expect(mockEnqueueObjectDeletion).not.toHaveBeenCalled();
    });

    it("returns 400 when the typed confirmation does not match the name", async () => {
      const query = jest.fn().mockResolvedValueOnce(ownerRow());
      const app = buildApp(query);
      const res = await request(app)
        .delete(`/api/workspaces/${WS_ID}`)
        .set("Authorization", "Bearer user-123")
        .send({ confirm: "wrong name" });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("confirmation_required");
      // Ownership SELECT only — guard trips before the subscription check.
      expect(query).toHaveBeenCalledTimes(1);
      expect(mockEnqueueObjectDeletion).not.toHaveBeenCalled();
    });

    it("returns 409 when an active subscription exists", async () => {
      const query = jest
        .fn()
        .mockResolvedValueOnce(ownerRow())
        .mockResolvedValueOnce({ rows: [{ exists: 1 }] });
      const app = buildApp(query);
      const res = await request(app)
        .delete(`/api/workspaces/${WS_ID}`)
        .set("Authorization", "Bearer user-123")
        .send({ confirm: WS_NAME });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("active_subscription");
      // Ownership SELECT + subscription SELECT, but no DELETE issued.
      expect(query).toHaveBeenCalledTimes(2);
      const deleteCall = query.mock.calls.find((c) => /DELETE FROM workspaces/.test(String(c[0])));
      expect(deleteCall).toBeUndefined();
      expect(mockEnqueueObjectDeletion).not.toHaveBeenCalled();
    });

    it("deletes the workspace and queues cleanup for each file_object (happy path)", async () => {
      mockListByWorkspace.mockResolvedValueOnce([
        {
          id: "f1",
          storageKey: `workspaces/${WS_ID}/run-input/01ABC-doc.pdf`,
          provider: "s3",
          bucket: "autoflow-storage-dev",
        },
        {
          id: "f2",
          storageKey: `workspaces/${WS_ID}/export/01DEF-report.csv`,
          provider: "s3",
          bucket: "autoflow-storage-dev",
        },
      ]);
      const query = jest
        .fn()
        .mockResolvedValueOnce(ownerRow())
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rowCount: 1 });
      const app = buildApp(query);

      const res = await request(app)
        .delete(`/api/workspaces/${WS_ID}`)
        .set("Authorization", "Bearer user-123")
        .send({ confirm: WS_NAME });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ deleted: true, fileObjectsQueued: 2 });

      // Cleanup enumeration scoped to the workspace + caller.
      expect(mockListByWorkspace).toHaveBeenCalledWith({ workspaceId: WS_ID, userId: "user-123" });

      // One deletion job per file, each carrying the storage key/provider/bucket.
      expect(mockEnqueueObjectDeletion).toHaveBeenCalledTimes(2);
      expect(mockEnqueueObjectDeletion).toHaveBeenNthCalledWith(1, {
        workspaceId: WS_ID,
        fileId: "f1",
        storageKey: `workspaces/${WS_ID}/run-input/01ABC-doc.pdf`,
        provider: "s3",
        bucket: "autoflow-storage-dev",
      });
      expect(mockEnqueueObjectDeletion).toHaveBeenNthCalledWith(2, {
        workspaceId: WS_ID,
        fileId: "f2",
        storageKey: `workspaces/${WS_ID}/export/01DEF-report.csv`,
        provider: "s3",
        bucket: "autoflow-storage-dev",
      });

      // The workspace row is deleted with an explicit owner filter.
      const deleteCall = query.mock.calls.find((c) => /DELETE FROM workspaces/.test(String(c[0])));
      expect(deleteCall).toBeTruthy();
      expect(deleteCall![1]).toEqual([WS_ID, "user-123"]);
      expect(query).toHaveBeenCalledTimes(3);
    });

    it("deletes with fileObjectsQueued: 0 when the workspace has no files", async () => {
      mockListByWorkspace.mockResolvedValueOnce([]);
      const query = jest
        .fn()
        .mockResolvedValueOnce(ownerRow())
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rowCount: 1 });
      const app = buildApp(query);

      const res = await request(app)
        .delete(`/api/workspaces/${WS_ID}`)
        .set("Authorization", "Bearer user-123")
        .send({ confirm: WS_NAME });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ deleted: true, fileObjectsQueued: 0 });
      expect(mockEnqueueObjectDeletion).not.toHaveBeenCalled();
    });

    it("still deletes the workspace when storage cleanup enqueue fails (best-effort)", async () => {
      mockListByWorkspace.mockResolvedValueOnce([
        {
          id: "f1",
          storageKey: `workspaces/${WS_ID}/run-input/01ABC-doc.pdf`,
          provider: "s3",
          bucket: "autoflow-storage-dev",
        },
      ]);
      mockEnqueueObjectDeletion.mockRejectedValueOnce(new Error("redis down"));
      const query = jest
        .fn()
        .mockResolvedValueOnce(ownerRow())
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rowCount: 1 });
      const app = buildApp(query);

      const res = await request(app)
        .delete(`/api/workspaces/${WS_ID}`)
        .set("Authorization", "Bearer user-123")
        .send({ confirm: WS_NAME });

      // Cleanup failure is swallowed (logged); the workspace is still deleted.
      // The throw aborts the loop before the counter increments → 0 queued.
      expect(res.status).toBe(200);
      expect(res.body.deleted).toBe(true);
      expect(res.body.fileObjectsQueued).toBe(0);
      const deleteCall = query.mock.calls.find((c) => /DELETE FROM workspaces/.test(String(c[0])));
      expect(deleteCall).toBeTruthy();
    });

    it("returns 404 when the DELETE removes no row (lost ownership race)", async () => {
      mockListByWorkspace.mockResolvedValueOnce([]);
      const query = jest
        .fn()
        .mockResolvedValueOnce(ownerRow())
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rowCount: 0 });
      const app = buildApp(query);

      const res = await request(app)
        .delete(`/api/workspaces/${WS_ID}`)
        .set("Authorization", "Bearer user-123")
        .send({ confirm: WS_NAME });

      expect(res.status).toBe(404);
    });
  });
});
