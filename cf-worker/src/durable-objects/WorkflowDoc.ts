/**
 * WorkflowDocDO (HEL-800 / Sub-phase B3) — the collaborative Y.Doc host for one
 * workflow's builder graph. One instance per `workflow::<id>`.
 *
 * This is the WebSocket-Hibernation replacement for the in-process y-websocket
 * room (`src/workflows/ydoc/workflowYDocRoom.ts`). It speaks the SAME wire so an
 * unmodified `y-websocket@3` `WebsocketProvider` keeps syncing after the
 * host-swap: y-protocols sync step1/step2/update framed under `lib0` varints,
 * with message type `0 = sync`, `1 = awareness` (see docs/infra/durable-objects.md
 * "Yjs wire contract"). Pinned to yjs@13.6.31 / y-protocols@1.0.7 / lib0@0.2.117.
 *
 * Design notes:
 *  - **Hibernation.** Sockets are accepted via `ctx.acceptWebSocket`, so the DO
 *    can be evicted from memory while connections stay open. On every wake the
 *    constructor rebuilds the in-memory Y.Doc from DO-local storage BEFORE any
 *    socket event is delivered (`blockConcurrencyWhile`), so an inbound update
 *    can never race an empty doc (the "no clobber on cold start" guarantee).
 *  - **Persistence (two tiers).** B3: the full doc state is mirrored to
 *    `ctx.storage` (DO-local) after each applied update for fast same-instance
 *    revival. B5 (HEL-802): the durable system-of-record is Postgres, written via
 *    B2's internal ydoc-snapshot API — debounced by piggybacking the keepalive
 *    alarm (a storage `pg:dirty` flag survives hibernation) and flushed on last
 *    disconnect; cold start hydrates DO-local first, else GETs the PG snapshot
 *    before accepting sockets (host-swap continuity with the in-process room,
 *    which writes the same `workflow_ydoc_snapshots` row). PG writes are
 *    best-effort — a failure never throws into the WS path; the dirty flag just
 *    survives for the next tick.
 *  - **Awareness (presence) is best-effort.** We keep NO server-side `Awareness`
 *    instance — its refresh `setInterval` would keep the DO from hibernating, and
 *    presence is authoritatively carried on SSE. Awareness frames are simply
 *    relayed verbatim to peers and never persisted (they do not survive
 *    hibernation, by design).
 *  - **Keepalive.** A stock y-websocket client closes + reconnects if it receives
 *    NO message for `messageReconnectTimeout` (30s) — protocol pings don't count.
 *    A self-rescheduling alarm sends a sync step1 every KEEPALIVE_INTERVAL_MS
 *    (< 30s) while clients are connected, so idle sessions don't churn through
 *    1006 reconnects; the alarm is cleared on last disconnect so an empty DO
 *    still fully evicts. (`setWebSocketAutoResponse('ping','pong')` does NOT help
 *    — y-websocket sends no such application message.)
 *
 * Edge auth + tenancy pinning is B4 (HEL-801) — the Worker verifies the user and
 * forwards `{wf,ws,uid,role}` on the URL, which the DO serializeAttachments.
 */
import { DurableObject } from "cloudflare:workers";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import {
  loadYDocSnapshot,
  saveYDocSnapshot,
  type SnapshotTenancy,
} from "../ydocSnapshotClient";

/** y-websocket message types (wire-compatible with y-websocket/bin/utils). */
const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

/** DO-local storage key holding `Y.encodeStateAsUpdate(doc)` for wake/eviction recovery. */
const STORAGE_KEY = "ydoc:state";
/** DO-local flag: doc has un-mirrored edits the next alarm tick should flush to Postgres. */
const PG_DIRTY_KEY = "pg:dirty";
/** Transaction origin used while hydrating from storage/PG, so the relay observer ignores the echo. */
const STORAGE_ORIGIN = "storage";

/**
 * Keepalive cadence. Must stay safely under the y-websocket client's
 * `messageReconnectTimeout` (30_000ms); the client checks every 3s, so 20s
 * leaves ~10s of margin against alarm-scheduling jitter.
 */
const KEEPALIVE_INTERVAL_MS = 20_000;

