import express from "express";
import request from "supertest";
import router from "./mcpRoutes";
import { mcpStore } from "./mcpStore";

const callMock = jest.fn();
const pingMock = jest.fn();

jest.mock("./mcpUrlSecurity", () => ({
  assertSafeMcpUrl: jest.fn(async (url: string) => url),
}));

jest.mock("./mcpClient", () => ({
  mcpClient: {
    register: jest.fn(),
    unregister: jest.fn(),
    call: (...args: unknown[]) => callMock(...args),
    ping: (...args: unknown[]) => pingMock(...args),
  },
}));

describe("mcp routes", () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as typeof req & { auth: { sub: string } }).auth = { sub: "user-123" };
    next();
  });
  app.use("/api/mcp/servers", router);

  beforeEach(() => {
    mcpStore._clear();
    jest.clearAllMocks();
  });

  it("lists prebuilt MCP presets plus CustomMCP template", async () => {
    const response = await request(app).get("/api/mcp/servers/library");

    expect(response.status).toBe(200);
    expect(response.body.presets).toHaveLength(5);
    expect(response.body.presets[0]).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        configFields: expect.any(Array),
      })
    );
    expect(response.body.customTemplate.name).toBe("CustomMCP");
  });

  it("registers a preset-backed server using preset defaults", async () => {
    const response = await request(app)
      .post("/api/mcp/servers")
      .send({ presetId: "github", authHeaderValue: "Bearer ghp_test" });

    expect(response.status).toBe(201);
    expect(response.body).toEqual(
      expect.objectContaining({
        name: "GitHub MCP",
        presetId: "github",
        source: "preset",
        authHeaderKey: "Authorization",
        hasAuth: true,
      })
    );
  });

  it("discovers tools and updates cached health state", async () => {
    const createResponse = await request(app)
      .post("/api/mcp/servers")
      .send({ name: "Custom", url: "https://mcp.example.com" });

    callMock.mockResolvedValue({
      tools: [{ name: "search", description: "Search content" }],
    });

    const toolsResponse = await request(app).get(`/api/mcp/servers/${createResponse.body.id}/tools`);
    expect(toolsResponse.status).toBe(200);
    expect(toolsResponse.body.tools).toEqual([{ name: "search", description: "Search content" }]);

    const detailResponse = await request(app).get(`/api/mcp/servers/${createResponse.body.id}`);
    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.server).toEqual(
      expect.objectContaining({
        status: "healthy",
        tools: [{ name: "search", description: "Search content" }],
      })
    );
  });

  it("returns degraded health state after a failed test probe", async () => {
    const createResponse = await request(app)
      .post("/api/mcp/servers")
      .send({ name: "Custom", url: "https://mcp.example.com" });

    pingMock.mockRejectedValue(new Error("upstream timeout"));

    const testResponse = await request(app).post(`/api/mcp/servers/${createResponse.body.id}/test`).send({});
    expect(testResponse.status).toBe(502);
    expect(testResponse.body.ok).toBe(false);

    const healthResponse = await request(app).get(`/api/mcp/servers/${createResponse.body.id}/health`);
    expect(healthResponse.status).toBe(200);
    expect(healthResponse.body).toEqual(
      expect.objectContaining({
        status: "degraded",
        lastError: "upstream timeout",
      })
    );
  });
});
