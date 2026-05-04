import express from "express";
import request from "supertest";
import type { AuthenticatedRequest } from "../auth/authMiddleware";
import { createWorkspaceRoutes } from "./workspaceRoutes";

function buildApp(queryImpl: jest.Mock) {
  const app = express();
  app.use((req: AuthenticatedRequest, _res, next) => {
    req.auth = { sub: "user-123", email: "test@example.com" };
    next();
  });
  app.use("/api/workspaces", createWorkspaceRoutes({ query: queryImpl } as never));
  return app;
}

describe("workspaceRoutes", () => {
  it("lists member workspaces with derived slugs", async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [
        { id: "22222222-2222-4222-8222-222222222222", name: "Acme AI" },
        { id: "33333333-3333-4333-8333-333333333333", name: "Ops / North America" },
      ],
    });
    const app = buildApp(query);

    const res = await request(app)
      .get("/api/workspaces")
      .set("Authorization", "Bearer user-123");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      workspaces: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          name: "Acme AI",
          slug: "acme-ai",
        },
        {
          id: "33333333-3333-4333-8333-333333333333",
          name: "Ops / North America",
          slug: "ops-north-america",
        },
      ],
      total: 2,
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("FROM workspaces"), ["user-123"]);
  });
});
