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
      .mockResolvedValueOnce(createQueryResult([{ id: "22222222-2222-4222-8222-222222222222" }], null));
    const pool = { query } as unknown as Pool;
    const middleware = createWorkspaceResolver(pool);
    const req = createRequest({ auth: { sub: "user-123" } });
    const res = createResponse();
    const next = jest.fn() as NextFunction;

    await middleware(req, res, next);

    expect(req.workspaceId).toBe("22222222-2222-4222-8222-222222222222");
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
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
      .mockResolvedValueOnce(createQueryResult([{ "?column?": 1 }], null));
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
    expect(query).toHaveBeenCalledWith(expect.stringContaining("SELECT 1 FROM workspaces"), [
      "33333333-3333-4333-8333-333333333333",
      "user-123",
    ]);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("uses the JWT workspace claim when membership is valid", async () => {
    const query = jest
      .fn<Promise<QueryResult>, [string, unknown[]]>()
      .mockResolvedValueOnce(createQueryResult([{ "?column?": 1 }], null));
    const pool = { query } as unknown as Pool;
    const middleware = createWorkspaceResolver(pool);
    const req = createRequest({
      auth: { sub: "user-123", workspaceId: "22222222-2222-4222-8222-222222222222" },
    });
    const res = createResponse();
    const next = jest.fn() as NextFunction;

    await middleware(req, res, next);

    expect(req.workspaceId).toBe("22222222-2222-4222-8222-222222222222");
    expect(query).toHaveBeenCalledWith(expect.stringContaining("SELECT 1 FROM workspaces"), [
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
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
