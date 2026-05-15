import type { NextFunction, Response } from "express";
import type { Pool, QueryResult } from "pg";
import type { WorkspaceAwareRequest } from "./workspaceResolver";
import {
  createExplicitWorkspaceHeaderResolver,
  createWorkspaceResolver,
} from "./workspaceResolver";

function createResponse() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  return { status, json } as unknown as Response;
}

function createRequest(overrides: Partial<WorkspaceAwareRequest> = {}): WorkspaceAwareRequest {
  return {
    auth: { sub: "user-123" },
    headers: {},
    ...overrides,
  } as WorkspaceAwareRequest;
}

function createQueryResult(rows: Array<Record<string, unknown>>, rowCount: number | null): QueryResult {
  return {
    command: "SELECT",
    rowCount,
    oid: 0,
    fields: [],
    rows,
  };
}

describe("createWorkspaceResolver", () => {
  it("falls back to a single owned workspace when no explicit override or JWT claim is present", async () => {
    const query = jest
      .fn<Promise<QueryResult>, [string, unknown[]]>()
      // 1st call: resolveDefaultWorkspaceId — owned workspaces lookup
      .mockResolvedValueOnce(createQueryResult([{ id: "22222222-2222-4222-8222-222222222222" }], null))
      // 2nd call: resolveWorkspaceRole — populate req.workspace.role (HEL-18)
      .mockResolvedValueOnce(createQueryResult([{ role: "owner" }], null));
    const pool = { query } as unknown as Pool;
    const middleware = createWorkspaceResolver(pool);
    const req = createRequest({ auth: { sub: "user-123" } });
    const res = createResponse();
    const next = jest.fn() as NextFunction;

    await middleware(req, res, next);

    expect(req.workspaceId).toBe("22222222-2222-4222-8222-222222222222");
    expect(req.workspace).toEqual({
      id: "22222222-2222-4222-8222-222222222222",
      role: "owner",
    });
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("auto-provisions a default workspace when the user has zero workspaces (HEL-83 follow-on)", async () => {
    // Brad's regression after the Supabase auth cutover: a freshly-signed-up
    // user with zero workspaces hits the resolver from /auth/callback, gets
    // a confusing "Multiple workspaces available" 400, and the dashboard
    // is stuck. The resolver now auto-creates instead of 400ing.
    const newWorkspaceId = "55555555-5555-4555-8555-555555555555";
    const query = jest
      .fn<Promise<QueryResult>, [string, unknown[]]>()
      // 1st call: resolveDefaultWorkspaceId — owned lookup, returns 0 rows
      .mockResolvedValueOnce(createQueryResult([], null))
      // 2nd call: resolveDefaultWorkspaceId — member lookup, returns 0 rows
      .mockResolvedValueOnce(createQueryResult([], null));
    const connectQuery = jest
      .fn<Promise<QueryResult>, [string, unknown[]?]>()
      // BEGIN
      .mockResolvedValueOnce(createQueryResult([], null))
      // pg_advisory_xact_lock
      .mockResolvedValueOnce(createQueryResult([], null))
      // re-check inside lock — still 0 rows
      .mockResolvedValueOnce(createQueryResult([], null))
      // INSERT workspaces RETURNING id
      .mockResolvedValueOnce(createQueryResult([{ id: newWorkspaceId }], null))
      // INSERT workspace_members
      .mockResolvedValueOnce(createQueryResult([], null))
      // COMMIT
      .mockResolvedValueOnce(createQueryResult([], null));
    const release = jest.fn();
    const connect = jest.fn().mockResolvedValue({ query: connectQuery, release });
    // After provisioning, the resolver re-queries the role.
    query.mockResolvedValueOnce(createQueryResult([{ role: "owner" }], null));
    const pool = { query, connect } as unknown as Pool;
    const middleware = createWorkspaceResolver(pool);
    const req = createRequest({ auth: { sub: "user-new" } });
    const res = createResponse();
    const next = jest.fn() as NextFunction;

    await middleware(req, res, next);

    expect(connect).toHaveBeenCalledTimes(1);
    expect(req.workspaceId).toBe(newWorkspaceId);
    expect(req.workspace).toEqual({ id: newWorkspaceId, role: "owner" });
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
    // Confirm the INSERT actually ran (not just the re-check short-circuit).
    expect(connectQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO workspaces"),
      expect.arrayContaining(["My Workspace", "user-new"]),
    );
  });

  it("rejects invalid explicit workspace header formats before any lookup", async () => {
    const query = jest.fn();
    const pool = { query } as unknown as Pool;
    const middleware = createWorkspaceResolver(pool);
    const req = createRequest({
      auth: { sub: "user-123", workspaceId: "22222222-2222-4222-8222-222222222222" },
      headers: { "x-workspace-id": "not-a-uuid" },
    });
    const res = createResponse();
    const next = jest.fn() as NextFunction;

    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("rejects explicit workspace overrides for non-members", async () => {
    const query = jest
      .fn<Promise<QueryResult>, [string, unknown[]]>()
      .mockResolvedValueOnce(createQueryResult([], null));
    const pool = { query } as unknown as Pool;
    const middleware = createWorkspaceResolver(pool);
    const req = createRequest({
      auth: { sub: "user-123", workspaceId: "22222222-2222-4222-8222-222222222222" },
      headers: { "x-workspace-id": "33333333-3333-4333-8333-333333333333" },
    });
    const res = createResponse();
    const next = jest.fn() as NextFunction;

    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("prefers an explicit workspace override over the JWT workspace claim", async () => {
    const query = jest
      .fn<Promise<QueryResult>, [string, unknown[]]>()
      .mockResolvedValueOnce(createQueryResult([{ role: "owner" }], null));
    const pool = { query } as unknown as Pool;
    const middleware = createWorkspaceResolver(pool);
    const req = createRequest({
      auth: { sub: "user-123", workspaceId: "22222222-2222-4222-8222-222222222222" },
      headers: { "x-workspace-id": "33333333-3333-4333-8333-333333333333" },
    });
    const res = createResponse();
    const next = jest.fn() as NextFunction;

    await middleware(req, res, next);

    expect(req.workspaceId).toBe("33333333-3333-4333-8333-333333333333");
    expect(query).toHaveBeenCalledWith(expect.stringContaining("FROM workspaces w"), [
      "33333333-3333-4333-8333-333333333333",
      "user-123",
    ]);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("uses the JWT workspace claim when membership is valid", async () => {
    const query = jest
      .fn<Promise<QueryResult>, [string, unknown[]]>()
      .mockResolvedValueOnce(createQueryResult([{ role: "owner" }], null));
    const pool = { query } as unknown as Pool;
    const middleware = createWorkspaceResolver(pool);
    const req = createRequest({
      auth: { sub: "user-123", workspaceId: "22222222-2222-4222-8222-222222222222" },
    });
    const res = createResponse();
    const next = jest.fn() as NextFunction;

    await middleware(req, res, next);

    expect(req.workspaceId).toBe("22222222-2222-4222-8222-222222222222");
    expect(query).toHaveBeenCalledWith(expect.stringContaining("FROM workspaces w"), [
      "22222222-2222-4222-8222-222222222222",
      "user-123",
    ]);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe("createExplicitWorkspaceHeaderResolver", () => {
  it("preserves a trimmed X-Workspace-Id header without postgres membership lookups", () => {
    const middleware = createExplicitWorkspaceHeaderResolver();
    const req = createRequest({
      headers: { "x-workspace-id": "  workspace-shared  " },
    });
    const res = createResponse();
    const next = jest.fn() as NextFunction;

    middleware(req, res, next);

    expect(req.workspaceId).toBe("workspace-shared");
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("ignores empty explicit workspace headers", () => {
    const middleware = createExplicitWorkspaceHeaderResolver();
    const req = createRequest({
      headers: { "x-workspace-id": "   " },
      auth: { sub: "user-123", workspaceId: "22222222-2222-4222-8222-222222222222" },
    });
    const res = createResponse();
    const next = jest.fn() as NextFunction;

    middleware(req, res, next);

    expect(req.workspaceId).toBe("22222222-2222-4222-8222-222222222222");
    // Dev fallback (no Postgres) defaults to least-privileged role so
    // role-gated handlers don't silently elevate without a membership check.
    expect(req.workspace).toEqual({
      id: "22222222-2222-4222-8222-222222222222",
      role: "member",
    });
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// HEL-18 — chokepoint security regression tests
// ---------------------------------------------------------------------------
//
// These tests prove the membership-check predicate guarantees the middleware
// promises: a user MUST NOT be able to read another workspace's data by
// spoofing a foreign workspace UUID in the URL or x-workspace-id header.
//
// The downstream handler depends on `req.workspace` being set; if next() is
// never called for an unauthorized caller, the handler never runs, so no
// query against the wrong workspace is possible.
describe("withWorkspace — cross-tenant spoof regression (HEL-18)", () => {
  const VICTIM_WORKSPACE = "11111111-1111-4111-8111-111111111111";
  const ATTACKER_USER = "user-attacker";

  it("blocks an attacker from spoofing another workspace's UUID in x-workspace-id", async () => {
    // Membership lookup returns zero rows → attacker is not a member.
    const query = jest
      .fn<Promise<QueryResult>, [string, unknown[]]>()
      .mockResolvedValueOnce(createQueryResult([], null));
    const pool = { query } as unknown as Pool;
    const middleware = createWorkspaceResolver(pool);
    const req = createRequest({
      auth: { sub: ATTACKER_USER, workspaceId: "22222222-2222-4222-8222-222222222222" },
      headers: { "x-workspace-id": VICTIM_WORKSPACE },
    });
    const res = createResponse();
    const next = jest.fn() as NextFunction;

    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(req.workspace).toBeUndefined();
    expect(req.workspaceId).toBeUndefined();
    expect(res.status).toHaveBeenCalledWith(403);
    // Membership predicate ran with ATTACKER_USER and VICTIM_WORKSPACE — the
    // outer query's parameter binding is what gates downstream queries from
    // ever using the wrong workspace_id.
    expect(query).toHaveBeenCalledWith(expect.any(String), [VICTIM_WORKSPACE, ATTACKER_USER]);
  });

  it("blocks an attacker whose JWT carries a foreign workspace claim", async () => {
    const query = jest
      .fn<Promise<QueryResult>, [string, unknown[]]>()
      .mockResolvedValueOnce(createQueryResult([], null));
    const pool = { query } as unknown as Pool;
    const middleware = createWorkspaceResolver(pool);
    // Worst-case: the JWT itself is forged with the victim's workspaceId.
    // Even so, the membership lookup must fail and the request must 403.
    const req = createRequest({
      auth: { sub: ATTACKER_USER, workspaceId: VICTIM_WORKSPACE },
    });
    const res = createResponse();
    const next = jest.fn() as NextFunction;

    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(req.workspace).toBeUndefined();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("populates req.workspace.role for legitimate members", async () => {
    const query = jest
      .fn<Promise<QueryResult>, [string, unknown[]]>()
      .mockResolvedValueOnce(createQueryResult([{ role: "admin" }], null));
    const pool = { query } as unknown as Pool;
    const middleware = createWorkspaceResolver(pool);
    const memberWorkspace = "44444444-4444-4444-8444-444444444444";
    const req = createRequest({
      auth: { sub: "user-legit", workspaceId: memberWorkspace },
    });
    const res = createResponse();
    const next = jest.fn() as NextFunction;

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.workspace).toEqual({ id: memberWorkspace, role: "admin" });
    // Back-compat: the legacy req.workspaceId stays populated alongside.
    expect(req.workspaceId).toBe(memberWorkspace);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns the same 403 for non-existent workspaces as for non-member workspaces", async () => {
    // Opaque error — don't leak whether the workspace exists.
    const query = jest
      .fn<Promise<QueryResult>, [string, unknown[]]>()
      .mockResolvedValueOnce(createQueryResult([], null));
    const pool = { query } as unknown as Pool;
    const middleware = createWorkspaceResolver(pool);
    const nonExistent = "99999999-9999-4999-8999-999999999999";
    const req = createRequest({
      auth: { sub: "user-probing" },
      headers: { "x-workspace-id": nonExistent },
    });
    const res = createResponse();
    const next = jest.fn() as NextFunction;

    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
