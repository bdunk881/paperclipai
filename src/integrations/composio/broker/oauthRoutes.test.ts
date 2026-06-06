import express from "express";
import request from "supertest";

jest.mock("./config", () => ({ isComposioEnabled: jest.fn() }));
jest.mock("./connectionService", () => ({
  beginConnect: jest.fn(),
  completeConnect: jest.fn(),
  listConnections: jest.fn(),
  disconnectAccount: jest.fn(),
}));
jest.mock("./toolkitCatalog", () => ({ queryToolkitCatalog: jest.fn() }));

import { composioConnectRouter, composioCallbackRouter } from "./oauthRoutes";
import { isComposioEnabled } from "./config";
import { beginConnect, completeConnect, listConnections, disconnectAccount } from "./connectionService";
import { queryToolkitCatalog } from "./toolkitCatalog";

const enabled = isComposioEnabled as jest.MockedFunction<typeof isComposioEnabled>;
const catalog = queryToolkitCatalog as jest.MockedFunction<typeof queryToolkitCatalog>;
const begin = beginConnect as jest.MockedFunction<typeof beginConnect>;
const complete = completeConnect as jest.MockedFunction<typeof completeConnect>;
const list = listConnections as jest.MockedFunction<typeof listConnections>;
const disconnect = disconnectAccount as jest.MockedFunction<typeof disconnectAccount>;

function authedApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/composio/callback", composioCallbackRouter);
  app.use(
    "/api/composio",
    (req, _res, next) => {
      (req as express.Request & { auth?: unknown; workspaceId?: string }).auth = { sub: "user-A" };
      (req as express.Request & { workspaceId?: string }).workspaceId = "ws-A";
      next();
    },
    composioConnectRouter,
  );
  return app;
}

describe("composio oauth routes (HEL-740)", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV, DASHBOARD_APP_URL: "https://dashboard.test" };
    enabled.mockReturnValue(true);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("POST /connect/:toolkit returns 201 with the redirect URL", async () => {
    begin.mockResolvedValue({
      redirectUrl: "https://backend.composio.dev/redirect/abc",
      connectedAccountId: "ca_1",
      toolkit: "github",
    });

    const res = await request(authedApp())
      .post("/api/composio/connect/github")
      .send({ allowMultiple: false });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      redirectUrl: "https://backend.composio.dev/redirect/abc",
      connectedAccountId: "ca_1",
      toolkit: "github",
    });
    expect(begin).toHaveBeenCalledWith(
      { workspaceId: "ws-A", userId: "user-A" },
      "github",
      expect.objectContaining({ allowMultiple: false }),
    );
  });

  it("POST /connect/:toolkit returns 503 when Composio is disabled", async () => {
    enabled.mockReturnValue(false);
    const res = await request(authedApp()).post("/api/composio/connect/github").send({});
    expect(res.status).toBe(503);
    expect(begin).not.toHaveBeenCalled();
  });

  it("POST /connect/:toolkit returns 401 without auth context", async () => {
    const app = express();
    app.use(express.json());
    app.use("/api/composio", composioConnectRouter); // no auth middleware
    const res = await request(app).post("/api/composio/connect/github").send({});
    expect(res.status).toBe(401);
  });

  it("GET /callback 302-redirects to the dashboard on success", async () => {
    complete.mockResolvedValue({ status: "success", toolkit: "github" });

    const res = await request(authedApp()).get(
      "/api/composio/callback?state=s1&status=success&connected_account_id=ca_1",
    );

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("https://dashboard.test/integrations");
    expect(res.headers.location).toContain("provider=composio");
    expect(res.headers.location).toContain("status=success");
    expect(complete).toHaveBeenCalledWith("s1", {
      status: "success",
      connectedAccountId: "ca_1",
    });
  });

  it("GET /callback 302-redirects with status=error and a message on failure", async () => {
    complete.mockResolvedValue({ status: "error", toolkit: null, message: "Invalid or expired connection state." });

    const res = await request(authedApp()).get("/api/composio/callback?state=bad");

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("status=error");
    expect(res.headers.location).toContain("message=");
  });

  it("GET /connections returns 200 with the workspace's connections", async () => {
    list.mockResolvedValue([
      {
        connectedAccountId: "ca_1",
        toolkit: "github",
        status: "ACTIVE",
        authConfigId: "ac_1",
        createdAt: "2026-06-06T00:00:00.000Z",
        updatedAt: "2026-06-06T00:00:00.000Z",
      },
    ]);

    const res = await request(authedApp()).get("/api/composio/connections");

    expect(res.status).toBe(200);
    expect(res.body.connections).toHaveLength(1);
    expect(res.body.connections[0]).toMatchObject({ connectedAccountId: "ca_1", toolkit: "github" });
    expect(list).toHaveBeenCalledWith({ workspaceId: "ws-A", userId: "user-A" });
  });

  it("GET /connections returns 401 without auth context", async () => {
    const app = express();
    app.use("/api/composio", composioConnectRouter); // no auth middleware
    const res = await request(app).get("/api/composio/connections");
    expect(res.status).toBe(401);
  });

  it("DELETE /connections/:caId returns 204", async () => {
    disconnect.mockResolvedValue(true);

    const res = await request(authedApp()).delete("/api/composio/connections/ca_1");

    expect(res.status).toBe(204);
    expect(disconnect).toHaveBeenCalledWith({ workspaceId: "ws-A", userId: "user-A" }, "ca_1");
  });

  it("DELETE /connections/:caId returns 404 when not found for the workspace", async () => {
    disconnect.mockResolvedValue(false);

    const res = await request(authedApp()).delete("/api/composio/connections/ca_unknown");

    expect(res.status).toBe(404);
  });

  it("GET /toolkits returns 200 with a catalog page", async () => {
    catalog.mockResolvedValue({
      toolkits: [
        {
          slug: "github",
          name: "GitHub",
          logo: null,
          description: null,
          categories: [],
          toolsCount: null,
          triggersCount: null,
          authSchemes: [],
          composioManagedAuthSchemes: [],
          noAuth: false,
        },
      ],
      total: 1,
      nextCursor: null,
    });

    const res = await request(authedApp()).get("/api/composio/toolkits?search=git&limit=10");

    expect(res.status).toBe(200);
    expect(res.body.toolkits).toHaveLength(1);
    expect(catalog).toHaveBeenCalledWith(expect.objectContaining({ search: "git", limit: 10 }));
  });

  it("GET /toolkits returns 503 when Composio is disabled", async () => {
    enabled.mockReturnValue(false);
    const res = await request(authedApp()).get("/api/composio/toolkits");
    expect(res.status).toBe(503);
    expect(catalog).not.toHaveBeenCalled();
  });
});
