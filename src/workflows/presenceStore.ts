/**
 * In-memory presence store for collaborative awareness (HEL-241C).
 *
 * Tracks which users are currently active in each workflow. Stored
 * in process memory — works for single-pod deployments today. When
 * we scale to multiple pods, swap this for a Redis-backed adapter
 * behind the same interface (PresenceStore type).
 *
 * Why polling, not SSE/WebSocket:
 *   - The MVP only needs "who's here" avatars. 5s latency is fine.
 *   - SSE is hard to operate (connection limits, reconnection,
 *     back-pressure). Polling keeps the surface area small.
 *   - When the product needs <100ms cursor movement (real-time
 *     editing), upgrade to SSE *then*, not preemptively.
 *
 * TTL: entries older than PRESENCE_TTL_MS (30s) are reaped on each
 * read. A client that stops heart-beating drops out of the list
 * automatically — no need to handle explicit "leave" events.
 */

export const PRESENCE_TTL_MS = 30_000;

export interface PresenceState {
  userId: string;
  /** Display name (falls back to email local-part or "Teammate"). */
  name: string;
  /** Stable per-user color (CSS hex). Computed from userId hash. */
  color: string;
  /**
   * Optional selected step id. Surfaced as a step halo on peer
   * canvases. Null when the peer isn't focused on a step.
   */
  selectedStepId?: string | null;
  /** Epoch ms of the last heartbeat. Used for TTL reaping. */
  lastSeen: number;
}

export interface PresenceStore {
  upsert(workflowId: string, state: PresenceState): void;
  remove(workflowId: string, userId: string): void;
  /** Returns active peers (TTL-filtered), optionally excluding one user. */
  peers(workflowId: string, exceptUserId?: string): PresenceState[];
  /** Used by tests to step time without relying on real clocks. */
  setNow?(fn: () => number): void;
}

export function createPresenceStore(now: () => number = Date.now): PresenceStore {
  const byWorkflow = new Map<string, Map<string, PresenceState>>();
  let nowFn = now;

  return {
    upsert(workflowId, state) {
      let inner = byWorkflow.get(workflowId);
      if (!inner) {
        inner = new Map();
        byWorkflow.set(workflowId, inner);
      }
      inner.set(state.userId, state);
    },
    remove(workflowId, userId) {
      const inner = byWorkflow.get(workflowId);
      if (!inner) return;
      inner.delete(userId);
      if (inner.size === 0) byWorkflow.delete(workflowId);
    },
    peers(workflowId, exceptUserId) {
      const inner = byWorkflow.get(workflowId);
      if (!inner) return [];
      const cutoff = nowFn() - PRESENCE_TTL_MS;
      const out: PresenceState[] = [];
      for (const [userId, state] of inner) {
        if (state.lastSeen < cutoff) {
          inner.delete(userId);
          continue;
        }
        if (userId === exceptUserId) continue;
        out.push(state);
      }
      if (inner.size === 0) byWorkflow.delete(workflowId);
      return out;
    },
    setNow(fn) {
      nowFn = fn;
    },
  };
}

/**
 * Deterministic per-user color. Same userId always maps to the same
 * hue so a teammate's avatar stays the same color across sessions.
 *
 * Uses the af2 palette anchors — clay (orange), sage (green),
 * mustard (yellow), and a few additional hues chosen to be
 * distinguishable on the v2 paper background.
 */
export const PRESENCE_COLORS = [
  "#D97757", // clay
  "#7BA05B", // sage
  "#D6A93D", // mustard
  "#5B7DA0", // blue
  "#A0735B", // brown
  "#8B5BA0", // purple
  "#5BA08B", // teal
] as const;

export function colorForUser(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  }
  return PRESENCE_COLORS[Math.abs(hash) % PRESENCE_COLORS.length];
}
