import type { NextFunction, Response } from "express";
import type { WorkspaceAwareRequest, WorkspaceRole } from "./workspaceResolver";
import { requireRole } from "./requireRole";

function createResponse() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  return { status, json } as unknown as Response;
}

function reqWithRole(role: WorkspaceRole | undefined): WorkspaceAwareRequest {
  return {
    auth: { sub: "user-123" },
    workspace: role
      ? { id: "11111111-1111-4111-8111-111111111111", role }
      : undefined,
    workspaceId: role ? "11111111-1111-4111-8111-111111111111" : undefined,
  } as unknown as WorkspaceAwareRequest;
}

describe("requireRole", () => {
  it("rejects construction with no roles", () => {
    expect(() => requireRole()).toThrow(/at least one role/);
  });

  it("passes when the user's role matches one of the allowed", () => {
    const middleware = requireRole("admin");
    const req = reqWithRole("admin");
    const res = createResponse();
    const next = jest.fn() as NextFunction;

    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("treats owner as an implicit superuser even when not in the allowed list", () => {
    // requireRole('billing') would normally only allow 'billing', but owner
    // always passes — call sites don't have to remember to enumerate it.
    const middleware = requireRole("billing");
    const req = reqWithRole("owner");
    const res = createResponse();
    const next = jest.fn() as NextFunction;

    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it.each<WorkspaceRole>(["billing", "operator", "developer", "approver", "member"])(
    "rejects role=%s when only admin is allowed",
    (role) => {
      const middleware = requireRole("admin");
      const req = reqWithRole(role);
      const res = createResponse();
      const next = jest.fn() as NextFunction;

      middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    },
  );

  it("accepts any of multiple allowed roles", () => {
    const middleware = requireRole("admin", "developer");
    for (const role of ["admin", "developer"] as WorkspaceRole[]) {
      const req = reqWithRole(role);
      const res = createResponse();
      const next = jest.fn() as NextFunction;
      middleware(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    }
  });

  it("fails closed with 500 when withWorkspace did not run upstream", () => {
    // Configuration bug: requireRole mounted without withWorkspace. The
    // middleware MUST NOT silently let the request through to the handler.
    const middleware = requireRole("owner");
    const req = reqWithRole(undefined);
    const res = createResponse();
    const next = jest.fn() as NextFunction;

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("does NOT 403 when owner is the only allowed role and the user is owner", () => {
    // Sanity check the implicit-owner-pass logic doesn't double-reject.
    const middleware = requireRole("owner");
    const req = reqWithRole("owner");
    const res = createResponse();
    const next = jest.fn() as NextFunction;

    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
