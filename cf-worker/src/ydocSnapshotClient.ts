/**
 * HEL-802 (Sub-phase B5) — WorkflowDocDO ⇄ Postgres snapshot client.
 *
 * Thin wrapper over B2's internal routes (callInternalApi mints the B1 JWT):
 *   - GET  /api/internal/workflows/:id/ydoc-snapshot  → cold-start hydrate
 *   - POST /api/internal/workflows/:id/ydoc-snapshot  → dirty-gated mirror
 *
 * Binary `Y.encodeStateAsUpdate` bytes travel base64 over JSON (matching the
 * API's `Buffer.from(state, "base64")`). Postgres is the system-of-record; the
 * DO keeps a DO-local warm copy for fast same-instance revival.
 */
import { callInternalApi } from "./internalApi";

export interface SnapshotTenancy {
  workflowId: string;
  workspaceId: string;
  userId: string;
}

type SnapshotEnv = Parameters<typeof callInternalApi>[0];

/** The internal-API caller, injectable so tests don't need a live API / network. */
export type CallInternalApi = typeof callInternalApi;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  // Chunked to avoid blowing the argument limit on very large docs.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function snapshotPath(t: SnapshotTenancy, query = false): string {
  const base = `workflows/${encodeURIComponent(t.workflowId)}/ydoc-snapshot`;
  if (!query) return base;
  const qs = new URLSearchParams({ workspaceId: t.workspaceId, userId: t.userId });
  return `${base}?${qs.toString()}`;
}

/**
 * Load the latest snapshot for cold-start hydration. Returns null when there is
 * no snapshot yet (404). Throws on other non-2xx so the caller can treat it as a
 * transient failure (best-effort hydrate).
 */
export async function loadYDocSnapshot(
  env: SnapshotEnv,
  t: SnapshotTenancy,
  call: CallInternalApi = callInternalApi,
): Promise<Uint8Array | null> {
  const res = await call(env, snapshotPath(t, true), { method: "GET" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`ydoc-snapshot GET failed: ${res.status}`);
  const body = (await res.json()) as { state?: unknown };
  if (typeof body.state !== "string") throw new Error("ydoc-snapshot GET: missing state");
  return base64ToBytes(body.state);
}

/** Mirror the doc state to Postgres (single-row UPSERT, version+1). */
export async function saveYDocSnapshot(
  env: SnapshotEnv,
  t: SnapshotTenancy,
  state: Uint8Array,
  call: CallInternalApi = callInternalApi,
): Promise<void> {
  const res = await call(env, snapshotPath(t), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      workspaceId: t.workspaceId,
      userId: t.userId,
      state: bytesToBase64(state),
    }),
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`ydoc-snapshot POST failed: ${res.status}`);
  }
}
