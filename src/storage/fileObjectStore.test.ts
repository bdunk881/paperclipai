import { fileObjectStore } from "./fileObjectStore";

const WS_A = "11111111-1111-4111-8111-111111111111";
const WS_B = "22222222-2222-4222-8222-222222222222";
const USER_A = "user-a";
const USER_B = "user-b";

const baseInput = {
  uploadedBy: USER_A,
  collection: "run-input",
  storageKey: `workspaces/${WS_A}/run-input/01ARZ3NDEKTSV4RRFFQ69G5FAV-a.pdf`,
  provider: "memory",
  bucket: "memory",
  filename: "a.pdf",
  mimeType: "application/pdf",
  byteSize: 123,
};

describe("fileObjectStore (in-memory backend)", () => {
  beforeEach(() => fileObjectStore.__resetForTests());

  it("inserts and reads back a row within the same workspace", async () => {
    const row = await fileObjectStore.insert({ workspaceId: WS_A, userId: USER_A }, baseInput);
    expect(row.id).toBeTruthy();
    expect(row.workspaceId).toBe(WS_A);
    expect(row.retentionClass).toBe("standard");
    expect(row.deletedAt).toBeNull();

    const got = await fileObjectStore.getById({ workspaceId: WS_A, userId: USER_A }, row.id);
    expect(got?.id).toBe(row.id);
    expect(got?.storageKey).toBe(baseInput.storageKey);
  });

  it("isolates by workspace — another workspace's getById returns null", async () => {
    const row = await fileObjectStore.insert({ workspaceId: WS_A, userId: USER_A }, baseInput);
    const foreign = await fileObjectStore.getById({ workspaceId: WS_B, userId: USER_B }, row.id);
    expect(foreign).toBeNull();
  });

  it("soft-delete is workspace-scoped and idempotent", async () => {
    const row = await fileObjectStore.insert({ workspaceId: WS_A, userId: USER_A }, baseInput);

    // A foreign workspace cannot soft-delete A's row.
    expect(await fileObjectStore.softDelete({ workspaceId: WS_B, userId: USER_B }, row.id)).toBe(false);

    expect(await fileObjectStore.softDelete({ workspaceId: WS_A, userId: USER_A }, row.id)).toBe(true);
    const got = await fileObjectStore.getById({ workspaceId: WS_A, userId: USER_A }, row.id);
    expect(got?.deletedAt).not.toBeNull();

    // Second delete is a no-op.
    expect(await fileObjectStore.softDelete({ workspaceId: WS_A, userId: USER_A }, row.id)).toBe(false);
  });

  it("listByWorkspace returns only live rows for the workspace, optionally by collection", async () => {
    await fileObjectStore.insert({ workspaceId: WS_A, userId: USER_A }, { ...baseInput, collection: "run-input" });
    const exportRow = await fileObjectStore.insert(
      { workspaceId: WS_A, userId: USER_A },
      { ...baseInput, collection: "export", storageKey: `workspaces/${WS_A}/export/01ARZ-x.csv` },
    );
    await fileObjectStore.insert({ workspaceId: WS_B, userId: USER_B }, { ...baseInput, uploadedBy: USER_B });

    const all = await fileObjectStore.listByWorkspace({ workspaceId: WS_A, userId: USER_A });
    expect(all).toHaveLength(2);
    expect(all.every((r) => r.workspaceId === WS_A)).toBe(true);

    const onlyExport = await fileObjectStore.listByWorkspace({ workspaceId: WS_A, userId: USER_A }, "export");
    expect(onlyExport).toHaveLength(1);
    expect(onlyExport[0].id).toBe(exportRow.id);

    await fileObjectStore.softDelete({ workspaceId: WS_A, userId: USER_A }, exportRow.id);
    expect(await fileObjectStore.listByWorkspace({ workspaceId: WS_A, userId: USER_A })).toHaveLength(1);
  });
});
