import {
  computeToolkitsToConnect,
  loadComposioToolkitSlugSet,
  loadGenerationToolCatalog,
  recognizeComposioToolkitSlugs,
} from "./toolCatalogProvider";
import {
  loadCatalog,
  queryToolkitCatalog,
  type ToolkitCatalogEntry,
  type ToolkitCatalogPage,
} from "../integrations/composio/broker/toolkitCatalog";
import { listConnections, type ConnectionView } from "../integrations/composio/broker/connectionService";
import type { ComposioConnectionStatus } from "../integrations/composio/broker/connectedAccountStore";

jest.mock("../integrations/composio/broker/toolkitCatalog", () => ({
  queryToolkitCatalog: jest.fn(),
  loadCatalog: jest.fn(),
}));
jest.mock("../integrations/composio/broker/connectionService", () => ({
  listConnections: jest.fn(),
}));

const mockQuery = queryToolkitCatalog as jest.MockedFunction<typeof queryToolkitCatalog>;
const mockLoadCatalog = loadCatalog as jest.MockedFunction<typeof loadCatalog>;
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

describe("recognizeComposioToolkitSlugs (HEL-762)", () => {
  it("keeps only real toolkit slugs, deduped + lowercased", () => {
    const set = new Set(["github", "slack", "gmail"]);
    expect(
      recognizeComposioToolkitSlugs(["GitHub", "heygen", "slack", "slack", "buffer"], set),
    ).toEqual(["github", "slack"]);
  });

  it("returns [] when nothing matches (free-text only)", () => {
    expect(recognizeComposioToolkitSlugs(["heygen", "buffer"], new Set(["github"]))).toEqual([]);
  });
});

describe("loadComposioToolkitSlugSet (HEL-762)", () => {
  const ORIGINAL = { ...process.env };
  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...ORIGINAL, COMPOSIO_ENABLED: "true", COMPOSIO_API_KEY: "ck_test" };
  });
  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  it("returns the lowercased catalog slugs when enabled", async () => {
    mockLoadCatalog.mockResolvedValue([entry("github", "GitHub"), entry("slack", "Slack")]);
    await expect(loadComposioToolkitSlugSet()).resolves.toEqual(new Set(["github", "slack"]));
  });

  it("returns an empty set when Composio is disabled", async () => {
    delete process.env.COMPOSIO_API_KEY;
    await expect(loadComposioToolkitSlugSet()).resolves.toEqual(new Set());
    expect(mockLoadCatalog).not.toHaveBeenCalled();
  });

  it("returns an empty set on a catalog error (best-effort)", async () => {
    mockLoadCatalog.mockRejectedValue(new Error("broker down"));
    await expect(loadComposioToolkitSlugSet()).resolves.toEqual(new Set());
  });
});

describe("computeToolkitsToConnect (HEL-763)", () => {
  const ORIGINAL = { ...process.env };
  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...ORIGINAL, COMPOSIO_ENABLED: "true", COMPOSIO_API_KEY: "ck_test" };
  });
  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  it("returns recognized chosen toolkits that aren't ACTIVE-connected (with names)", async () => {
    mockLoadCatalog.mockResolvedValue([entry("github", "GitHub"), entry("slack", "Slack"), entry("notion", "Notion")]);
    // github ACTIVE (connected → excluded); slack EXPIRED (not active → needs (re)connect).
    mockListConnections.mockResolvedValue([conn("github", "ACTIVE"), conn("slack", "EXPIRED")]);

    const res = await computeToolkitsToConnect({
      workspaceId: "ws-A",
      userId: "user-A",
      // notion = not connected; heygen = not a real toolkit (dropped).
      planToolSlugs: ["github", "slack", "notion", "heygen"],
    });

    expect(res).toEqual([
      { slug: "slack", name: "Slack" },
      { slug: "notion", name: "Notion" },
    ]);
  });

  it("returns [] when every chosen toolkit is already connected", async () => {
    mockLoadCatalog.mockResolvedValue([entry("github", "GitHub")]);
    mockListConnections.mockResolvedValue([conn("github", "ACTIVE")]);
    await expect(
      computeToolkitsToConnect({ workspaceId: "ws-A", userId: "user-A", planToolSlugs: ["github"] }),
    ).resolves.toEqual([]);
  });

  it("returns [] when Composio is disabled", async () => {
    delete process.env.COMPOSIO_API_KEY;
    await expect(
      computeToolkitsToConnect({ workspaceId: "ws-A", userId: "user-A", planToolSlugs: ["github"] }),
    ).resolves.toEqual([]);
    expect(mockLoadCatalog).not.toHaveBeenCalled();
  });
});
