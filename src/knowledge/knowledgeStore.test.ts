jest.mock("../db/postgres", () => ({
  inMemoryAllowed: jest.fn(() => true),
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

  it("falls back to in-memory results when postgres reads fail", async () => {
    mockedIsPostgresConfigured.mockReturnValue(true);
    mockedQueryPostgres.mockRejectedValueOnce(new Error("connect ECONNREFUSED"));
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    await expect(knowledgeStore.listKnowledgeBases("qa-smoke-user")).resolves.toEqual([]);

    expect(mockedQueryPostgres).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      "[knowledge] Postgres read failed, falling back to in-memory:",
      "connect ECONNREFUSED"
    );

    errorSpy.mockRestore();
  });

  it("surfaces persist failures on create instead of silently keeping data in-memory only (B15/HEL-493)", async () => {
    mockedIsPostgresConfigured.mockReturnValue(true);
    mockedQueryPostgres.mockRejectedValue(new Error("extension \"vector\" is not available"));
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    // Previously this swallowed the error and returned an in-memory-only base
    // (lost on the next deploy / invisible cross-instance). It must now throw
    // so the caller sees that the write did not persist.
    await expect(
      knowledgeStore.createKnowledgeBase({
        userId: "qa-smoke-user",
        name: "Smoke Test KB",
      })
    ).rejects.toThrow(/vector/);

    expect(errorSpy).toHaveBeenCalledWith(
      "[knowledge] Postgres persist failed:",
      expect.stringContaining("vector")
    );

    errorSpy.mockRestore();
  });
});

describe("knowledge base visibility — user vs workspace (HEL-309)", () => {
  it("keeps a user-scoped base private to its creator (default scope)", async () => {
    const base = await knowledgeStore.createKnowledgeBase({ userId: "owner", name: "Private KB" });
    expect(base.scope).toBe("user");
    expect(base.workspaceId).toBeUndefined();

    // Creator sees it.
    const own = await knowledgeStore.listKnowledgeBases("owner");
    expect(own.map((b) => b.id)).toContain(base.id);

    // A different user — even when operating inside a workspace — does not.
    const intruderList = await knowledgeStore.listKnowledgeBases("intruder", "ws-1");
    expect(intruderList.map((b) => b.id)).not.toContain(base.id);
    expect(await knowledgeStore.getKnowledgeBase(base.id, "intruder", "ws-1")).toBeUndefined();
  });

  it("requires a workspaceId for a workspace-scoped base", async () => {
    await expect(
      knowledgeStore.createKnowledgeBase({ userId: "owner", name: "WS KB", scope: "workspace" })
    ).rejects.toThrow(/workspaceId/);
  });

  it("makes a workspace base + its documents and chunks visible to other members, not outsiders", async () => {
    const base = await knowledgeStore.createKnowledgeBase({
      userId: "owner",
      name: "Team KB",
      scope: "workspace",
      workspaceId: "ws-1",
    });
    expect(base.scope).toBe("workspace");
    expect(base.workspaceId).toBe("ws-1");

    const { document } = await knowledgeStore.ingestDocument({
      userId: "owner",
      knowledgeBaseId: base.id,
      filename: "policy.md",
      mimeType: "text/markdown",
      content: "Customers can receive a refund within thirty days of purchase.",
      sourceType: "inline",
      workspaceId: "ws-1",
    });

    // A different member of the same workspace sees the base, its docs, chunks, and search hits.
    const member = "teammate";
    expect((await knowledgeStore.listKnowledgeBases(member, "ws-1")).map((b) => b.id)).toContain(base.id);
    expect(await knowledgeStore.getKnowledgeBase(base.id, member, "ws-1")).toBeDefined();
    expect((await knowledgeStore.listDocuments(base.id, member, "ws-1")).map((d) => d.id)).toContain(
      document.id
    );
    expect((await knowledgeStore.listChunks(document.id, member, "ws-1")).length).toBeGreaterThan(0);
    const memberSearch = await knowledgeStore.search({
      userId: member,
      query: "refund within thirty days",
      workspaceId: "ws-1",
    });
    expect(memberSearch.length).toBeGreaterThan(0);

    // A user in a different workspace sees nothing.
    const outsider = "outsider";
    expect((await knowledgeStore.listKnowledgeBases(outsider, "ws-2")).map((b) => b.id)).not.toContain(
      base.id
    );
    expect(await knowledgeStore.getKnowledgeBase(base.id, outsider, "ws-2")).toBeUndefined();
    expect(await knowledgeStore.listDocuments(base.id, outsider, "ws-2")).toHaveLength(0);
    expect(await knowledgeStore.listChunks(document.id, outsider, "ws-2")).toHaveLength(0);
    const outsiderSearch = await knowledgeStore.search({
      userId: outsider,
      query: "refund within thirty days",
      workspaceId: "ws-2",
    });
    expect(outsiderSearch).toHaveLength(0);
  });
});
