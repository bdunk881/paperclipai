/**
 * File-drop start (HEL-680, Phase 1).
 *
 * Gives a `file_trigger` workflow an ingress: upload a file → start a run with
 * the file content in `context.file`, which the `file_trigger` head surfaces.
 * This module is the pure validator; the route (`workflowRoutes.ts`,
 * `POST /api/workflows/:workflowId/file`) does the load + `startRun`.
 *
 * v1 accepts text content (capped) inline. Binary / large files via object
 * storage (`src/storage`) are a follow-up — as is a public (unauthenticated)
 * drop endpoint; this v1 is workspace-authenticated.
 */

/** Inline text-content cap (256 KB). Larger / binary files → storage follow-up. */
export const FILE_DROP_MAX_BYTES = 256 * 1024;

export interface FileDropFile {
  fileName: string;
  mimeType: string;
  content: string;
}

export type FileDropParse = { ok: true; file: FileDropFile } | { ok: false; error: string };

/**
 * Validate + normalise a file-drop body. Requires a non-empty `fileName` and a
 * string `content` within `maxBytes`; `mimeType` defaults to `text/plain`.
 */
export function parseFileDrop(body: unknown, maxBytes: number = FILE_DROP_MAX_BYTES): FileDropParse {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Request body must be a JSON object." };
  }
  const b = body as Record<string, unknown>;

  const fileName = typeof b["fileName"] === "string" ? b["fileName"].trim() : "";
  if (!fileName) {
    return { ok: false, error: "fileName is required." };
  }

  if (typeof b["content"] !== "string") {
    return { ok: false, error: "content (string) is required." };
  }
  const content = b["content"];
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > maxBytes) {
    return { ok: false, error: `content exceeds the ${maxBytes}-byte limit (got ${bytes}).` };
  }

  const mimeType =
    typeof b["mimeType"] === "string" && b["mimeType"].trim() ? b["mimeType"].trim() : "text/plain";

  return { ok: true, file: { fileName, mimeType, content } };
}
