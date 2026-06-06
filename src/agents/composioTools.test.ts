import {
  loadComposioAgentTools,
  resetComposioAgentToolsCacheForTests,
} from "./composioTools";
import {
  listComposioToolsForToolkit,
  executeComposioTool,
} from "../integrations/composio/broker/toolExecution";
import { connectedAccountStore, type ComposioWorkspaceContext } from "../integrations/composio/broker/connectedAccountStore";

jest.mock("../integrations/composio/broker/toolExecution", () => ({
  listComposioToolsForToolkit: jest.fn(),
  executeComposioTool: jest.fn(),
}));

const mockList = listComposioToolsForToolkit as jest.MockedFunction<typeof listComposioToolsForToolkit>;
const mockExec = executeComposioTool as jest.MockedFunction<typeof executeComposioTool>;

// In jest the connectedAccountStore uses its in-memory backend (jest.env.cjs).
describe("loadComposioAgentTools (HEL-755 / P3b)", () => {
  const ORIGINAL_ENV = { ...process.env };
  const ctx: ComposioWorkspaceContext = { workspaceId: "ws-A", userId: "user-A" };

  beforeEach(() => {
    jest.clearAllMocks();
    connectedAccountStore.__resetForTests();
    resetComposioAgentToolsCacheForTests();
    process.env = { ...ORIGINAL_ENV, COMPOSIO_ENABLED: "true", COMPOSIO_API_KEY: "ck_test" };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  async function connect(toolkit: string, caId: string, status: "ACTIVE" | "INITIATED" = "ACTIVE") {
    await connectedAccountStore.upsert(ctx, {
      toolkit,
      connectedAccountId: caId,
      authConfigId: `ac_${caId}`,
      status,
    });
  }

  it("returns [] when Composio is disabled", async () => {
    delete process.env.COMPOSIO_API_KEY;
    await connect("github", "ca_gh");
    await expect(loadComposioAgentTools(ctx)).resolves.toEqual([]);
    expect(mockList).not.toHaveBeenCalled();
  });

  it("returns [] when the workspace has no active connections", async () => {
    await connect("github", "ca_gh", "INITIATED");
    await expect(loadComposioAgentTools(ctx)).resolves.toEqual([]);
  });

  it("builds integration:<toolkit>:<slug> tools and excludes high-risk writes", async () => {
    await connect("github", "ca_gh");
    mockList.mockResolvedValue([
      { slug: "GITHUB_GET_REPO", description: "Get a repo", inputParameters: { type: "object", properties: { owner: { type: "string" } } } },
      { slug: "GITHUB_CREATE_ISSUE", description: "Open an issue" },
      { slug: "GITHUB_MERGE_PULL_REQUEST", description: "Merge a PR" }, // governed → excluded
      { name: "no slug here" }, // malformed → skipped
    ]);

    const tools = await loadComposioAgentTools(ctx);

    expect(tools.map((t) => t.name).sort()).toEqual([
      "integration:github:GITHUB_CREATE_ISSUE",
      "integration:github:GITHUB_GET_REPO",
    ]);
    const getRepo = tools.find((t) => t.name === "integration:github:GITHUB_GET_REPO")!;
    expect(getRepo.description).toBe("Get a repo");
    expect(getRepo.inputSchema).toEqual({ type: "object", properties: { owner: { type: "string" } } });
  });

  it("only fetches ACTIVE toolkits", async () => {
    await connect("github", "ca_gh", "ACTIVE");
    await connect("slack", "ca_sl", "INITIATED");
    mockList.mockResolvedValue([{ slug: "GITHUB_GET_REPO" }]);

    await loadComposioAgentTools(ctx);

    expect(mockList).toHaveBeenCalledTimes(1);
    expect(mockList).toHaveBeenCalledWith(expect.objectContaining({ toolkit: "github" }));
  });

  it("the tool handler executes via executeComposioTool and surfaces failures", async () => {
    await connect("github", "ca_gh");
    mockList.mockResolvedValue([{ slug: "GITHUB_GET_REPO" }]);
    const [tool] = await loadComposioAgentTools(ctx);

    mockExec.mockResolvedValue({ successful: true, data: { full_name: "a/b" }, error: null, connectedAccountId: "ca_gh" });
    await expect(tool.handler({ owner: "a", repo: "b" })).resolves.toEqual({ full_name: "a/b" });
    expect(mockExec).toHaveBeenCalledWith({
      workspaceId: "ws-A",
      userId: "user-A",
      toolkit: "github",
      slug: "GITHUB_GET_REPO",
      arguments: { owner: "a", repo: "b" },
    });

    mockExec.mockResolvedValue({ successful: false, data: null, error: "boom", connectedAccountId: "ca_gh" });
    await expect(tool.handler({})).resolves.toEqual({ ok: false, error: "boom" });
  });

  it("caches raw tool defs per toolkit across calls", async () => {
    await connect("github", "ca_gh");
    mockList.mockResolvedValue([{ slug: "GITHUB_GET_REPO" }]);

    await loadComposioAgentTools(ctx);
    await loadComposioAgentTools(ctx);

    expect(mockList).toHaveBeenCalledTimes(1); // second call served from cache
  });
});
