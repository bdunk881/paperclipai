import type { NextFunction, Response } from "express";
import type { Pool, QueryResult } from "pg";
import type { WorkspaceAwareRequest } from "./workspaceResolver";
import { createWorkspaceResolver } from "./workspaceResolver";

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
  it("requires a workspace claim in the authenticated token", async () => {
    const query = jest.fn();
    const pool = { query } as unknown as Pool;
    const middleware = createWorkspaceResolver(pool);
    const req = createRequest({ auth: { sub: "user-123" } });
    const res = createResponse();
    const next = jest.fn() as NextFunction;

    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Workspace claim required." });
  });

  it("rejects invalid workspace claim formats", async () => {
    const query = jest.fn();
    const pool = { query } as unknown as Pool;
    const middleware = createWorkspaceResolver(pool);
    const req = createRequest({ auth: { sub: "user-123", workspaceId: "not-a-uuid" } });
    const res = createResponse();
    const next = jest.fn() as NextFunction;

    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("rejects workspace claims for non-members", async () => {
    const query = jest
      .fn<Promise<QueryResult>, [string, unknown[]]>()
      .mockResolvedValueOnce(createQueryResult([], null));
    const pool = { query } as unknown as Pool;
    const middleware = createWorkspaceResolver(pool);
    const req = createRequest({
      auth: { sub: "user-123", workspaceId: "22222222-2222-4222-8222-222222222222" },
    });
    const res = createResponse();
    const next = jest.fn() as NextFunction;

    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
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
