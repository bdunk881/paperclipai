import { loadGenerationToolCatalog } from "./toolCatalogProvider";
import { queryToolkitCatalog, type ToolkitCatalogEntry, type ToolkitCatalogPage } from "../integrations/composio/broker/toolkitCatalog";
import { listConnections, type ConnectionView } from "../integrations/composio/broker/connectionService";
import type { ComposioConnectionStatus } from "../integrations/composio/broker/connectedAccountStore";

jest.mock("../integrations/composio/broker/toolkitCatalog", () => ({
  queryToolkitCatalog: jest.fn(),
}));
jest.mock("../integrations/composio/broker/connectionService", () => ({
  listConnections: jest.fn(),
}));

const mockQuery = queryToolkitCatalog as jest.MockedFunction<typeof queryToolkitCatalog>;
const mockListConnections = listConnections as jest.MockedFunction<typeof listConnections>;

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

function conn(toolkit: string, status: ComposioConnectionStatus): ConnectionView {
  return {
    connectedAccountId: `ca_${toolkit}`,
    toolkit,
    status,
    authConfigId: `ac_${toolkit}`,
    createdAt: "2026-06-06T00:00:00.000Z",
    updatedAt: "2026-06-06T00:00:00.000Z",
  };
}

describe("loadGenerationToolCatalog (HEL-760 / P5a)", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV, COMPOSIO_ENABLED: "true", COMPOSIO_API_KEY: "ck_test" };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("returns available:false + empty lists when Composio is disabled", async () => {
    delete process.env.COMPOSIO_API_KEY;
    await expect(loadGenerationToolCatalog({ workspaceId: "ws-A", userId: "user-A" })).resolves.toEqual({
      connected: [],
      catalog: [],
      available: false,
    });
    expect(mockListConnections).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("reports only ACTIVE (reconciled) connections + a catalog slice excluding them", async () => {
    // listConnections reconciles live status; here slack came back EXPIRED, so it
    // must NOT be reported as connected even though a local row might say ACTIVE.
    mockListConnections.mockResolvedValue([conn("github", "ACTIVE"), conn("slack", "EXPIRED")]);
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
    expect(res.catalog.map((t) => t.slug)).toEqual(["notion", "linear"]); // github excluded (connected)
    expect(mockListConnections).toHaveBeenCalledWith({ workspaceId: "ws-A", userId: "user-A" });
    expect(mockQuery).toHaveBeenCalledWith({ search: "code", connectableOnly: true, limit: 10 });
  });

  it("falls back to the slug as the name for a connected toolkit absent from the catalog slice", async () => {
    mockListConnections.mockResolvedValue([conn("obscure_app", "ACTIVE")]);
    mockQuery.mockResolvedValue(page([entry("notion", "Notion")]));

    const res = await loadGenerationToolCatalog({ workspaceId: "ws-A", userId: "user-A" });

    expect(res.connected).toEqual([{ slug: "obscure_app", name: "obscure_app", status: "ACTIVE" }]);
    expect(res.catalog.map((t) => t.slug)).toEqual(["notion"]);
  });

  it("never throws — returns empty on a broker/catalog error", async () => {
    mockListConnections.mockResolvedValue([conn("github", "ACTIVE")]);
    mockQuery.mockRejectedValue(new Error("broker down"));
    await expect(loadGenerationToolCatalog({ workspaceId: "ws-A", userId: "user-A" })).resolves.toEqual({
      connected: [],
      catalog: [],
      available: false,
    });
  });
});