export interface WorkflowDocEnv {
  ENVIRONMENT?: string;
  // For the Postgres snapshot mirror (B5) via B2's internal API + B1's minter.
  API_BASE_URL?: string;
  CF_WORKER_SHARED_SECRET?: string;
  CF_WORKER_INTERNAL_JWT_AUDIENCE?: string;
}

/**
 * Per-socket tenancy, established by the edge gate (HEL-801) and pinned with
 * `serializeAttachment` so it survives hibernation. After a wake the DO recovers
 * `{workspaceId, userId}` from any socket to attribute the RLS-scoped snapshot
 * write (the Postgres mirror lands in B5). Tiny (~150 bytes) — far under the
 * 16,384-byte attachment cap.
 */
interface DocTenancy {
  workflowId: string;
  workspaceId: string;
  userId: string;
  role: string;
}

export class WorkflowDocDO extends DurableObject<WorkflowDocEnv> {
  private readonly doc: Y.Doc;
  private loaded = false;
  private persisting = false;
  private dirty = false;
  /** True once the constructor restored DO-local state (skip the PG cold-start GET). */
  private hasLocalState = false;
  /** One-shot guard for the PG cold-start hydrate (runs on the first connect). */
  private pgHydratePromise: Promise<void> | null = null;
  /** In-activation memo so a burst of edits marks pg:dirty in storage only once. */
  private pgDirtyMemo = false;

  constructor(ctx: DurableObjectState, env: WorkflowDocEnv) {
    super(ctx, env);
    this.doc = new Y.Doc({ gc: true });
    // Attach the relay observer up-front; the STORAGE_ORIGIN guard inside it
    // ignores updates produced while hydrating (DO-local or PG).
    this.doc.on("update", this.handleDocUpdate);

    // Rebuild the doc from DO-local storage before any socket event is handled.
    // blockConcurrencyWhile defers webSocketMessage / alarm delivery until this
    // resolves, giving us the cold-start "hydrate before accept" ordering. The PG
    // fallback can't run here (no tenancy yet) — it runs on the first connect.
    this.ctx.blockConcurrencyWhile(async () => {
      const stored = toUint8(await this.ctx.storage.get(STORAGE_KEY));
      if (stored && stored.length > 0) {
        Y.applyUpdate(this.doc, stored, STORAGE_ORIGIN);
        this.hasLocalState = true;
      }
      this.loaded = true;
    });
  }

