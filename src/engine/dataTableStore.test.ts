import { dataTableStore } from "./dataTableStore";

const WS = "11111111-1111-4111-8111-111111111111";
const WS2 = "22222222-2222-4222-8222-222222222222";

beforeEach(async () => {
  await dataTableStore.__resetForTests();
});

describe("dataTableStore (HEL-812)", () => {
  it("createOrGetTable is idempotent (same id for same workspace+name)", async () => {
    const a = await dataTableStore.createOrGetTable(WS, "users");
    const b = await dataTableStore.createOrGetTable(WS, "users");
    expect(a.id).toBe(b.id);
    expect(a.name).toBe("users");
  });

  it("insertRow appends rows; queryRows returns them in insert order", async () => {
    await dataTableStore.insertRow(WS, "t", { n: 1 });
    await dataTableStore.insertRow(WS, "t", { n: 2 });
    const rows = await dataTableStore.queryRows(WS, "t");
    expect(rows.map((r) => r.data.n)).toEqual([1, 2]);
  });

  it("upsertRow replaces the row with the same rowKey", async () => {
    await dataTableStore.upsertRow(WS, "kv", "k1", { v: "a" });
    await dataTableStore.upsertRow(WS, "kv", "k1", { v: "b" });
    const rows = await dataTableStore.queryRows(WS, "kv");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.data.v).toBe("b");
    expect(rows[0]!.rowKey).toBe("k1");
  });

  it("queryRows applies a containment filter + limit", async () => {
    await dataTableStore.insertRow(WS, "t", { status: "open", id: 1 });
    await dataTableStore.insertRow(WS, "t", { status: "closed", id: 2 });
    await dataTableStore.insertRow(WS, "t", { status: "open", id: 3 });
    const open = await dataTableStore.queryRows(WS, "t", { filter: { status: "open" } });
    expect(open.map((r) => r.data.id)).toEqual([1, 3]);
    const limited = await dataTableStore.queryRows(WS, "t", { limit: 2 });
    expect(limited).toHaveLength(2);
  });

  it("isolates tables + rows per workspace", async () => {
    await dataTableStore.insertRow(WS, "shared", { x: 1 });
    await dataTableStore.insertRow(WS2, "shared", { x: 2 });
    expect((await dataTableStore.queryRows(WS, "shared")).map((r) => r.data.x)).toEqual([1]);
    expect((await dataTableStore.queryRows(WS2, "shared")).map((r) => r.data.x)).toEqual([2]);
    expect(await dataTableStore.listTables(WS)).toEqual([{ id: expect.any(String), name: "shared" }]);
  });

  it("queryRows on a missing table returns []", async () => {
    expect(await dataTableStore.queryRows(WS, "nope")).toEqual([]);
  });
});
