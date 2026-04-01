/**
 * Tests for the mock-mode path in dashboard/src/api/client.ts.
 *
 * Sets VITE_USE_MOCK=true via import.meta.env stub so the mock data
 * branches are exercised without any real fetch calls.
 * The real-fetch path is tested in client.test.ts.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Stub import.meta.env BEFORE importing the module under test.
// Vitest re-evaluates modules per test file so this works cleanly.
// ---------------------------------------------------------------------------

beforeAll(() => {
  vi.stubEnv("VITE_USE_MOCK", "true");
});

// Dynamic import so the env stub is applied before module evaluation.
// We import lazily to ensure the module sees the stubbed env at load time.
let client: typeof import("./client");

beforeAll(async () => {
  client = await import("./client");
});

beforeEach(() => {
  // Ensure fetch is never called in mock mode
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("fetch should not be called in mock mode"))));
});

// ---------------------------------------------------------------------------
// listTemplates — mock mode
// ---------------------------------------------------------------------------

describe("listTemplates (mock mode)", () => {
  it("returns templates without calling fetch", async () => {
    const fetchSpy = vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>);
    const templates = await client.listTemplates();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(Array.isArray(templates)).toBe(true);
    expect(templates.length).toBeGreaterThan(0);
  });

  it("returns TemplateSummary shape (no steps array)", async () => {
    const templates = await client.listTemplates();
    for (const t of templates) {
      expect(typeof t.id).toBe("string");
      expect(typeof t.name).toBe("string");
      expect(typeof t.stepCount).toBe("number");
      expect((t as unknown as Record<string, unknown>).steps).toBeUndefined();
    }
  });

  it("filters by category", async () => {
    const support = await client.listTemplates("support");
    expect(support.every((t) => t.category === "support")).toBe(true);
  });

  it("returns empty array for unknown category", async () => {
    const result = await client.listTemplates("nonexistent");
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getTemplate — mock mode
// ---------------------------------------------------------------------------

describe("getTemplate (mock mode)", () => {
  it("returns a full template by id without calling fetch", async () => {
    const fetchSpy = vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>);
    const tpl = await client.getTemplate("tpl-support-bot");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(tpl.id).toBe("tpl-support-bot");
    expect(Array.isArray(tpl.steps)).toBe(true);
    expect(tpl.steps.length).toBeGreaterThan(0);
  });

  it("throws for an unknown template id", async () => {
    await expect(client.getTemplate("tpl-unknown")).rejects.toThrow(/not found/i);
  });
});

// ---------------------------------------------------------------------------
// listRuns — mock mode
// ---------------------------------------------------------------------------

describe("listRuns (mock mode)", () => {
  it("returns runs without calling fetch", async () => {
    const fetchSpy = vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>);
    const runs = await client.listRuns();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(Array.isArray(runs)).toBe(true);
  });

  it("filters by templateId", async () => {
    const allRuns = await client.listRuns();
    if (allRuns.length === 0) return; // skip if mock data is empty

    const firstTemplateId = allRuns[0].templateId;
    const filtered = await client.listRuns(firstTemplateId);
    expect(filtered.every((r) => r.templateId === firstTemplateId)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getRun — mock mode
// ---------------------------------------------------------------------------

describe("getRun (mock mode)", () => {
  it("returns a run by id", async () => {
    const runs = await client.listRuns();
    if (runs.length === 0) return;

    const target = runs[0];
    const run = await client.getRun(target.id);
    expect(run.id).toBe(target.id);
  });

  it("throws for an unknown run id", async () => {
    await expect(client.getRun("run-nonexistent-xyz")).rejects.toThrow(/not found/i);
  });
});

// ---------------------------------------------------------------------------
// startRun — mock mode
// ---------------------------------------------------------------------------

describe("startRun (mock mode)", () => {
  it("returns a new run without calling fetch", async () => {
    const fetchSpy = vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>);
    const run = await client.startRun("tpl-support-bot", { ticketId: "T-MOCK" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(run.templateId).toBe("tpl-support-bot");
    expect(typeof run.id).toBe("string");
  });

  it("new run appears in subsequent listRuns()", async () => {
    const run = await client.startRun("tpl-support-bot", {});
    const runs = await client.listRuns();
    const found = runs.find((r) => r.id === run.id);
    expect(found).toBeDefined();
  });

  it("new run has status running", async () => {
    const run = await client.startRun("tpl-support-bot", {});
    expect(run.status).toBe("running");
  });

  it("new run has startedAt timestamp", async () => {
    const run = await client.startRun("tpl-support-bot", {});
    expect(typeof run.startedAt).toBe("string");
    expect(new Date(run.startedAt).getTime()).not.toBeNaN();
  });
});