  /** WebSocket upgrade entry. The Worker forwards `GET .../ydoc` here. */
  async fetch(request: Request): Promise<Response> {
    if ((request.headers.get("Upgrade") ?? "").toLowerCase() !== "websocket") {
      return new Response("Expected a WebSocket upgrade", { status: 426 });
    }

    // Tenancy is supplied by the edge gate (HEL-801) on the forwarded URL — the
    // client never reaches the DO directly, and the edge stripped the raw token.
    const url = new URL(request.url);
    const tenancy: DocTenancy = {
      workflowId: url.searchParams.get("wf") ?? "",
      workspaceId: url.searchParams.get("ws") ?? "",
      userId: url.searchParams.get("uid") ?? "",
      role: url.searchParams.get("role") ?? "",
    };

    // Cold-start PG hydrate (B5): if DO-local was empty, pull the latest snapshot
    // BEFORE accepting this socket — so the first step1 reflects persisted state
    // and a late update can't clobber it (mirrors the in-process hydrate-then-attach).
    await this.ensurePgHydrated(tenancy);

    const { 0: client, 1: server } = new WebSocketPair();
    // Hibernation-managed: the runtime owns the socket and wakes us on message.
    this.ctx.acceptWebSocket(server);
    // Pin tenancy so it survives hibernation (recovered via deserializeAttachment).
    server.serializeAttachment(tenancy);
    // Kick off the sync handshake (server → client state vector).
    this.send(server, this.encodeSyncStep1());
    await this.ensureKeepaliveScheduled();

    this.log("connect", {
      connections: this.ctx.getWebSockets().length,
      workspaceId: tenancy.workspaceId,
    });
    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Recover `{workspaceId, userId}` for an RLS-scoped snapshot write from any
   * connected socket's pinned attachment — survives hibernation, so a post-wake
   * persist (B5) can still attribute the write. Returns null if no socket carries
   * usable tenancy.
   */
  currentTenancy(): { workspaceId: string; userId: string } | null {
    for (const ws of this.ctx.getWebSockets()) {
      const t = readDocTenancy(ws);
      if (t) return { workspaceId: t.workspaceId, userId: t.userId };
    }
    return null;
  }

  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
    // The wire is binary; ignore any stray text frame.
    if (typeof message === "string") return;
    const data = new Uint8Array(message);
    if (data.length === 0) return;

    const decoder = decoding.createDecoder(data);
    const messageType = decoding.readVarUint(decoder);

    switch (messageType) {
      case MESSAGE_SYNC: {
        // readSyncMessage may write a reply (step2 in response to a step1) AND,
        // when it applies an update, fire doc 'update' → handleDocUpdate relays
        // the delta to the OTHER sockets (origin = this ws is skipped).
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        try {
          syncProtocol.readSyncMessage(decoder, encoder, this.doc, ws);
        } catch (err) {
          // A corrupt frame from one client must not tear down the shared doc.
          // Drop it; the client resyncs from step1 on its next message.
          this.log("sync_error", { error: err instanceof Error ? err.message : String(err) });
          break;
        }
        if (encoding.length(encoder) > 1) {
          this.send(ws, encoding.toUint8Array(encoder));
        }
        break;
      }
      case MESSAGE_AWARENESS: {
        // Best-effort presence: forward the framed awareness message verbatim to
        // peers. No server-side Awareness state (see file header).
        for (const peer of this.ctx.getWebSockets()) {
          if (peer === ws) continue;
          this.send(peer, data);
        }
        break;
      }
      default:
        // Unknown type — ignore for forward-compatibility.
        break;
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.handleDisconnect(ws, "close");
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    try {
      ws.close(1011, "WorkflowDocDO socket error");
    } catch {
      // already closing
    }
    await this.handleDisconnect(ws, "error");
  }

  /**
   * Keepalive tick (KEEPALIVE_INTERVAL_MS) that doubles as the dirty-gated
   * Postgres-flush debounce (B5): one alarm per DO, so the PG mirror piggybacks
   * the keepalive cadence rather than scheduling a second (conflicting) alarm.
   */
  async alarm(): Promise<void> {
    // Flush first so a final-edit-then-idle still mirrors before going quiet.
    await this.flushToPg(this.tenancyForFlush());

    const sockets = this.ctx.getWebSockets();
    if (sockets.length === 0) {
      // Nothing connected; let the DO go fully idle (no reschedule, no alarm).
      return;
    }
    const ping = this.encodeSyncStep1();
    for (const ws of sockets) {
      this.send(ws, ping);
    }
    await this.ctx.storage.setAlarm(Date.now() + KEEPALIVE_INTERVAL_MS);
  }

  // --- internals -----------------------------------------------------------

  /**
   * Relay a locally-applied update to every other socket and persist. Fires for
   * client updates (origin = the sending ws) and is a no-op for the hydrate echo
   * (origin = STORAGE_ORIGIN).
   */
  private handleDocUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin === STORAGE_ORIGIN) return;

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    const message = encoding.toUint8Array(encoder);

    for (const ws of this.ctx.getWebSockets()) {
      if (ws === origin) continue;
      this.send(ws, message);
    }

