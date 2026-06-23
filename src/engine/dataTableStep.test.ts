import { handleDataTable, resolveDataTableOperation } from "./dataTableStep";
import { dataTableStore } from "./dataTableStore";
import type { WorkflowStep } from "../types/workflow";

const WS = "11111111-1111-4111-8111-111111111111";
const WS2 = "22222222-2222-4222-8222-222222222222";

function step(config: Record<string, unknown>, outputKeys: string[] = []): WorkflowStep {
  return {
    id: "s1",
    name: "Data table",
    kind: "data_table",
    description: "test",
    inputKeys: [],
    outputKeys,
    config,
  };
}

beforeEach(async () => {
  await dataTableStore.__resetForTests();
});

describe("resolveDataTableOperation (HEL-813)", () => {
  it("defaults to query and rejects unknown values", () => {
    expect(resolveDataTableOperation(undefined)).toBe("query");
    expect(resolveDataTableOperation({})).toBe("query");
    expect(resolveDataTableOperation({ operation: "delete" })).toBe("query");
    expect(resolveDataTableOperation({ operation: "insert" })).toBe("insert");
    expect(resolveDataTableOperation({ operation: "upsert" })).toBe("upsert");
  });
});

describe("handleDataTable (HEL-813)", () => {
  it("insert then query round-trips the row", async () => {
    const ins = await handleDataTable(
      step({ operation: "insert", table: "leads", data: { email: "a@b.com" } }),
      {},
      WS,
    );
    expect((ins.row as { data: Record<string, unknown> }).data.email).toBe("a@b.com");
    expect(ins.operation).toBe("insert");

    const q = await handleDataTable(step({ operation: "query", table: "leads" }), {}, WS);
    expect(q.rowCount).toBe(1);
    expect((q.rows as Array<{ data: Record<string, unknown> }>)[0]!.data.email).toBe("a@b.com");
  });

  it("upsert replaces the row with the same rowKey", async () => {
    await handleDataTable(
      step({ operation: "upsert", table: "kv", rowKey: "k1", data: { v: "a" } }),
      {},
      WS,
    );
    await handleDataTable(
      step({ operation: "upsert", table: "kv", rowKey: "k1", data: { v: "b" } }),
      {},
      WS,
    );
    const q = await handleDataTable(step({ operation: "query", table: "kv" }), {}, WS);
    expect(q.rowCount).toBe(1);
    expect((q.rows as Array<{ data: Record<string, unknown> }>)[0]!.data.v).toBe("b");
  });

  it("query applies a containment filter", async () => {
    await handleDataTable(step({ operation: "insert", table: "t", data: { status: "open", id: 1 } }), {}, WS);
    await handleDataTable(step({ operation: "insert", table: "t", data: { status: "closed", id: 2 } }), {}, WS);
    const q = await handleDataTable(
      step({ operation: "query", table: "t", filter: { status: "open" } }),
      {},
      WS,
    );
    expect(q.rowCount).toBe(1);
    expect((q.rows as Array<{ data: Record<string, unknown> }>)[0]!.data.id).toBe(1);
  });

  it("defaults to query and returns [] for a missing table", async () => {
    const q = await handleDataTable(step({ table: "nope" }), {}, WS);
    expect(q.operation).toBe("query");
    expect(q.rowCount).toBe(0);
    expect(q.rows).toEqual([]);
  });

  it("interpolates table / data / filter from the run context", async () => {
    const ctx = {
      tableName: "leads",
      email: "x@y.com",
      lead: { name: "X", score: 9 },
      wanted: "open",
    };
    // lone {{lead}} resolves to the raw object; {{email}} embeds as a string
    await handleDataTable(
      step({ operation: "insert", table: "{{tableName}}", data: { contact: "{{email}}", status: "open" } }),
      ctx,
      WS,
    );
    const whole = await handleDataTable(
      step({ operation: "insert", table: "{{tableName}}", data: "{{lead}}" }),
      ctx,
      WS,
    );
    expect((whole.row as { data: Record<string, unknown> }).data).toEqual({ name: "X", score: 9 });

    const q = await handleDataTable(
      step({ operation: "query", table: "{{tableName}}", filter: { status: "{{wanted}}" } }),
      ctx,
      WS,
    );
    expect(q.rowCount).toBe(1);
    expect((q.rows as Array<{ data: Record<string, unknown> }>)[0]!.data.contact).toBe("x@y.com");
  });

  it("emits the primary payload under the step's first outputKey", async () => {
    const ins = await handleDataTable(
      step({ operation: "insert", table: "t", data: { a: 1 } }, ["created"]),
      {},
      WS,
    );
    expect(ins.created).toBe(ins.row);

    const q = await handleDataTable(step({ operation: "query", table: "t" }, ["found"]), {}, WS);
    expect(q.found).toBe(q.rows);
  });

  it("isolates rows by workspace", async () => {
    await handleDataTable(step({ operation: "insert", table: "shared", data: { x: 1 } }), {}, WS);
    await handleDataTable(step({ operation: "insert", table: "shared", data: { x: 2 } }), {}, WS2);
    const q1 = await handleDataTable(step({ operation: "query", table: "shared" }), {}, WS);
    expect(q1.rowCount).toBe(1);
    expect((q1.rows as Array<{ data: Record<string, unknown> }>)[0]!.data.x).toBe(1);
  });

  it("throws when workspaceId, table, or upsert rowKey is missing", async () => {
    await expect(handleDataTable(step({ table: "t" }), {}, "")).rejects.toThrow(/workspaceId/);
    await expect(handleDataTable(step({ table: "" }), {}, WS)).rejects.toThrow(/table/);
    await expect(
      handleDataTable(step({ operation: "upsert", table: "t", data: { a: 1 } }), {}, WS),
    ).rejects.toThrow(/rowKey/);
  });
});
