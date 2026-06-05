import { Readable } from "stream";
import { MemoryStorageAdapter, NoSuchKeyError } from "./memoryAdapter";

const WID = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

async function streamToString(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

describe("MemoryStorageAdapter", () => {
  it("round-trips put -> get -> delete", async () => {
    const adapter = new MemoryStorageAdapter();
    const put = await adapter.putObject({
      workspaceId: WID,
      collection: "run-input",
      filename: "hello world.txt",
      body: "hi there",
      contentType: "text/plain",
    });
    expect(put.provider).toBe("memory");
    expect(put.storageKey).toMatch(new RegExp(`^standard/workspaces/${WID}/run-input/[0-9A-HJKMNP-TV-Z]{26}-hello_world\\.txt$`));
    expect(adapter.count).toBe(1);

    const got = await adapter.getObject(put.ref);
    expect(got.contentType).toBe("text/plain");
    expect(await streamToString(got.body)).toBe("hi there");

    await adapter.deleteObject(put.ref);
    expect(adapter.count).toBe(0);
  });

  it("getObject throws NoSuchKeyError for a missing object", async () => {
    const adapter = new MemoryStorageAdapter();
    await expect(
      adapter.getObject({ workspaceId: WID, collection: "run-input", objectId: "01ARZ3NDEKTSV4RRFFQ69G5FAV-x" }),
    ).rejects.toBeInstanceOf(NoSuchKeyError);
  });

  it("issues memory:// sentinel signed URLs", async () => {
    const adapter = new MemoryStorageAdapter("mem-bucket");
    const upload = await adapter.getSignedUploadUrl({ workspaceId: WID, collection: "export", filename: "x.csv", contentType: "text/csv" });
    expect(upload.method).toBe("PUT");
    expect(upload.url).toMatch(new RegExp(`^memory://mem-bucket/standard/workspaces/${WID}/export/`));
    expect(upload.headers["Content-Type"]).toBe("text/csv");

    const download = await adapter.getSignedDownloadUrl({ workspaceId: WID, collection: "export", objectId: upload.ref.objectId });
    expect(download).toContain("op=get");
  });

  it("lists only the requested workspace/collection (prefix isolation)", async () => {
    const adapter = new MemoryStorageAdapter();
    await adapter.putObject({ workspaceId: WID, collection: "run-input", filename: "a.txt", body: "a" });
    await adapter.putObject({ workspaceId: WID, collection: "export", filename: "b.txt", body: "b" });
    await adapter.putObject({ workspaceId: OTHER, collection: "run-input", filename: "c.txt", body: "c" });

    const allForWid = await adapter.listObjects({ workspaceId: WID });
    expect(allForWid.objects).toHaveLength(2);
    expect(allForWid.objects.every((o) => o.ref.workspaceId === WID)).toBe(true);

    const onlyRunInput = await adapter.listObjects({ workspaceId: WID, collection: "run-input" });
    expect(onlyRunInput.objects).toHaveLength(1);
    expect(onlyRunInput.objects[0].ref.collection).toBe("run-input");

    const otherWorkspace = await adapter.listObjects({ workspaceId: OTHER });
    expect(otherWorkspace.objects).toHaveLength(1);
  });

  it("places objects under the retention-class prefix and lists by class (HEL-358)", async () => {
    const adapter = new MemoryStorageAdapter();
    const shortPut = await adapter.putObject({
      workspaceId: WID,
      collection: "export",
      filename: "s.csv",
      body: "s",
      retentionClass: "short",
    });
    await adapter.putObject({ workspaceId: WID, collection: "export", filename: "n.csv", body: "n" }); // default standard
    expect(shortPut.storageKey).toMatch(new RegExp(`^short/workspaces/${WID}/export/`));
    expect(shortPut.ref.retentionClass).toBe("short");

    const onlyShort = await adapter.listObjects({ workspaceId: WID, retentionClass: "short" });
    expect(onlyShort.objects).toHaveLength(1);
    expect(onlyShort.objects[0].ref.retentionClass).toBe("short");

    // No class given → fans out over all retention prefixes.
    const all = await adapter.listObjects({ workspaceId: WID });
    expect(all.objects).toHaveLength(2);
  });
});
