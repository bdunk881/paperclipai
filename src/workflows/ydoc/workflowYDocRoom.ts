/**
 * HEL-286 — per-workflow Y.Doc room.
 *
 * Holds the shared doc in-process, brokers sync between connected WS
 * clients via y-websocket's setupWSConnection, and mirrors state to the
 * snapshot store on a 30s tick + on last-disconnect.
 *
 * One room per workflowId. The doc is created lazily on first attach;
 * the snapshot (if any) is applied BEFORE handing the doc to y-websocket
 * so clients never see an empty doc that will get clobbered seconds
 * later by a load.
 */

import type { IncomingMessage } from "node:http";
import type { WebSocket } from "ws";
import * as Y from "yjs";
import {
  docs as yWebsocketDocs,
  getYDoc,
  setupWSConnection,
  type WSSharedDoc,
} from "y-websocket/bin/utils";
import type { YDocSnapshotStore } from "./ydocSnapshotStore";

export const SNAPSHOT_INTERVAL_MS = 30_000;

export interface WorkflowYDocRoomDeps {
  snapshotStore: YDocSnapshotStore;
  intervalMs?: number;
  /** Injectable for tests; defaults to setInterval/clearInterval. */
  timers?: {
    setInterval: (fn: () => void, ms: number) => NodeJS.Timeout;
    clearInterval: (handle: NodeJS.Timeout) => void;
  };
}

export class WorkflowYDocRoom {
  readonly workflowId: string;
  readonly workspaceId: string;

  private readonly snapshotStore: YDocSnapshotStore;
  private readonly intervalMs: number;
  private readonly setInterval: (fn: () => void, ms: number) => NodeJS.Timeout;
  private readonly clearInterval: (handle: NodeJS.Timeout) => void;

  private doc: WSSharedDoc | null = null;
  private hydrated = false;
  private hydrationPromise: Promise<void> | null = null;
  private snapshotTimer: NodeJS.Timeout | null = null;
  /**
   * The userId we attribute snapshot writes to for RLS audit. Updated
   * whenever a new client attaches; falls back to whichever client most
   * recently held the room. Auth has already enforced workspace
   * membership before the upgrade completes, so any of these is valid
   * for `app.current_user_id`.
   */
  private lastActiveUserId: string | null = null;

  constructor(workflowId: string, workspaceId: string, deps: WorkflowYDocRoomDeps) {
    this.workflowId = workflowId;
    this.workspaceId = workspaceId;
    this.snapshotStore = deps.snapshotStore;
    this.intervalMs = deps.intervalMs ?? SNAPSHOT_INTERVAL_MS;
    this.setInterval = deps.timers?.setInterval ?? globalThis.setInterval.bind(globalThis);
    this.clearInterval = deps.timers?.clearInterval ?? globalThis.clearInterval.bind(globalThis);
  }

  /**
   * Lazy-create the shared doc and hydrate from the snapshot store. Safe
   * to call concurrently — the first caller wins; later callers await the
   * same promise. Public so tests can exercise persistence lifecycle
   * without faking the WS surface.
   */
  async hydrate(userId: string): Promise<WSSharedDoc> {
    this.lastActiveUserId = userId;
    if (this.doc && this.hydrated) return this.doc;

    if (!this.hydrationPromise) {
      this.hydrationPromise = (async () => {
        // y-websocket's getYDoc identifies the doc by name globally
        // across the process. Namespacing by workflowId keeps separate
        // workflows isolated even though y-websocket's `docs` map is
        // process-shared.
        const doc = getYDoc(this.workflowId, /* gc */ true);
        this.doc = doc;

        const snapshot = await this.snapshotStore.load(
          this.workflowId,
          this.workspaceId,
          userId,
        );
        if (snapshot) {
          Y.applyUpdate(doc, snapshot.state);
        }
        this.hydrated = true;
      })();
    }
    await this.hydrationPromise;
    return this.doc!;
  }

  /**
   * Wire a freshly-upgraded WebSocket into this room. The doc is
   * guaranteed hydrated before y-websocket sees the connection, so the
   * first sync message can't race the snapshot load.
   */
  async attachClient(ws: WebSocket, req: IncomingMessage, userId: string): Promise<void> {
    const doc = await this.hydrate(userId);

    setupWSConnection(ws, req, { docName: this.workflowId, gc: true });

    if (!this.snapshotTimer) {
      this.snapshotTimer = this.setInterval(() => {
        void this.flush();
      }, this.intervalMs);
    }

    ws.on("close", () => {
      // y-websocket already removed `ws` from doc.conns at this point.
      // If we're now empty, persist + tear down so the next attach
      // starts fresh from disk.
      if (doc.conns.size === 0) {
        void this.flushAndStop();
      }
    });
  }

  /** Snapshot current state without affecting connectivity. */
  async flush(): Promise<void> {
    if (!this.doc || !this.hydrated || !this.lastActiveUserId) return;
    const state = Y.encodeStateAsUpdate(this.doc);
    await this.snapshotStore.save(
      this.workflowId,
      this.workspaceId,
      this.lastActiveUserId,
      state,
    );
  }

  /**
   * Last-disconnect handler. Persists final state, stops the snapshot
   * tick, and detaches the in-memory doc so a fresh getYDoc on the next
   * attach starts from disk.
   */
  async flushAndStop(): Promise<void> {
    await this.flush();
    if (this.snapshotTimer) {
      this.clearInterval(this.snapshotTimer);
      this.snapshotTimer = null;
    }
    if (this.doc) {
      // y-websocket caches docs in a process-global map keyed by name. If
      // we don't evict it before destroy(), the next attach gets a dead
      // doc back from getYDoc(). y-websocket's built-in persistence path
      // does this in closeConn; since we're driving persistence ourselves
      // we own the eviction too.
      yWebsocketDocs.delete(this.workflowId);
      this.doc.destroy();
      this.doc = null;
    }
    this.hydrated = false;
    this.hydrationPromise = null;
  }

  /** Connection count — used by the upgrade handler for room GC. */
  get connectionCount(): number {
    return this.doc?.conns.size ?? 0;
  }
}
