import { chunkDocument } from "./chunking";

describe("chunkDocument", () => {
  it("tracks offsets monotonically even when repeated phrases exist", () => {
    const content = [
      "Alpha repeat section starts here and contains useful facts.",
      "",
      "Alpha repeat section starts here and contains different facts later.",
      "",
      "Tail section closes the document.",
    ].join("\n");

    const chunks = chunkDocument(content, {
      maxChunkSizeTokens: 12,
      minChunkSizeChars: 20,
      overlapTokens: 2,
    });

    expect(chunks.length).toBeGreaterThan(1);
    for (let i = 1; i < chunks.length; i += 1) {
      expect(chunks[i].startOffset).toBeGreaterThanOrEqual(chunks[i - 1].startOffset);
      expect(chunks[i].endOffset).toBeGreaterThan(chunks[i].startOffset);
    }
  });

  it("uses a token estimate that exceeds raw word count for longer words", () => {
    const chunks = chunkDocument(
      "supercalifragilisticexpialidocious repeated repeated repeated",
      {
        maxChunkSizeTokens: 100,
        minChunkSizeChars: 1,
        overlapTokens: 0,
      }
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0].tokenCount).toBeGreaterThan(4);
  });
});
