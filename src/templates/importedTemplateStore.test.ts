jest.mock("../db/postgres", () => ({
  inMemoryAllowed: jest.fn(() => true),
  isPostgresConfigured: jest.fn(),
  queryPostgres: jest.fn(),
}));

import { makeWorkflowTemplate } from "../test-factories";
import {
  getImportedTemplate,
  getImportedTemplateAsync,
  listImportedTemplates,
  listImportedTemplatesAsync,
  resetImportedTemplatesForTests,
  saveImportedTemplate,
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
      [template.id]
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
});
