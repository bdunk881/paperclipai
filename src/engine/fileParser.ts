/**
 * File parsing pipeline for multi-modal file trigger steps.
 *
 * Supports:
 *   PDF  — basic text extraction from PDF byte streams
 *   Image — OpenAI vision API description (falls back to stub when no key)
 *   Audio — OpenAI Whisper transcription (falls back to stub when no key)
 *
 * All parsers return { content, mimeType, filename }.
 */

import OpenAI from "openai";

export interface ParsedFile {
  content: string;
  mimeType: string;
  filename: string;
}

// ---------------------------------------------------------------------------
// PDF — extract readable text from raw buffer
// ---------------------------------------------------------------------------

/**
 * Minimal PDF text extractor: locates BT...ET blocks (PDF text objects) and
 * pulls out string literals enclosed in parentheses or angle-brackets.
 * Suitable for simple, non-encrypted PDFs. For production, add pdf-parse.
 */
function parsePdf(buffer: Buffer): string {
  const raw = buffer.toString("latin1");
  const chunks: string[] = [];

  // Match content between BT (begin text) and ET (end text) markers
  const btEt = /BT([\s\S]*?)ET/g;
  let match: RegExpExecArray | null;
  while ((match = btEt.exec(raw)) !== null) {
    const block = match[1];
    // Literal strings: (text) — unescape \\, \n, \r, \t, \(, \)
    const litRe = /\(([^)\\]*(?:\\.[^)\\]*)*)\)/g;
    let lit: RegExpExecArray | null;
    while ((lit = litRe.exec(block)) !== null) {
      const decoded = lit[1]
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\r")
        .replace(/\\t/g, "\t")
        .replace(/\\\\/g, "\\")
        .replace(/\\\(/g, "(")
        .replace(/\\\)/g, ")")
        // strip non-printable chars
        .replace(/[^\x20-\x7E\n\r\t]/g, "");
      if (decoded.trim()) chunks.push(decoded);
    }
  }

  const text = chunks.join(" ").replace(/\s{2,}/g, " ").trim();
  return text || "[PDF text extraction produced no readable content — consider adding pdf-parse for full support]";
}

// ---------------------------------------------------------------------------
// Image — OpenAI vision description
// ---------------------------------------------------------------------------

async function parseImage(
  buffer: Buffer,
  mimeType: string,
  openaiApiKey?: string,
  inferenceGeo?: "us" | "eu"
): Promise<string> {
  if (!openaiApiKey) {
    return "[Image received — configure an OpenAI API key to enable vision-based content extraction]";
  }

  const client = new OpenAI({ apiKey: openaiApiKey });
  const base64 = buffer.toString("base64");
  const dataUrl = `data:${mimeType};base64,${base64}`;

  const request: Record<string, unknown> = {
    model: "gpt-4o",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url: dataUrl, detail: "high" },
          },
          {
            type: "text",
            text: "Describe the full contents of this image in detail, including any visible text, tables, charts, or data.",
          },
        ],
      },
    ],
    max_tokens: 1024,
  };
  if (inferenceGeo) {
    request.inference_geo = inferenceGeo;
  }

  const response = await client.chat.completions.create(request as never);

  return response.choices[0]?.message?.content ?? "[No description returned]";
}

// ---------------------------------------------------------------------------
// Audio — OpenAI Whisper transcription
// ---------------------------------------------------------------------------

async function parseAudio(
  buffer: Buffer,
  mimeType: string,
  filename: string,
  openaiApiKey?: string
): Promise<string> {
  if (!openaiApiKey) {
    return "[Audio received — configure an OpenAI API key to enable Whisper transcription]";
  }

  const client = new OpenAI({ apiKey: openaiApiKey });

  // Whisper requires a File-like object. In Node 18+ we can use the File constructor.
  const ext = filename.split(".").pop() ?? "mp3";
  const file = new File([buffer], filename, { type: mimeType || `audio/${ext}` });

  const transcription = await client.audio.transcriptions.create({
    file,
    model: "whisper-1",
  });

  return transcription.text || "[No transcription returned]";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ParseOptions {
  /** OpenAI API key — enables vision (image) and Whisper (audio) parsing */
  openaiApiKey?: string;
  /** Optional OpenAI inference routing preference for supported calls. */
  inferenceGeo?: "us" | "eu";
}

/**
 * Parse an uploaded file into text/content.
 * Returns a ParsedFile with extracted content, original mimeType, and filename.
 */
export async function parseFile(
  buffer: Buffer,
  mimeType: string,
  filename: string,
  opts: ParseOptions = {}
): Promise<ParsedFile> {
  let content: string;

  if (mimeType === "application/pdf" || filename.toLowerCase().endsWith(".pdf")) {
    content = parsePdf(buffer);
  } else if (mimeType.startsWith("image/")) {
    content = await parseImage(buffer, mimeType, opts.openaiApiKey, opts.inferenceGeo);
  } else if (
    mimeType.startsWith("audio/") ||
    /\.(mp3|mp4|mpeg|mpga|m4a|wav|webm|ogg)$/i.test(filename)
  ) {
    content = await parseAudio(buffer, mimeType, filename, opts.openaiApiKey);
  } else {
    // Plain text / CSV / JSON — decode as UTF-8
    content = buffer.toString("utf-8");
  }

  return { content, mimeType, filename };
}
