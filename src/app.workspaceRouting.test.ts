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
  inMemoryAllowed: jest.fn(() => true),
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

  it("gates control-plane routes behind the workspace resolver", async () => {
    const res = await request(app)
      .get("/api/control-plane/teams")
      .set("Authorization", "Bearer test-user-id");

    expect(res.status).toBe(418);
    expect(res.body.error).toBe("workspace resolver invoked");
    expect(workspaceResolverSpy).toHaveBeenCalledTimes(1);
  });

  it("keeps ticket routes behind the workspace resolver", async () => {
    const res = await request(app)
      .get("/api/tickets")
      .set("Authorization", "Bearer test-user-id");

    expect(res.status).toBe(418);
    expect(res.body.error).toBe("workspace resolver invoked");
    expect(workspaceResolverSpy).toHaveBeenCalledTimes(1);
  });

  it("keeps ticket SLA routes behind the workspace resolver", async () => {
    const res = await request(app)
      .get("/api/tickets/sla/policies")
      .set("Authorization", "Bearer test-user-id");

    expect(res.status).toBe(418);
    expect(res.body.error).toBe("workspace resolver invoked");
    expect(workspaceResolverSpy).toHaveBeenCalledTimes(1);
  });

  it("keeps notification routes behind the workspace resolver", async () => {
    const res = await request(app)
      .get("/api/notifications/preferences")
      .set("Authorization", "Bearer test-user-id");

    expect(res.status).toBe(418);
    expect(res.body.error).toBe("workspace resolver invoked");
    expect(workspaceResolverSpy).toHaveBeenCalledTimes(1);
  });

  it("keeps run routes behind the workspace resolver", async () => {
    const res = await request(app)
      .get("/api/runs")
      .set("Authorization", "Bearer test-user-id");

    expect(res.status).toBe(418);
    expect(res.body.error).toBe("workspace resolver invoked");
    expect(workspaceResolverSpy).toHaveBeenCalledTimes(1);
  });

  it("keeps workflow generation behind the workspace resolver", async () => {
    const res = await request(app)
      .post("/api/workflows/generate")
      .set("Authorization", "Bearer test-user-id")
      .send({ description: "Generate a workflow" });

    expect(res.status).toBe(418);
    expect(res.body.error).toBe("workspace resolver invoked");
    expect(workspaceResolverSpy).toHaveBeenCalledTimes(1);
  });

  it("gates llm-configs routes behind the workspace resolver (HEL-68)", async () => {
    const res = await request(app)
      .get("/api/llm-configs")
      .set("Authorization", "Bearer test-user-id");

    expect(res.status).toBe(418);
    expect(res.body.error).toBe("workspace resolver invoked");
    expect(workspaceResolverSpy).toHaveBeenCalledTimes(1);
  });

  it("gates mcp/servers routes behind the workspace resolver (HEL-68)", async () => {
    const res = await request(app)
      .get("/api/mcp/servers")
      .set("Authorization", "Bearer test-user-id");

    expect(res.status).toBe(418);
    expect(res.body.error).toBe("workspace resolver invoked");
    expect(workspaceResolverSpy).toHaveBeenCalledTimes(1);
  });

  it("gates memory routes behind the workspace resolver (HEL-68)", async () => {
    const res = await request(app)
      .get("/api/memory")
      .set("Authorization", "Bearer test-user-id");

    expect(res.status).toBe(418);
    expect(res.body.error).toBe("workspace resolver invoked");
    expect(workspaceResolverSpy).toHaveBeenCalledTimes(1);
  });

  it("gates agent memory routes behind the workspace resolver (HEL-68)", async () => {
    const res = await request(app)
      .get("/api/agents/test-agent-id/memory/search")
      .set("Authorization", "Bearer test-user-id");

    expect(res.status).toBe(418);
    expect(res.body.error).toBe("workspace resolver invoked");
    expect(workspaceResolverSpy).toHaveBeenCalledTimes(1);
  });

  it("gates knowledge routes behind the workspace resolver (HEL-68)", async () => {
    const res = await request(app)
      .get("/api/knowledge/bases")
      .set("Authorization", "Bearer test-user-id");

    expect(res.status).toBe(418);
    expect(res.body.error).toBe("workspace resolver invoked");
    expect(workspaceResolverSpy).toHaveBeenCalledTimes(1);
  });

  it("gates integration connection routes behind the workspace resolver (HEL-68)", async () => {
    const res = await request(app)
      .get("/api/integrations/connections")
      .set("Authorization", "Bearer test-user-id");

    expect(res.status).toBe(418);
    expect(res.body.error).toBe("workspace resolver invoked");
    expect(workspaceResolverSpy).toHaveBeenCalledTimes(1);
  });

  it("gates hitl routes behind the workspace resolver (HEL-68)", async () => {
    const res = await request(app)
      .get("/api/hitl/companies/some-company/state")
      .set("Authorization", "Bearer test-user-id");

    expect(res.status).toBe(418);
    expect(res.body.error).toBe("workspace resolver invoked");
    expect(workspaceResolverSpy).toHaveBeenCalledTimes(1);
  });

  it("gates reporting routes behind the workspace resolver (HEL-68)", async () => {
    const res = await request(app)
      .get("/api/reporting")
      .set("Authorization", "Bearer test-user-id");

    expect(res.status).toBe(418);
    expect(res.body.error).toBe("workspace resolver invoked");
    expect(workspaceResolverSpy).toHaveBeenCalledTimes(1);
  });

  it("gates ticket-sync routes behind the workspace resolver (HEL-68)", async () => {
    const res = await request(app)
      .get("/api/ticket-sync/connections")
      .set("Authorization", "Bearer test-user-id");

    expect(res.status).toBe(418);
    expect(res.body.error).toBe("workspace resolver invoked");
    expect(workspaceResolverSpy).toHaveBeenCalledTimes(1);
  });

  it("gates approval-policies routes behind the workspace resolver (HEL-68)", async () => {
    const res = await request(app)
      .get("/api/approval-policies")
      .set("Authorization", "Bearer test-user-id");

    expect(res.status).toBe(418);
    expect(res.body.error).toBe("workspace resolver invoked");
    expect(workspaceResolverSpy).toHaveBeenCalledTimes(1);
  });
});
