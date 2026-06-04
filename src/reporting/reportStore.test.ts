/**
 * HEL-496: cross-workspace isolation for generated_reports.
 *
 * Exercises the in-memory store branch (the path unit tests run on). The SQL
 * branch mirrors the same NULL-tolerant predicate
 * (`$n::uuid IS NULL OR workspace_id = $n::uuid OR workspace_id IS NULL`).
 */

import { reportStore } from "./reportStore";
import { GeneratedReport } from "./types";

type SaveInput = Omit<GeneratedReport, "id" | "createdAt" | "updatedAt"> & { id?: string };

function makeInput(overrides: Partial<SaveInput> = {}): SaveInput {
  return {
    userId: "user-1",
    kind: "board_memo",
    title: "Q3 board memo",
    summary: "summary",
    template: {},
    sections: [],
    metrics: [],
    delivery: [],
    source: {},
    ...overrides,
  };
}

describe("reportStore workspace scoping (HEL-496)", () => {
  beforeEach(async () => {
    await reportStore.clear();
  });

  it("listByUser only returns reports for the active workspace", async () => {
    const a = await reportStore.save(makeInput({ workspaceId: "ws-a", title: "A" }));
    const b = await reportStore.save(makeInput({ workspaceId: "ws-b", title: "B" }));

    const inA = await reportStore.listByUser("user-1", { workspaceId: "ws-a" });
    expect(inA.map((r) => r.id)).toEqual([a.id]);
    expect(inA.map((r) => r.id)).not.toContain(b.id);

    const inB = await reportStore.listByUser("user-1", { workspaceId: "ws-b" });
    expect(inB.map((r) => r.id)).toEqual([b.id]);
  });

  it("getById does not leak a report tagged with another workspace", async () => {
    const b = await reportStore.save(makeInput({ workspaceId: "ws-b" }));

    expect(await reportStore.getById(b.id, "user-1", "ws-a")).toBeUndefined();
    expect(await reportStore.getById(b.id, "user-1", "ws-b")).toMatchObject({ id: b.id });
  });

  it("is NULL-tolerant: untagged legacy reports stay visible under any workspace", async () => {
    const legacy = await reportStore.save(makeInput({ workspaceId: undefined, title: "legacy" }));

    const inA = await reportStore.listByUser("user-1", { workspaceId: "ws-a" });
    expect(inA.map((r) => r.id)).toContain(legacy.id);
    expect(await reportStore.getById(legacy.id, "user-1", "ws-a")).toMatchObject({ id: legacy.id });
  });

  it("returns all of the user's reports when no workspace filter is supplied", async () => {
    const a = await reportStore.save(makeInput({ workspaceId: "ws-a" }));
    const b = await reportStore.save(makeInput({ workspaceId: "ws-b" }));
    const legacy = await reportStore.save(makeInput({ workspaceId: undefined }));

    const all = await reportStore.listByUser("user-1");
    expect(all.map((r) => r.id).sort()).toEqual([a.id, b.id, legacy.id].sort());
  });

  it("persists workspaceId through save and round-trips it on read", async () => {
    const saved = await reportStore.save(makeInput({ workspaceId: "ws-a" }));
    expect(saved.workspaceId).toBe("ws-a");

    const fetched = await reportStore.getById(saved.id, "user-1", "ws-a");
    expect(fetched?.workspaceId).toBe("ws-a");
  });
});
