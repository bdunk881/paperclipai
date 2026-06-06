import {
  loadCatalog,
  queryToolkitCatalog,
  resetToolkitCatalogForTests,
} from "./toolkitCatalog";
import { getComposioBroker } from "./client";

jest.mock("./client", () => ({
  getComposioBroker: jest.fn(),
  resetComposioBrokerForTests: jest.fn(),
}));

const getBroker = getComposioBroker as jest.MockedFunction<typeof getComposioBroker>;

const RAW = [
  {
    slug: "github",
    name: "GitHub",
    meta: {
      logo: "https://logo/github.png",
      description: "Code hosting",
      categories: [{ slug: "developer-tools", name: "Developer Tools" }],
      toolsCount: 50,
      triggersCount: 5,
    },
    authSchemes: ["OAUTH2"],
    composioManagedAuthSchemes: ["OAUTH2"],
    noAuth: false,
  },
  {
    slug: "slack",
    name: "Slack",
    meta: {
      logo: "https://logo/slack.png",
      description: "Team chat",
      categories: [{ slug: "communication", name: "Communication" }],
      toolsCount: 30,
      triggersCount: 3,
    },
    authSchemes: ["OAUTH2"],
    composioManagedAuthSchemes: ["OAUTH2"],
  },
  {
    // sparse item — exercises the normalization defaults
    slug: "gmail",
    name: "Gmail",
    meta: { description: "Email", categories: [{ slug: "communication", name: "Communication" }] },
  },
];

describe("toolkitCatalog (HEL-745)", () => {
  const ORIGINAL_ENV = { ...process.env };
  const toolkitsGetMock = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    resetToolkitCatalogForTests();
    process.env = { ...ORIGINAL_ENV, COMPOSIO_ENABLED: "true", COMPOSIO_API_KEY: "ck_test" };
    toolkitsGetMock.mockResolvedValue(RAW);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getBroker.mockResolvedValue({ toolkits: { get: toolkitsGetMock } } as any);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("fetches, normalizes, and caches the catalog (one Composio call)", async () => {
    const entries = await loadCatalog();

    expect(entries).toHaveLength(3);
    expect(toolkitsGetMock).toHaveBeenCalledWith({ managedBy: "all", sortBy: "alphabetically" });
    expect(entries[0]).toEqual({
      slug: "github",
      name: "GitHub",
      logo: "https://logo/github.png",
      description: "Code hosting",
      categories: [{ slug: "developer-tools", name: "Developer Tools" }],
      toolsCount: 50,
      triggersCount: 5,
      authSchemes: ["OAUTH2"],
      composioManagedAuthSchemes: ["OAUTH2"],
      noAuth: false,
    });
    // sparse item → normalization defaults
    expect(entries[2]).toMatchObject({
      slug: "gmail",
      logo: null,
      toolsCount: null,
      triggersCount: null,
      authSchemes: [],
      composioManagedAuthSchemes: [],
      noAuth: false,
    });

    // second call is served from cache
    await loadCatalog();
    expect(toolkitsGetMock).toHaveBeenCalledTimes(1);
  });

  it("refetches when forced", async () => {
    await loadCatalog();
    await loadCatalog(true);
    expect(toolkitsGetMock).toHaveBeenCalledTimes(2);
  });

  it("searches across slug, name, and description", async () => {
    const bySlug = await queryToolkitCatalog({ search: "git" });
    expect(bySlug.toolkits.map((t) => t.slug)).toEqual(["github"]);

    // "team" only appears in Slack's description ("Team chat")
    const byDescription = await queryToolkitCatalog({ search: "team" });
    expect(byDescription.toolkits.map((t) => t.slug)).toEqual(["slack"]);
  });

  it("filters by category", async () => {
    const page = await queryToolkitCatalog({ category: "communication" });
    expect(page.toolkits.map((t) => t.slug)).toEqual(["slack", "gmail"]);
    expect(page.total).toBe(2);
  });

  it("hides toolkits that aren't connectable via managed auth", async () => {
    // gmail has no composioManagedAuthSchemes and noAuth is undefined → not connectable.
    const page = await queryToolkitCatalog({ connectableOnly: true });
    expect(page.toolkits.map((t) => t.slug)).toEqual(["github", "slack"]);
    expect(page.total).toBe(2);
  });

  it("paginates with limit + cursor", async () => {
    const first = await queryToolkitCatalog({ limit: 2 });
    expect(first.toolkits.map((t) => t.slug)).toEqual(["github", "slack"]);
    expect(first.total).toBe(3);
    expect(first.nextCursor).toBe("2");

    const second = await queryToolkitCatalog({ limit: 2, cursor: first.nextCursor! });
    expect(second.toolkits.map((t) => t.slug)).toEqual(["gmail"]);
    expect(second.nextCursor).toBeNull();
  });
});
