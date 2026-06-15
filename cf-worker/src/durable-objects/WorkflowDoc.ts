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
 *  - **Persistence (B3 = DO-local).** The full doc state is mirrored to
 *    `ctx.storage` after each applied update so it survives hibernation/eviction.
 *    The durable Postgres mirror (so state survives DO *deletion* + feeds other
 *    readers) is B5 (HEL-802) via the internal ydoc-snapshot API from B2.
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
 * Edge auth + tenancy pinning is B4 (HEL-801); until then the Worker route is
 * dev-only (see cf-worker/src/index.ts).
 */
import { DurableObject } from "cloudflare:workers";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";

/** y-websocket message types (wire-compatible with y-websocket/bin/utils). */
const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

/** DO-local storage key holding `Y.encodeStateAsUpdate(doc)` for wake/eviction recovery. */
const STORAGE_KEY = "ydoc:state";
/** Transaction origin used while hydrating from storage, so the relay observer ignores the echo. */
const STORAGE_ORIGIN = "storage";

/**
 * Keepalive cadence. Must stay safely under the y-websocket client's
 * `messageReconnectTimeout` (30_000ms); the client checks every 3s, so 20s
 * leaves ~10s of margin against alarm-scheduling jitter.
 */
const KEEPALIVE_INTERVAL_MS = 20_000;

export interface WorkflowDocEnv {
  ENVIRONMENT?: string;
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

  constructor(ctx: DurableObjectState, env: WorkflowDocEnv) {
    super(ctx, env);
    this.doc = new Y.Doc({ gc: true });
    // Attach the relay observer up-front; the STORAGE_ORIGIN guard inside it
    // ignores the single update produced while hydrating below.
    this.doc.on("update", this.handleDocUpdate);

    // Rebuild the doc from DO-local storage before any socket event is handled.
    // blockConcurrencyWhile defers webSocketMessage / alarm delivery until this
    // resolves, giving us the cold-start "hydrate before accept" ordering.
    this.ctx.blockConcurrencyWhile(async () => {
      const stored = toUint8(await this.ctx.storage.get(STORAGE_KEY));
      if (stored && stored.length > 0) {
        Y.applyUpdate(this.doc, stored, STORAGE_ORIGIN);
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
      const att = ws.deserializeAttachment() as DocTenancy | null;
      if (att && att.workspaceId && att.userId) {
        return { workspaceId: att.workspaceId, userId: att.userId };
      }
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

  /** Keepalive tick — see KEEPALIVE_INTERVAL_MS. */
  async alarm(): Promise<void> {
    const sockets = this.ctx.getWebSockets();
    if (sockets.length === 0) {
      // Nothing connected; let the DO go fully idle (no reschedule).
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
      await this.persist(); // final flush
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
