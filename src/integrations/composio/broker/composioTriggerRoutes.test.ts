import express from "express";
import request from "supertest";

jest.mock("./config", () => ({ isComposioEnabled: jest.fn() }));
jest.mock("./triggerSubscriptionService", () => ({
  enableTrigger: jest.fn(),
  deleteTrigger: jest.fn(),
  getTriggerType: jest.fn(),
  listTriggerTypes: jest.fn(),
}));
jest.mock("./triggerInstanceStore", () => ({
  triggerInstanceStore: { listByWorkspace: jest.fn() },
}));

import { composioTriggerRouter } from "./composioTriggerRoutes";
import { isComposioEnabled } from "./config";
import {
  enableTrigger,
  deleteTrigger,
  getTriggerType,
  listTriggerTypes,
} from "./triggerSubscriptionService";
import { triggerInstanceStore } from "./triggerInstanceStore";

const enabled = isComposioEnabled as jest.MockedFunction<typeof isComposioEnabled>;
const mEnable = enableTrigger as jest.MockedFunction<typeof enableTrigger>;
const mDelete = deleteTrigger as jest.MockedFunction<typeof deleteTrigger>;
const mGetType = getTriggerType as jest.MockedFunction<typeof getTriggerType>;
const mListTypes = listTriggerTypes as jest.MockedFunction<typeof listTriggerTypes>;
const mList = triggerInstanceStore.listByWorkspace as jest.MockedFunction<
  typeof triggerInstanceStore.listByWorkspace
>;

function authedApp() {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/composio",
    (req, _res, next) => {
      (req as express.Request & { auth?: unknown; workspaceId?: string }).auth = { sub: "user-A" };
      (req as express.Request & { workspaceId?: string }).workspaceId = "ws-A";
      next();
    },
    composioTriggerRouter,
  );
  return app;
}

describe("composio trigger routes (HEL-767 / P4-c)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    enabled.mockReturnValue(true);
  });

  it("GET /triggers lists the workspace's subscriptions", async () => {
    mList.mockResolvedValue([{ triggerId: "ti_1" }] as never);
    const res = await request(authedApp()).get("/api/composio/triggers");
    expect(res.status).toBe(200);
    expect(res.body.triggers).toEqual([{ triggerId: "ti_1" }]);
    expect(mList).toHaveBeenCalledWith({ workspaceId: "ws-A", userId: "user-A" });
  });

  it("GET /triggers/types?toolkit= lists a toolkit's trigger types", async () => {
    mListTypes.mockResolvedValue([{ slug: "GITHUB_COMMIT_EVENT" }] as never);
    const res = await request(authedApp()).get("/api/composio/triggers/types?toolkit=github");
    expect(res.status).toBe(200);
    expect(res.body.types).toEqual([{ slug: "GITHUB_COMMIT_EVENT" }]);
    expect(mListTypes).toHaveBeenCalledWith("github");
  });

  it("GET /triggers/types requires a toolkit", async () => {
    const res = await request(authedApp()).get("/api/composio/triggers/types");
    expect(res.status).toBe(400);
  });

  it("GET /triggers/types/:slug returns the type's schema", async () => {
    mGetType.mockResolvedValue({ slug: "GITHUB_COMMIT_EVENT", config: {} } as never);
    const res = await request(authedApp()).get("/api/composio/triggers/types/GITHUB_COMMIT_EVENT");
    expect(res.status).toBe(200);
    expect(res.body.type).toMatchObject({ slug: "GITHUB_COMMIT_EVENT" });
    expect(mGetType).toHaveBeenCalledWith("GITHUB_COMMIT_EVENT");
  });

  it("POST /triggers subscribes + binds to an agent (201)", async () => {
    mEnable.mockResolvedValue({ triggerId: "ti_1", agentId: "agent-1" } as never);
    const res = await request(authedApp())
      .post("/api/composio/triggers")
      .send({ toolkit: "github", slug: "GITHUB_COMMIT_EVENT", agentId: "agent-1", triggerConfig: { repo: "a/b" } });
    expect(res.status).toBe(201);
    expect(res.body.trigger).toMatchObject({ triggerId: "ti_1" });
    expect(mEnable).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws-A",
        userId: "user-A",
        agentId: "agent-1",
        toolkit: "github",
        slug: "GITHUB_COMMIT_EVENT",
        triggerConfig: { repo: "a/b" },
      }),
    );
  });

  it("POST /triggers 400s without toolkit/slug/agentId", async () => {
    const res = await request(authedApp()).post("/api/composio/triggers").send({ toolkit: "github" });
    expect(res.status).toBe(400);
    expect(mEnable).not.toHaveBeenCalled();
  });

  it("DELETE /triggers/:id removes a subscription (204)", async () => {
    mDelete.mockResolvedValue(true);
    const res = await request(authedApp()).delete("/api/composio/triggers/ti_1");
    expect(res.status).toBe(204);
    expect(mDelete).toHaveBeenCalledWith({ workspaceId: "ws-A", userId: "user-A" }, "ti_1");
  });

  it("DELETE /triggers/:id 404s when the trigger is missing", async () => {
    mDelete.mockResolvedValue(false);
    const res = await request(authedApp()).delete("/api/composio/triggers/ti_x");
    expect(res.status).toBe(404);
  });

  it("503 when Composio is disabled", async () => {
    enabled.mockReturnValue(false);
    const res = await request(authedApp())
      .post("/api/composio/triggers")
      .send({ toolkit: "github", slug: "S", agentId: "a" });
    expect(res.status).toBe(503);
    expect(mEnable).not.toHaveBeenCalled();
  });
});
