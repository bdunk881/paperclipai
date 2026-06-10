/**
 * HEL-680: file-drop start validator — unit tests.
 */

import { parseFileDrop, FILE_DROP_MAX_BYTES } from "./fileDrop";

describe("parseFileDrop (HEL-680)", () => {
  it("accepts a valid file body and defaults the mimeType", () => {
    expect(parseFileDrop({ fileName: "notes.txt", content: "hello" })).toEqual({
      ok: true,
      file: { fileName: "notes.txt", mimeType: "text/plain", content: "hello" },
    });
  });

  it("keeps an explicit mimeType", () => {
    const r = parseFileDrop({ fileName: "a.csv", mimeType: "text/csv", content: "a,b" });
    expect(r.ok && r.file.mimeType).toBe("text/csv");
  });

  it("rejects a non-object body", () => {
    expect(parseFileDrop("nope").ok).toBe(false);
    expect(parseFileDrop(null).ok).toBe(false);
    expect(parseFileDrop([]).ok).toBe(false);
  });

  it("requires a fileName", () => {
    const r = parseFileDrop({ content: "x" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/fileName/);
  });

  it("requires string content", () => {
    expect(parseFileDrop({ fileName: "a", content: 5 }).ok).toBe(false);
    expect(parseFileDrop({ fileName: "a" }).ok).toBe(false);
  });

  it("rejects content over the size cap", () => {
    const big = "x".repeat(FILE_DROP_MAX_BYTES + 1);
    const r = parseFileDrop({ fileName: "big.txt", content: big });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/exceeds/);
  });
});
