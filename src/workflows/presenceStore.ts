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

export interface PresenceCursor {
  /**
   * Cursor position in *canvas* coordinates (not viewport / screen).
   * Canvas-relative so peer cursors stay glued to the same DAG node
   * across pan + zoom. The client converts before sending.
   */
  x: number;
  y: number;
}

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
  /**
   * Live cursor position in canvas coordinates (HEL-241C v2). Null
   * when the peer's pointer hasn't moved yet this session or has
   * left the canvas.
   */
  cursor?: PresenceCursor | null;
  /** Epoch ms of the last heartbeat. Used for TTL reaping. */
  lastSeen: number;
}

export type PresenceListener = (peers: PresenceState[]) => void;

export interface PresenceStore {
  upsert(workflowId: string, state: PresenceState): void;
  remove(workflowId: string, userId: string): void;
  /** Returns active peers (TTL-filtered), optionally excluding one user. */
  peers(workflowId: string, exceptUserId?: string): PresenceState[];
  /**
   * Subscribe to live peer changes for a workflow (HEL-241C v2). The
   * listener fires with the full TTL-filtered peer snapshot on every
   * upsert/remove. Returns an unsubscribe fn. Used by the SSE route
   * to push cursor + selection changes to connected clients.
   */
  subscribe(workflowId: string, listener: PresenceListener): () => void;
  /** Used by tests to step time without relying on real clocks. */
  setNow?(fn: () => number): void;
}

export function createPresenceStore(now: () => number = Date.now): PresenceStore {
  const byWorkflow = new Map<string, Map<string, PresenceState>>();
  const listenersByWorkflow = new Map<string, Set<PresenceListener>>();
  let nowFn = now;

  function snapshot(workflowId: string): PresenceState[] {
    const inner = byWorkflow.get(workflowId);
    if (!inner) return [];
    const cutoff = nowFn() - PRESENCE_TTL_MS;
    const out: PresenceState[] = [];
    for (const [userId, state] of inner) {
      if (state.lastSeen < cutoff) {
        inner.delete(userId);
        continue;
      }
      out.push(state);
    }
    if (inner.size === 0) byWorkflow.delete(workflowId);
    return out;
  }

  function notify(workflowId: string): void {
    const set = listenersByWorkflow.get(workflowId);
    if (!set || set.size === 0) return;
    const peers = snapshot(workflowId);
    for (const listener of set) {
      try {
        listener(peers);
      } catch {
        // Swallow listener failures — presence is best-effort. One
        // dead subscriber should not break delivery to the rest.
      }
    }
  }

  return {
    upsert(workflowId, state) {
      let inner = byWorkflow.get(workflowId);
      if (!inner) {
        inner = new Map();
        byWorkflow.set(workflowId, inner);
      }
      inner.set(state.userId, state);
      notify(workflowId);
    },
    remove(workflowId, userId) {
      const inner = byWorkflow.get(workflowId);
      if (!inner) return;
      const had = inner.delete(userId);
      if (inner.size === 0) byWorkflow.delete(workflowId);
      if (had) notify(workflowId);
    },
    peers(workflowId, exceptUserId) {
      return snapshot(workflowId).filter((p) => p.userId !== exceptUserId);
    },
    subscribe(workflowId, listener) {
      let set = listenersByWorkflow.get(workflowId);
      if (!set) {
        set = new Set();
        listenersByWorkflow.set(workflowId, set);
      }
      set.add(listener);
      return () => {
        const current = listenersByWorkflow.get(workflowId);
        if (!current) return;
        current.delete(listener);
        if (current.size === 0) listenersByWorkflow.delete(workflowId);
      };
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