    void this.persist();
    void this.markPgDirty();
  };

  private encodeSyncStep1(): Uint8Array {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.doc);
    return encoding.toUint8Array(encoder);
  }

  private async handleDisconnect(ws: WebSocket, reason: "close" | "error"): Promise<void> {
    // The closing socket may or may not still be in getWebSockets(); filter it out.
    const remaining = this.ctx.getWebSockets().filter((s) => s !== ws);
    this.log("disconnect", { reason, connections: remaining.length });
    if (remaining.length === 0) {
      await this.persist(); // final DO-local flush
      // Final PG mirror. The closing socket still carries the tenancy needed to
      // attribute the write (getWebSockets() is now empty).
      await this.flushToPg(readDocTenancy(ws) ?? this.tenancyForFlush());
      await this.ctx.storage.deleteAlarm();
    }
  }

  private async ensureKeepaliveScheduled(): Promise<void> {
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + KEEPALIVE_INTERVAL_MS);
    }
  }

  /**
   * Mirror the full doc state to DO-local storage, coalescing bursts: a write
   * requested while one is in flight just re-marks dirty and loops, so rapid
   * edits collapse to sequential writes rather than piling up.
   */
  private async persist(): Promise<void> {
    if (!this.loaded) return;
    this.dirty = true;
    if (this.persisting) return;
    this.persisting = true;
    try {
      while (this.dirty) {
        this.dirty = false;
        await this.ctx.storage.put(STORAGE_KEY, Y.encodeStateAsUpdate(this.doc));
      }
    } finally {
      this.persisting = false;
    }
  }

  /**
   * Cold-start hydrate from the Postgres snapshot, once, on the first connect
   * (the constructor can't — it has no tenancy). Skipped when DO-local state was
   * already restored. Best-effort: a failed GET leaves an empty doc (acceptable
   * fallback) and is retried on the next fresh DO.
   */
  private async ensurePgHydrated(t: DocTenancy): Promise<void> {
    if (this.hasLocalState || !isCompleteTenancy(t)) return;
    if (!this.pgHydratePromise) {
      this.pgHydratePromise = (async () => {
        try {
          const snapshot = await loadYDocSnapshot(this.env, toSnapshotTenancy(t));
          if (snapshot && snapshot.length > 0) {
            Y.applyUpdate(this.doc, snapshot, STORAGE_ORIGIN);
            await this.persist(); // seed DO-local so future revivals take the fast path
            this.hasLocalState = true;
            this.log("pg_hydrate", { workspaceId: t.workspaceId });
          }
        } catch (err) {
          this.log("pg_hydrate_error", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      })();
    }
    await this.pgHydratePromise;
  }

  /** Mark the doc as having un-mirrored edits (survives hibernation via storage). */
  private async markPgDirty(): Promise<void> {
    if (this.pgDirtyMemo) return; // already flagged since the last flush this activation
    this.pgDirtyMemo = true;
    try {
      await this.ctx.storage.put(PG_DIRTY_KEY, true);
    } catch {
      this.pgDirtyMemo = false; // let a later edit retry the mark
    }
  }

  /**
   * Mirror the doc to Postgres if dirty (system-of-record). Best-effort: never
   * throws into the WS path; on failure the dirty flag is left set for the next
   * alarm tick. Idempotent — re-flushing the same state is a harmless re-UPSERT.
   */
  private async flushToPg(tenancy: SnapshotTenancy | null): Promise<void> {
    if (!tenancy) return;
    if ((await this.ctx.storage.get(PG_DIRTY_KEY)) !== true) return;
    try {
      await saveYDocSnapshot(this.env, tenancy, Y.encodeStateAsUpdate(this.doc));
      await this.ctx.storage.put(PG_DIRTY_KEY, false);
      this.pgDirtyMemo = false;
    } catch (err) {
      this.log("pg_flush_error", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Full snapshot tenancy from any connected socket's pinned attachment. */
  private tenancyForFlush(): SnapshotTenancy | null {
    for (const ws of this.ctx.getWebSockets()) {
      const t = readDocTenancy(ws);
      if (t) return toSnapshotTenancy(t);
    }
    return null;
  }

  private send(ws: WebSocket, message: Uint8Array): void {
    try {
      ws.send(message);
    } catch {
      // Socket is closing/closed; the close handler will reconcile state.
    }
  }

  private log(event: string, extra: Record<string, unknown> = {}): void {
    console.log(
      JSON.stringify({
        evt: `workflow_doc_${event}`,
        doClass: "WorkflowDocDO",
        environment: this.env.ENVIRONMENT,
        ...extra,
      }),
    );
  }
}

/** Normalize a DO-storage value (Uint8Array or ArrayBuffer) to a Uint8Array. */
function toUint8(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return null;
}

function isCompleteTenancy(t: {
  workflowId: string;
  workspaceId: string;
  userId: string;
}): boolean {
  return Boolean(t.workflowId && t.workspaceId && t.userId);
}

function toSnapshotTenancy(t: DocTenancy): SnapshotTenancy {
  return { workflowId: t.workflowId, workspaceId: t.workspaceId, userId: t.userId };
}

/** Read + validate a socket's pinned tenancy; null if absent/incomplete. */
function readDocTenancy(ws: WebSocket): DocTenancy | null {
  const att = ws.deserializeAttachment() as DocTenancy | null;
  return att && isCompleteTenancy(att) ? att : null;
}
