import { loadGenerationToolCatalog } from "./toolCatalogProvider";
import { queryToolkitCatalog, type ToolkitCatalogEntry, type ToolkitCatalogPage } from "../integrations/composio/broker/toolkitCatalog";
import { connectedAccountStore, type ComposioWorkspaceContext } from "../integrations/composio/broker/connectedAccountStore";

jest.mock("../integrations/composio/broker/toolkitCatalog", () => ({
  queryToolkitCatalog: jest.fn(),
}));

const mockQuery = queryToolkitCatalog as jest.MockedFunction<typeof queryToolkitCatalog>;

function entry(slug: string, name: string, description: string | null = null): ToolkitCatalogEntry {
  return {
    slug,
    name,
    logo: null,
    description,
    categories: [],
    toolsCount: null,
    triggersCount: null,
    authSchemes: [],
    composioManagedAuthSchemes: [],
    noAuth: false,
  };
}

function page(toolkits: ToolkitCatalogEntry[]): ToolkitCatalogPage {
  return { toolkits, total: toolkits.length, nextCursor: null };
}

// In jest the connectedAccountStore uses its in-memory backend (jest.env.cjs).
describe("loadGenerationToolCatalog (HEL-760 / P5a)", () => {
  const ORIGINAL_ENV = { ...process.env };
  const ctx: ComposioWorkspaceContext = { workspaceId: "ws-A", userId: "user-A" };

  beforeEach(() => {
    jest.clearAllMocks();
    connectedAccountStore.__resetForTests();
    process.env = { ...ORIGINAL_ENV, COMPOSIO_ENABLED: "true", COMPOSIO_API_KEY: "ck_test" };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  async function connect(toolkit: string, caId: string, status: "ACTIVE" | "INITIATED" | "EXPIRED" = "ACTIVE") {
    await connectedAccountStore.upsert(ctx, {
      toolkit,
      connectedAccountId: caId,
      authConfigId: `ac_${caId}`,
      status,
    });
  }

  it("returns available:false + empty lists when Composio is disabled", async () => {
    delete process.env.COMPOSIO_API_KEY;
    await connect("github", "ca_gh");
    await expect(loadGenerationToolCatalog({ workspaceId: "ws-A", userId: "user-A" })).resolves.toEqual({
      connected: [],
      catalog: [],
      available: false,
    });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns ACTIVE connected toolkits + a catalog slice that excludes them", async () => {
    await connect("github", "ca_gh", "ACTIVE");
    await connect("slack", "ca_sl", "INITIATED"); // not ACTIVE → not connected
    mockQuery.mockResolvedValue(
      page([entry("github", "GitHub", "Code"), entry("notion", "Notion", "Docs"), entry("linear", "Linear", "Issues")]),
    );

    const res = await loadGenerationToolCatalog({
      workspaceId: "ws-A",
      userId: "user-A",
      search: "code",
      catalogLimit: 10,
    });

    expect(res.available).toBe(true);
    expect(res.connected).toEqual([{ slug: "github", name: "GitHub", status: "ACTIVE" }]);
    expect(res.catalog.map((t) => t.slug)).toEqual(["notion", "linear"]); // github excluded (already connected)
    expect(mockQuery).toHaveBeenCalledWith({ search: "code", connectableOnly: true, limit: 10 });
  });

  it("falls back to the slug as the name for a connected toolkit absent from the catalog slice", async () => {
    await connect("obscure_app", "ca_x", "ACTIVE");
    mockQuery.mockResolvedValue(page([entry("notion", "Notion")]));

    const res = await loadGenerationToolCatalog({ workspaceId: "ws-A", userId: "user-A" });

    expect(res.connected).toEqual([{ slug: "obscure_app", name: "obscure_app", status: "ACTIVE" }]);
    expect(res.catalog.map((t) => t.slug)).toEqual(["notion"]);
  });

  it("never throws — returns empty on a broker/catalog error", async () => {
    await connect("github", "ca_gh");
    mockQuery.mockRejectedValue(new Error("broker down"));
    await expect(loadGenerationToolCatalog({ workspaceId: "ws-A", userId: "user-A" })).resolves.toEqual({
      connected: [],
      catalog: [],
      available: false,
    });
  });
});
