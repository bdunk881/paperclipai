jest.mock("./engine/llmProviders", () => ({
  getProvider: jest.fn(),
}));

jest.mock("./auth/authMiddleware", () => ({
  requireAuth: (
    req: { headers?: Record<string, unknown>; auth?: { sub: string; email?: string } },
    _res: unknown,
    next: () => void,
  ) => {
    const requestedUserId =
      typeof req.headers?.authorization === "string" && req.headers.authorization.startsWith("Bearer ")
        ? req.headers.authorization.slice(7)
        : "test-user-id";
    req.auth = { sub: requestedUserId, email: "test@example.com" };
    next();
  },
  requireAuthOrQaBypass: (
    req: { headers?: Record<string, unknown>; auth?: { sub: string; email?: string } },
    _res: unknown,
    next: () => void,
  ) => {
    const requestedUserId =
      typeof req.headers?.authorization === "string" && req.headers.authorization.startsWith("Bearer ")
        ? req.headers.authorization.slice(7)
        : "test-user-id";
    req.auth = { sub: requestedUserId, email: "test@example.com" };
    next();
  },
}));

jest.mock("./db/postgres", () => ({
  getPostgresPool: jest.fn(() => ({})),
  isPostgresConfigured: jest.fn(() => false),
  isPostgresPersistenceEnabled: jest.fn(() => true),
}));

const workspaceResolverSpy = jest.fn(
  (_req: unknown, res: { status: (code: number) => { json: (body: unknown) => void } }) => {
    res.status(418).json({ error: "workspace resolver invoked" });
  },
);

jest.mock("./middleware/workspaceResolver", () => ({
  createWorkspaceResolver: jest.fn(() => workspaceResolverSpy),
}));

import request from "supertest";
import app from "./app";
import { controlPlaneStore } from "./controlPlane/controlPlaneStore";

describe("workspace resolver route mounting", () => {
  beforeEach(() => {
    controlPlaneStore.clear();
    workspaceResolverSpy.mockClear();
  });

  it("does not gate control-plane routes behind the workspace resolver", async () => {
    const res = await request(app)
      .get("/api/control-plane/teams")
      .set("Authorization", "Bearer test-user-id");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ teams: [], total: 0 });
    expect(workspaceResolverSpy).not.toHaveBeenCalled();
  });

  it("keeps ticket routes behind the workspace resolver", async () => {
    const res = await request(app)
      .get("/api/tickets")
      .set("Authorization", "Bearer test-user-id");

    expect(res.status).toBe(418);
    expect(res.body.error).toBe("workspace resolver invoked");
    expect(workspaceResolverSpy).toHaveBeenCalledTimes(1);
  });
});
