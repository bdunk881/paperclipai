jest.mock("../db/postgres", () => ({
  isPostgresConfigured: jest.fn(() => false),
  queryPostgres: jest.fn(),
}));

import { isPostgresConfigured, queryPostgres } from "../db/postgres";
import { knowledgeStore } from "./knowledgeStore";

const mockedIsPostgresConfigured = jest.mocked(isPostgresConfigured);
const mockedQueryPostgres = jest.mocked(queryPostgres);

beforeEach(() => {
  knowledgeStore.clear();
  mockedIsPostgresConfigured.mockReset();
  mockedIsPostgresConfigured.mockReturnValue(false);
  mockedQueryPostgres.mockReset();
});

describe("knowledgeStore", () => {
  it("creates a knowledge base and ingests searchable chunks", async () => {
    const base = await knowledgeStore.createKnowledgeBase({
      userId: "user-1",
      name: "Support KB",
      description: "FAQ and support guidance",
      tags: ["support"],
    });

    const { document, chunks } = await knowledgeStore.ingestDocument({
      userId: "user-1",
      knowledgeBaseId: base.id,
      filename: "refund-policy.md",
      mimeType: "text/markdown",
      content:
        "# Refund policy\n\nCustomers can receive a refund within thirty days of purchase.\n\nEscalate billing disputes to finance.",
      sourceType: "inline",
    });

    expect(document.status).toBe("ready");
    expect(chunks.length).toBeGreaterThan(0);

    const results = await knowledgeStore.search({
      userId: "user-1",
      query: "how long do customers have to request a refund",
      knowledgeBaseIds: [base.id],
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].document.id).toBe(document.id);
    expect(results[0].chunk.text.toLowerCase()).toContain("refund");
  });

  it("supports chunk updates, splits, and merges", async () => {
    const base = await knowledgeStore.createKnowledgeBase({
      userId: "user-2",
      name: "Ops KB",
    });

    const { document, chunks } = await knowledgeStore.ingestDocument({
      userId: "user-2",
      knowledgeBaseId: base.id,
      filename: "runbook.txt",
      mimeType: "text/plain",
      content:
        "Restart the worker service after deploy. Verify the health endpoint after restart. Notify support if the queue is still delayed.",
      sourceType: "inline",
    });

    const updated = await knowledgeStore.updateChunk(chunks[0].id, "user-2", {
      text: "Restart the worker service after each deploy and verify the health endpoint.",
    });
    expect(updated?.text).toContain("health endpoint");

    const split = await knowledgeStore.splitChunk(
      chunks[0].id,
      "user-2",
      [
        "Restart the worker service after each deploy.",
        "Verify the health endpoint after restart.",
      ]
    );
    expect(split).toHaveLength(2);

    const merged = await knowledgeStore.mergeChunks(
      split!.map((chunk) => chunk.id),
      "user-2"
    );
    expect(merged?.text).toContain("Restart the worker service");

    const listed = await knowledgeStore.listChunks(document.id, "user-2");
    expect(listed.length).toBeGreaterThan(0);
  });

  it("falls back to in-memory results when postgres hydration fails", async () => {
    mockedIsPostgresConfigured.mockReturnValue(true);
    mockedQueryPostgres.mockRejectedValueOnce(new Error("connect ECONNREFUSED"));
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    await expect(knowledgeStore.listKnowledgeBases("qa-smoke-user")).resolves.toEqual([]);

    expect(mockedQueryPostgres).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      "[knowledge] Postgres hydrate failed, falling back to in-memory:",
      "connect ECONNREFUSED"
    );

    errorSpy.mockRestore();
  });

  it("falls back to in-memory on create when postgres persist fails", async () => {
    mockedIsPostgresConfigured.mockReturnValue(true);
    mockedQueryPostgres.mockRejectedValue(new Error("extension \"vector\" is not available"));
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    const base = await knowledgeStore.createKnowledgeBase({
      userId: "qa-smoke-user",
      name: "Smoke Test KB",
    });

    expect(base).toBeDefined();
    expect(base.name).toBe("Smoke Test KB");
    expect(errorSpy).toHaveBeenCalledWith(
      "[knowledge] Postgres persist failed, falling back to in-memory:",
      expect.stringContaining("vector")
    );

    errorSpy.mockRestore();
  });
});
