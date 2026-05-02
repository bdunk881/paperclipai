import type { NextFunction, Response } from "express";
import type { Pool, PoolClient, QueryResult } from "pg";
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

function createClient(overrides: { query: jest.Mock; release?: jest.Mock }) {
  return {
    query: overrides.query,
    release: overrides.release ?? jest.fn(),
  } as unknown as PoolClient;
}

describe("createWorkspaceResolver", () => {
  it("falls back to rows length when rowCount is null for a single owned workspace", async () => {
    const query = jest
      .fn<Promise<QueryResult>, [string, unknown[]]>()
      .mockResolvedValueOnce(createQueryResult([{ id: "workspace-1" }], null));
    const pool = { query } as unknown as Pool;
    const middleware = createWorkspaceResolver(pool);
    const req = createRequest();
    const res = createResponse();
    const next = jest.fn() as NextFunction;

    await middleware(req, res, next);

    expect(req.workspaceId).toBe("workspace-1");
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("treats null rowCount with multiple member rows as ambiguous", async () => {
    const query = jest
      .fn<Promise<QueryResult>, [string, unknown[]]>()
      .mockResolvedValueOnce(createQueryResult([], null))
      .mockResolvedValueOnce(
        createQueryResult([{ id: "workspace-1" }, { id: "workspace-2" }], null),
      );
    const pool = { query } as unknown as Pool;
    const middleware = createWorkspaceResolver(pool);
    const req = createRequest();
    const res = createResponse();
    const next = jest.fn() as NextFunction;

    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("bootstraps a default owner workspace for first-session users", async () => {
    const query = jest
      .fn<Promise<QueryResult>, [string, unknown[]]>()
      .mockResolvedValueOnce(createQueryResult([], null))
      .mockResolvedValueOnce(createQueryResult([], null));
    const clientQuery = jest
      .fn<Promise<QueryResult>, [string, unknown[]?]>()
      .mockResolvedValueOnce(createQueryResult([], null))
      .mockResolvedValueOnce(createQueryResult([], null))
      .mockResolvedValueOnce(createQueryResult([], null))
      .mockResolvedValueOnce(createQueryResult([], null))
      .mockResolvedValueOnce(createQueryResult([{ id: "workspace-bootstrap" }], 1))
      .mockResolvedValueOnce(createQueryResult([], 1))
      .mockResolvedValueOnce(createQueryResult([], null));
    const client = createClient({ query: clientQuery });
    const connect = jest.fn().mockResolvedValue(client);
    const pool = { query, connect } as unknown as Pool;
    const middleware = createWorkspaceResolver(pool);
    const req = createRequest();
    const res = createResponse();
    const next = jest.fn() as NextFunction;

    await middleware(req, res, next);

    expect(connect).toHaveBeenCalledTimes(1);
    expect(req.workspaceId).toBe("workspace-bootstrap");
    expect(next).toHaveBeenCalledTimes(1);
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO workspaces"),
      ["Personal Workspace", "user-123"],
    );
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
