import { beforeEach, describe, it, expect, vi } from "vitest";

beforeEach(() => {
  vi.restoreAllMocks();
});

function mockFetch(status: number, body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    })
  );
}

const BASE_TEMPLATE = {
  id: "tmpl-ops",
  name: "Operations Lead",
  description: "Handles operational workflows",
  defaultModel: "gpt-4o",
  defaultInstructions: "Run operations",
  defaultSkills: ["skill-b", "skill-a"],
};

describe("listAgentCatalogTemplates", () => {
  it("returns mapped templates on success", async () => {
    mockFetch(200, { roleTemplates: [BASE_TEMPLATE] });
    const { listAgentCatalogTemplates } = await import("./agentCatalog");
    const result = await listAgentCatalogTemplates("tok");
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("tmpl-ops");
    expect(result[0]!.skills).toEqual(["skill-a", "skill-b"]);
  });

  it("throws on non-ok response", async () => {
    mockFetch(403, {});
    const { listAgentCatalogTemplates } = await import("./agentCatalog");
    await expect(listAgentCatalogTemplates("tok")).rejects.toThrow(/403/);
  });

  it("sends Authorization header", async () => {
    mockFetch(200, { roleTemplates: [] });
    const { listAgentCatalogTemplates } = await import("./agentCatalog");
    await listAgentCatalogTemplates("my-token");
    const fetchMock = vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>);
    const options = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((options.headers as Record<string, string>).Authorization).toBe("Bearer my-token");
  });
});

// ---------------------------------------------------------------------------
// categorizeTemplate (tested via listAgentCatalogTemplates → mapTemplate)
// ---------------------------------------------------------------------------
describe("categorizeTemplate", () => {
  async function categoryFor(partial: Partial<typeof BASE_TEMPLATE>): Promise<string> {
    mockFetch(200, { roleTemplates: [{ ...BASE_TEMPLATE, ...partial }] });
    const { listAgentCatalogTemplates } = await import("./agentCatalog");
    const result = await listAgentCatalogTemplates("tok");
    return result[0]!.category;
  }

  it("returns 'Sales' when name contains 'sales'", async () => {
    expect(await categoryFor({ name: "Sales Executive" })).toBe("Sales");
  });

  it("returns 'Sales' when description contains 'revenue'", async () => {
    expect(await categoryFor({ description: "Grows revenue pipeline" })).toBe("Sales");
  });

  it("returns 'Support' when name contains 'support'", async () => {
    expect(await categoryFor({ name: "Support Agent", description: "Handles tickets" })).toBe("Support");
  });

  it("returns 'Marketing' when name contains 'marketing'", async () => {
    expect(await categoryFor({ name: "Marketing Manager", description: "Runs campaigns" })).toBe("Marketing");
  });

  it("returns 'Engineering' when name contains 'engineer'", async () => {
    expect(await categoryFor({ name: "Engineering Lead", description: "Oversees builds" })).toBe("Engineering");
  });

  it("defaults to 'Operations' when no category keywords match", async () => {
    expect(await categoryFor({ id: "tmpl-fin", name: "Finance Advisor", description: "Handles budgets" })).toBe("Operations");
  });
});

// ---------------------------------------------------------------------------
// suggestedBudgetForTemplate (tested via listAgentCatalogTemplates → mapTemplate)
// ---------------------------------------------------------------------------
describe("suggestedBudgetForTemplate", () => {
  async function budgetFor(defaultModel: string | undefined): Promise<number> {
    mockFetch(200, { roleTemplates: [{ ...BASE_TEMPLATE, defaultModel }] });
    const { listAgentCatalogTemplates } = await import("./agentCatalog");
    const result = await listAgentCatalogTemplates("tok");
    return result[0]!.suggestedBudgetMonthlyUsd;
  }

  it("returns 0 when defaultModel is undefined", async () => {
    expect(await budgetFor(undefined)).toBe(0);
  });

  it("returns 50 for a 'mini' model", async () => {
    expect(await budgetFor("gpt-4o-mini")).toBe(50);
  });

  it("returns 100 for a non-mini model", async () => {
    expect(await budgetFor("gpt-4o")).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// getAgentCatalogTemplate
// ---------------------------------------------------------------------------
describe("getAgentCatalogTemplate", () => {
  it("returns the matching template when found", async () => {
    mockFetch(200, { roleTemplates: [BASE_TEMPLATE] });
    const { getAgentCatalogTemplate } = await import("./agentCatalog");
    const result = await getAgentCatalogTemplate("tmpl-ops", "tok");
    expect(result).not.toBeNull();
    expect(result!.id).toBe("tmpl-ops");
  });

  it("returns null when the template is not found", async () => {
    mockFetch(200, { roleTemplates: [BASE_TEMPLATE] });
    const { getAgentCatalogTemplate } = await import("./agentCatalog");
    const result = await getAgentCatalogTemplate("tmpl-missing", "tok");
    expect(result).toBeNull();
  });
});
