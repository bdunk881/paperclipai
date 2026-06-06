import express from "express";
import request from "supertest";

jest.mock("./config", () => ({ isComposioEnabled: jest.fn() }));
jest.mock("./connectionService", () => ({
  beginConnect: jest.fn(),
  completeConnect: jest.fn(),
}));

import { composioConnectRouter, composioCallbackRouter } from "./oauthRoutes";
import { isComposioEnabled } from "./config";
import { beginConnect, completeConnect } from "./connectionService";

const enabled = isComposioEnabled as jest.MockedFunction<typeof isComposioEnabled>;
const begin = beginConnect as jest.MockedFunction<typeof beginConnect>;
const complete = completeConnect as jest.MockedFunction<typeof completeConnect>;

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
});
