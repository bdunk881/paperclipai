import express from "express";
import request from "supertest";
import { AuthenticatedRequest } from "../auth/authMiddleware";
import { WorkspaceAwareRequest } from "../middleware/workspaceResolver";
import notificationRoutes from "./routes";
import { notificationService } from "./service";

jest.mock("../auth/authMiddleware", () => ({
  requireAuth: (
    req: { headers?: Record<string, unknown>; auth?: { sub: string; email?: string } },
    res: { status: (code: number) => { json: (body: unknown) => void } },
    next: () => void,
  ) => {
    const authHeader = typeof req.headers?.authorization === "string" ? req.headers.authorization : "";
    if (!authHeader.startsWith("Bearer ")) {
      res.status(401).json({ error: "Missing or malformed Authorization header." });
      return;
    }
    req.auth = { sub: authHeader.slice(7), email: "test@example.com" };
    next();
  },
}));

function auth(userId: string) {
  return { Authorization: `Bearer ${userId}` };
}

function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use((req: AuthenticatedRequest, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Missing or malformed Authorization header." });
      return;
    }
    req.auth = { sub: authHeader.slice(7), email: "test@example.com" };
    next();
  });
  app.use((req: WorkspaceAwareRequest, _res, next) => {
    req.workspaceId = "22222222-2222-4222-8222-222222222222";
    next();
  });
  app.use("/api/notifications", notificationRoutes);
  return app;
}

describe("notification routes", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("uses the resolved workspace context when listing preferences", async () => {
    const app = buildTestApp();
    const listPreferencesSpy = jest.spyOn(notificationService, "listPreferences").mockResolvedValue([]);

    const res = await request(app).get("/api/notifications/preferences").set(auth("user-1"));

    expect(res.status).toBe(200);
    expect(listPreferencesSpy).toHaveBeenCalledWith("22222222-2222-4222-8222-222222222222");
  });

  it("ignores a mismatched workspaceId payload when updating preferences", async () => {
    const app = buildTestApp();
    const updatePreferenceSpy = jest.spyOn(notificationService, "updatePreference").mockResolvedValue({
      id: "pref-1",
      workspaceId: "22222222-2222-4222-8222-222222222222",
      channel: "slack",
      kind: "approvals",
      cadence: "daily",
      enabled: true,
      createdAt: "2026-05-02T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z",
    });

    const res = await request(app)
      .put("/api/notifications/preferences")
      .set(auth("user-1"))
      .send({
        workspaceId: "11111111-1111-4111-8111-111111111111",
        channel: "slack",
        kind: "approvals",
        cadence: "daily",
        enabled: true,
      });

    expect(res.status).toBe(200);
    expect(updatePreferenceSpy).toHaveBeenCalledWith({
      workspaceId: "22222222-2222-4222-8222-222222222222",
      channel: "slack",
      kind: "approvals",
      cadence: "daily",
      enabled: true,
      mutedUntil: undefined,
    });
  });
});
