jest.mock("../db/postgres", () => ({
  inMemoryAllowed: jest.fn(() => true),
  isPostgresConfigured: jest.fn(),
  queryPostgres: jest.fn(),
}));

import { makeWorkflowTemplate } from "../test-factories";
import {
  deleteImportedTemplate,
  getImportedTemplate,
  getImportedTemplateAsync,
  listImportedTemplates,
  listImportedTemplatesAsync,
  resetImportedTemplatesForTests,
  saveImportedTemplate,
  warmImportedTemplates,
} from "./importedTemplateStore";
import { isPostgresConfigured, queryPostgres } from "../db/postgres";

const mockIsPostgresConfigured = jest.mocked(isPostgresConfigured);
const mockQueryPostgres = jest.mocked(queryPostgres);

describe("importedTemplateStore", () => {
  beforeEach(() => {
    resetImportedTemplatesForTests();
    mockIsPostgresConfigured.mockReset();
    mockQueryPostgres.mockReset();
    mockIsPostgresConfigured.mockReturnValue(false);
  });

  it("returns cached imported templates without querying Postgres", async () => {
    const template = makeWorkflowTemplate({
      id: "tpl-cached-import",
      name: "Cached Import",
      category: "custom",
    });

    await saveImportedTemplate(template);

    const listed = await listImportedTemplatesAsync();
    expect(listed).toEqual([template]);
    expect(mockQueryPostgres).not.toHaveBeenCalled();
  });

  it("hydrates a template from Postgres on cold lookup", async () => {
    const template = makeWorkflowTemplate({
      id: "tpl-persisted-import",
      name: "Persisted Import",
      category: "custom",
    });

    mockIsPostgresConfigured.mockReturnValue(true);
    mockQueryPostgres.mockResolvedValue({
      rows: [{ id: template.id, template_definition: template }],
      rowCount: 1,
      command: "SELECT",
      oid: 0,
      fields: [],
    });

    const loaded = await getImportedTemplateAsync(template.id);

    expect(loaded).toEqual(template);
    expect(getImportedTemplate(template.id)).toEqual(template);
    expect(mockQueryPostgres).toHaveBeenCalledWith(
      expect.stringContaining("FROM workflows w"),
      [null, template.id]
    );
  });

  it("persists imported templates with importer metadata when Postgres is enabled", async () => {
    const template = makeWorkflowTemplate({
      id: "tpl-persisted-write",
      name: "Persisted Write",
      category: "custom",
    });

    mockIsPostgresConfigured.mockReturnValue(true);
    mockQueryPostgres
      .mockResolvedValueOnce({
        rows: [{ id: "11111111-1111-4111-8111-111111111111" }],
        rowCount: 1,
        command: "INSERT",
        oid: 0,
        fields: [],
      })
      .mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: "SELECT",
        oid: 0,
        fields: [],
      })
      .mockResolvedValueOnce({
        rows: [{ next_version: 1 }],
        rowCount: 1,
        command: "SELECT",
        oid: 0,
        fields: [],
      })
      .mockResolvedValueOnce({
        rows: [{ id: "22222222-2222-4222-8222-222222222222" }],
        rowCount: 1,
        command: "INSERT",
        oid: 0,
        fields: [],
      })
      .mockResolvedValueOnce({
        rows: [],
        rowCount: 1,
        command: "UPDATE",
        oid: 0,
        fields: [],
      });

    await saveImportedTemplate(template, "user-123");

    expect(listImportedTemplates()).toEqual([template]);
    expect(mockQueryPostgres).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO workflows"),
      [template.id, template.name]
    );
    expect(mockQueryPostgres).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO workflow_versions"),
      [
        "11111111-1111-4111-8111-111111111111",
        1,
        JSON.stringify(template),
        "user-123",
      ]
    );
  });

  // HEL-485: a fresh process (empty Map) must rehydrate imported templates from
  // Postgres on boot, else runs started with an imported templateId 404.
  it("warmImportedTemplates loads persisted templates into the cache on a cold boot", async () => {
    const template = makeWorkflowTemplate({
      id: "tpl-warm-boot",
      name: "Warm Boot",
      category: "custom",
    });

    mockIsPostgresConfigured.mockReturnValue(true);
    mockQueryPostgres.mockResolvedValue({
      rows: [{ id: template.id, dag: template }],
      rowCount: 1,
      command: "SELECT",
      oid: 0,
      fields: [],
    });

    // Map starts empty (resetImportedTemplatesForTests in beforeEach), mirroring
    // a fresh process; the sync getter must find the template after warming.
    expect(getImportedTemplate(template.id)).toBeUndefined();

    const count = await warmImportedTemplates();

    expect(count).toBe(1);
    expect(getImportedTemplate(template.id)).toEqual(template);
    expect(mockQueryPostgres).toHaveBeenCalledWith(
      expect.stringContaining("FROM workflows w"),
      [null, null],
    );
  });

  it("warmImportedTemplates is a no-op (0) when Postgres is not configured", async () => {
    mockIsPostgresConfigured.mockReturnValue(false);

    const count = await warmImportedTemplates();

    expect(count).toBe(0);
    expect(mockQueryPostgres).not.toHaveBeenCalled();
  });

  // HEL-520: imported templates are workspace-scoped — a member of workspace B
  // must not see workspace A's imported templates; legacy/global (workspace_id
  // NULL) templates stay visible to everyone. Exercises the in-memory path.
  describe("workspace scoping (HEL-520)", () => {
    it("isolates imported templates by workspace, NULL-tolerant for globals", async () => {
      const tplA = makeWorkflowTemplate({ id: "tpl-ws-a", name: "A only", category: "custom" });
      const tplB = makeWorkflowTemplate({ id: "tpl-ws-b", name: "B only", category: "custom" });
      const tplGlobal = makeWorkflowTemplate({ id: "tpl-global", name: "Legacy global", category: "custom" });

      await saveImportedTemplate(tplA, undefined, "ws-a");
      await saveImportedTemplate(tplB, undefined, "ws-b");
      await saveImportedTemplate(tplGlobal, undefined, null);

      // A sees its own + the global, never B's.
      expect(getImportedTemplate(tplA.id, "ws-a")).toEqual(tplA);
      expect(getImportedTemplate(tplB.id, "ws-a")).toBeUndefined();
      expect(getImportedTemplate(tplGlobal.id, "ws-a")).toEqual(tplGlobal);

      expect(listImportedTemplates("ws-a").map((t) => t.id).sort()).toEqual(
        [tplA.id, tplGlobal.id].sort(),
      );
      expect(listImportedTemplates("ws-b").map((t) => t.id).sort()).toEqual(
        [tplB.id, tplGlobal.id].sort(),
      );

      // The async path doesn't leak across workspaces either.
      expect(await getImportedTemplateAsync(tplB.id, "ws-a")).toBeUndefined();
      expect(await getImportedTemplateAsync(tplA.id, "ws-a")).toEqual(tplA);
    });

    it("deleteImportedTemplate will not drop another workspace's template", async () => {
      const tplB = makeWorkflowTemplate({ id: "tpl-del-b", name: "B only", category: "custom" });
      await saveImportedTemplate(tplB, undefined, "ws-b");

      // ws-a can't see it, so a delete scoped to ws-a leaves it intact.
      const removed = await deleteImportedTemplate(tplB.id, "ws-a");
      expect(removed).toBe(false);
      expect(getImportedTemplate(tplB.id, "ws-b")).toEqual(tplB);
    });
  });
});
