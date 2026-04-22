/**
 * Unit tests for the file-parsing pipeline.
 *
 * Tests cover the pure-local paths (PDF, plain-text, CSV, JSON) and the
 * stub-fallback behaviour for image/audio when no OpenAI key is provided.
 * Live OpenAI calls are NOT made in this suite.
 */

import { parseFile } from "./fileParser";

// ---------------------------------------------------------------------------
// Plain text / JSON / CSV — decoded as UTF-8
// ---------------------------------------------------------------------------

describe("parseFile — plain text", () => {
  it("returns utf-8 decoded content for text/plain", async () => {
    const buf = Buffer.from("Hello, world!", "utf-8");
    const result = await parseFile(buf, "text/plain", "hello.txt");
    expect(result.content).toBe("Hello, world!");
    expect(result.mimeType).toBe("text/plain");
    expect(result.filename).toBe("hello.txt");
  });

  it("returns JSON string for application/json", async () => {
    const obj = { key: "value" };
    const buf = Buffer.from(JSON.stringify(obj), "utf-8");
    const result = await parseFile(buf, "application/json", "data.json");
    expect(JSON.parse(result.content)).toEqual(obj);
  });

  it("returns CSV content as-is", async () => {
    const csv = "name,age\nAlice,30\nBob,25";
    const buf = Buffer.from(csv, "utf-8");
    const result = await parseFile(buf, "text/csv", "data.csv");
    expect(result.content).toBe(csv);
  });
});

// ---------------------------------------------------------------------------
// PDF — minimal text extraction
// ---------------------------------------------------------------------------

describe("parseFile — PDF", () => {
  it("extracts literal strings from BT/ET blocks", async () => {
    // Minimal PDF with a text block containing (Hello PDF)
    const pdfLike = "BT\n(Hello PDF) Tj\nET";
    const buf = Buffer.from(pdfLike, "latin1");
    const result = await parseFile(buf, "application/pdf", "doc.pdf");
    expect(result.content).toContain("Hello PDF");
  });

  it("falls back to a stub message when no BT/ET blocks found", async () => {
    const buf = Buffer.from("%PDF-1.4 binary stuff here", "latin1");
    const result = await parseFile(buf, "application/pdf", "empty.pdf");
    expect(result.content).toContain("no readable content");
  });

  it("detects PDF by filename extension when mimeType is generic", async () => {
    const pdfLike = "BT\n(From filename) Tj\nET";
    const buf = Buffer.from(pdfLike, "latin1");
    const result = await parseFile(buf, "application/octet-stream", "report.pdf");
    expect(result.content).toContain("From filename");
  });
});

// ---------------------------------------------------------------------------
// Image — stub fallback (no OpenAI key)
// ---------------------------------------------------------------------------

describe("parseFile — image (no OpenAI key)", () => {
  it("returns a stub message for image/png", async () => {
    const buf = Buffer.from("fake png bytes");
    const result = await parseFile(buf, "image/png", "photo.png");
    expect(result.content).toContain("OpenAI API key");
    expect(result.mimeType).toBe("image/png");
  });

  it("returns a stub message for image/jpeg", async () => {
    const buf = Buffer.from("fake jpeg bytes");
    const result = await parseFile(buf, "image/jpeg", "photo.jpg");
    expect(result.content).toContain("OpenAI API key");
  });
});

// ---------------------------------------------------------------------------
// Audio — stub fallback (no OpenAI key)
// ---------------------------------------------------------------------------

describe("parseFile — audio (no OpenAI key)", () => {
  it("returns a stub message for audio/mpeg", async () => {
    const buf = Buffer.from("fake mp3 bytes");
    const result = await parseFile(buf, "audio/mpeg", "track.mp3");
    expect(result.content).toContain("OpenAI API key");
    expect(result.mimeType).toBe("audio/mpeg");
  });

  it("detects audio by filename extension for .wav", async () => {
    const buf = Buffer.from("fake wav bytes");
    const result = await parseFile(buf, "application/octet-stream", "sound.wav");
    expect(result.content).toContain("OpenAI API key");
  });

  it("detects audio by filename extension for .mp4", async () => {
    const buf = Buffer.from("fake mp4 bytes");
    const result = await parseFile(buf, "application/octet-stream", "video.mp4");
    expect(result.content).toContain("OpenAI API key");
  });
});

// ---------------------------------------------------------------------------
// Return shape
// ---------------------------------------------------------------------------

describe("parseFile — return shape", () => {
  it("always returns content, mimeType, filename", async () => {
    const buf = Buffer.from("data");
    const result = await parseFile(buf, "text/plain", "file.txt");
    expect(typeof result.content).toBe("string");
    expect(typeof result.mimeType).toBe("string");
    expect(typeof result.filename).toBe("string");
  });
});
