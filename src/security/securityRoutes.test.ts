import express from "express";
import request from "supertest";
import { createSecurityRoutes } from "./securityRoutes";
import { SecurityServiceError, type SecurityService } from "./securityService";

function createMockService(): jest.Mocked<SecurityService> {
  return {
    listSessions: jest.fn(),
    updatePassword: jest.fn(),
    revokeSession: jest.fn(),
    revokeOtherSessions: jest.fn(),
  };
}

function createApp(service: SecurityService, options: { userId?: string; workspaceId?: string; sessionId?: string } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const typed = req as typeof req & {
      auth?: { sub: string; sessionId?: string };
      workspaceId?: string;
    };
    if (options.userId !== undefined) {
      typed.auth = { sub: options.userId, sessionId: options.sessionId };
    }
    if (options.workspaceId !== undefined) {
      typed.workspaceId = options.workspaceId;
    }
    next();
  });
  app.use("/api/security", createSecurityRoutes(service));
  return app;
}

describe("securityRoutes", () => {
  it("lists live sessions for the authenticated workspace user", async () => {
    const service = createMockService();
    service.listSessions.mockResolvedValue({
      sessions: [
        {
          id: "session-1",
          device: "Chrome on macOS",
          deviceType: "desktop",
          ip: "203.0.113.10",
          location: "Unknown location",
          lastActive: "2026-05-19T12:00:00.000Z",
          createdAt: "2026-05-19T11:00:00.000Z",
          current: true,
        },
      ],
      total: 1,
      capabilities: {
        canListOtherSessions: true,
        canRevokeSelectedSessions: true,
        canRevokeOtherSessions: true,
      },
    });

    const res = await request(createApp(service, {
      userId: "user-1",
      workspaceId: "workspace-1",
      sessionId: "session-1",
    }))
      .get("/api/security/sessions")
      .set("Authorization", "Bearer access-token")
      .set("User-Agent", "Chrome Test");

    expect(res.status).toBe(200);
    expect(res.body.sessions).toHaveLength(1);
    expect(service.listSessions).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1",
      workspaceId: "workspace-1",
      accessToken: "access-token",
      sessionId: "session-1",
      userAgent: "Chrome Test",
    }));
  });

  it("updates the password with validation", async () => {
    const service = createMockService();
    service.updatePassword.mockResolvedValue(undefined);

    const app = createApp(service, { userId: "user-1", workspaceId: "workspace-1" });
    const bad = await request(app)
      .post("/api/security/password")
      .set("Authorization", "Bearer access-token")
      .send({ currentPassword: "old", newPassword: "short" });
    expect(bad.status).toBe(400);
    expect(service.updatePassword).not.toHaveBeenCalled();

    const ok = await request(app)
      .post("/api/security/password")
      .set("Authorization", "Bearer access-token")
      .send({ currentPassword: "old-password", newPassword: "a much safer password" });

    expect(ok.status).toBe(204);
    expect(service.updatePassword).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", workspaceId: "workspace-1" }),
      { currentPassword: "old-password", newPassword: "a much safer password" },
    );
  });

  it("revokes selected and other sessions", async () => {
    const service = createMockService();
    service.revokeSession.mockResolvedValue({ currentSessionRevoked: false });
    service.revokeOtherSessions.mockResolvedValue(undefined);

    const app = createApp(service, { userId: "user-1", workspaceId: "workspace-1", sessionId: "current-session" });
    const selected = await request(app)
      .delete("/api/security/sessions/session-2")
      .set("Authorization", "Bearer access-token");

    expect(selected.status).toBe(200);
    expect(selected.body).toEqual({ currentSessionRevoked: false });
    expect(service.revokeSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "current-session" }),
      "session-2",
    );

    const others = await request(app)
      .post("/api/security/sessions/revoke-others")
      .set("Authorization", "Bearer access-token");

    expect(others.status).toBe(204);
    expect(service.revokeOtherSessions).toHaveBeenCalledTimes(1);
  });

  it("maps service errors and missing context", async () => {
    const service = createMockService();
    service.updatePassword.mockRejectedValue(new SecurityServiceError("Reauthentication is required.", 401, "reauth_required"));

    const missingAuth = await request(createApp(service, { userId: "user-1", workspaceId: "workspace-1" }))
      .get("/api/security/sessions");
    expect(missingAuth.status).toBe(401);

    const missingWorkspace = await request(createApp(service, { userId: "user-1" }))
      .get("/api/security/sessions")
      .set("Authorization", "Bearer access-token");
    expect(missingWorkspace.status).toBe(400);

    const mapped = await request(createApp(service, { userId: "user-1", workspaceId: "workspace-1" }))
      .post("/api/security/password")
      .set("Authorization", "Bearer access-token")
      .send({ currentPassword: "old-password", newPassword: "a much safer password" });
    expect(mapped.status).toBe(401);
    expect(mapped.body.code).toBe("reauth_required");
  });
});
