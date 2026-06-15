/**
 * WorkflowDocDO (HEL-800 B3) integration tests against a real miniflare-backed
 * Workers runtime. We drive the DO with a minimal y-protocols "client" (a real
 * Y.Doc + sync framing) over an actual WebSocket from SELF.fetch, proving the
 * hand-rolled wire matches what an unmodified y-websocket client expects:
 * connect → sync handshake → multi-client relay → close, plus the keepalive
 * alarm and the DO-local persistence that lets state survive hibernation.
 */
import { SELF, env, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import type { WorkflowDocDO } from "../durable-objects/WorkflowDoc";

// The cf-worker doesn't commit a generated Cloudflare.Env type; teach
// cloudflare:test's `env` about the binding this suite drives directly.
declare global {
  namespace Cloudflare {
    interface Env {
      WORKFLOW_DOC: DurableObjectNamespace<WorkflowDocDO>;
    }
  }
}

const MESSAGE_SYNC = 0;
const REMOTE = "remote"; // local-doc-update origin guard (don't echo server-applied updates back)
const STORAGE_KEY = "ydoc:state";

interface TestClient {
  doc: Y.Doc;
  ws: WebSocket;
  /** Count of frames received from the server (used to detect keepalive ticks). */
  received: number;
}

function frameSyncStep1(doc: Y.Doc): Uint8Array {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(enc, doc);
  return encoding.toUint8Array(enc);
}

interface DocCtx {
  ws: string;
  uid: string;
  role: string;
}
const DEFAULT_CTX: DocCtx = {
  ws: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  uid: "user-1",
  role: "owner",
};

/**
 * Open a real WebSocket to the DO and wire up a minimal y-websocket-style client.
 * Connects to the DO stub DIRECTLY with the tenancy query params the edge gate
 * (HEL-801) would set — the public Worker route now requires a verified token,
 * which is covered separately; these tests exercise the DO transport.
 */
async function connectClient(workflowId: string, ctx: DocCtx = DEFAULT_CTX): Promise<TestClient> {
  const doUrl = `https://do/?wf=${workflowId}&ws=${ctx.ws}&uid=${ctx.uid}&role=${ctx.role}`;
  const res = await stubFor(workflowId).fetch(
    new Request(doUrl, { headers: { Upgrade: "websocket" } }),
  );
  expect(res.status).toBe(101);
  const ws = res.webSocket;
  if (!ws) throw new Error("upgrade response had no webSocket");

  const doc = new Y.Doc();
  const client: TestClient = { doc, ws, received: 0 };

  // Match what the real y-websocket client does — without this, binary frames
  // arrive as Blobs and decode to empty arrays.
  ws.binaryType = "arraybuffer";
  ws.accept();
  ws.addEventListener("message", (event: MessageEvent) => {
    client.received += 1;
    const data = new Uint8Array(event.data as ArrayBuffer);
    try {
      const decoder = decoding.createDecoder(data);
      if (decoding.readVarUint(decoder) !== MESSAGE_SYNC) return;
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MESSAGE_SYNC);
      syncProtocol.readSyncMessage(decoder, enc, doc, REMOTE);
      if (encoding.length(enc) > 1) ws.send(encoding.toUint8Array(enc));
    } catch (e) {
      console.log(JSON.stringify({ dbg: "clientErr", err: String(e), hex: Array.from(data).join(",") }));
    }
  });

  // Forward local edits to the server as y-sync update messages.
  doc.on("update", (update: Uint8Array, origin: unknown) => {
    if (origin === REMOTE) return;
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    syncProtocol.writeUpdate(enc, update);
    ws.send(encoding.toUint8Array(enc));
  });

  // Kick off the handshake (client → server state vector).
  ws.send(frameSyncStep1(doc));
  return client;
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 2000,
): Promise<void> {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** DO-storage values come back as Uint8Array or ArrayBuffer depending on backend. */
function asUint8(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return null;
}

function stubFor(workflowId: string) {
  return env.WORKFLOW_DOC.get(env.WORKFLOW_DOC.idFromName(`workflow::${workflowId}`));
}

describe("WorkflowDocDO (HEL-800 B3)", () => {
  it("rejects a non-WebSocket request with 426", async () => {
    const res = await SELF.fetch(
      "https://example.com/workflows/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/ydoc",
    );
    expect(res.status).toBe(426);
  });

  it("404s an unknown path shape", async () => {
    const res = await SELF.fetch("https://example.com/workflows/not-a-uuid/ydoc", {
      headers: { Upgrade: "websocket" },
    });
    expect(res.status).toBe(404);
  });

  it("syncs an edit between two connected clients (bidirectional relay)", async () => {
    const wf = "11111111-1111-4111-8111-111111111111";
    const a = await connectClient(wf);
    const b = await connectClient(wf);

    a.doc.getMap("steps").set("s1", "from-a");
    await waitFor(() => b.doc.getMap("steps").get("s1") === "from-a");

    b.doc.getMap("steps").set("s2", "from-b");
    await waitFor(() => a.doc.getMap("steps").get("s2") === "from-b");

    a.ws.close();
    b.ws.close();
  });

  it("hydrates a late-joining client with the existing graph", async () => {
    const wf = "22222222-2222-4222-8222-222222222222";
    const a = await connectClient(wf);
    a.doc.getMap("steps").set("only", "early");

    // New client connecting afterwards must converge to the existing state,
    // whether via the server's step2 reply or a relayed update.
    const late = await connectClient(wf);
    await waitFor(() => late.doc.getMap("steps").get("only") === "early");

    a.ws.close();
    late.ws.close();
  });

  it("persists doc state to DO-local storage (survives hibernation/eviction)", async () => {
    const wf = "33333333-3333-4333-8333-333333333333";
    const a = await connectClient(wf);
    a.doc.getMap("steps").set("persist-me", "yes");

    const stub = stubFor(wf);
    // Poll the DO's storage until the mirror is written.
    let stored: Uint8Array | null = null;
    await waitFor(async () => {
      stored = await runInDurableObject(stub, async (_instance: WorkflowDocDO, state) => {
        return asUint8(await state.storage.get(STORAGE_KEY));
      });
      return stored !== null && stored.length > 0;
    }, 3000);

    // The persisted bytes rehydrate into a doc carrying the edit.
    const rebuilt = new Y.Doc();
    Y.applyUpdate(rebuilt, stored as unknown as Uint8Array);
    expect(rebuilt.getMap("steps").get("persist-me")).toBe("yes");

    a.ws.close();
  });

  it("pins tenancy via serializeAttachment and recovers it after a wake (HEL-801)", async () => {
    const wf = "66666666-6666-4666-8666-666666666666";
    const ctx = { ws: "77777777-7777-4777-8777-777777777777", uid: "user-xyz", role: "developer" };
    const a = await connectClient(wf, ctx);

    // Recover {workspaceId,userId} the way a post-hibernation snapshot write
    // would (B5) — from the socket's pinned attachment via a fresh DO entry.
    const recovered = await runInDurableObject(stubFor(wf), (instance: WorkflowDocDO) =>
      instance.currentTenancy(),
    );
    expect(recovered).toEqual({ workspaceId: ctx.ws, userId: ctx.uid });
    a.ws.close();
  });

  it("sends a keepalive sync frame on the alarm tick", async () => {
    const wf = "44444444-4444-4444-8444-444444444444";
    const a = await connectClient(wf);
    // Drain the initial handshake frames.
    await waitFor(() => a.received > 0);
    const before = a.received;

    const ran = await runDurableObjectAlarm(stubFor(wf));
    expect(ran).toBe(true);

    await waitFor(() => a.received > before);
    a.ws.close();
  });

  it("clears the keepalive alarm once the last client disconnects", async () => {
    const wf = "55555555-5555-4555-8555-555555555555";
    const a = await connectClient(wf);
    a.ws.close();

    await waitFor(async () => {
      let hasAlarm = true;
      await runInDurableObject(stubFor(wf), async (_i: WorkflowDocDO, state) => {
        hasAlarm = (await state.storage.getAlarm()) !== null;
      });
      return !hasAlarm;
    }, 3000);
  });
});

describe("ydoc edge auth (HEL-801) — Worker route gate", () => {
  const WF = "88888888-8888-4888-8888-888888888888";
  const WS = "99999999-9999-4999-8999-999999999999";

  it("426s a non-WebSocket request before auth", async () => {
    const res = await SELF.fetch(`https://example.com/workflows/${WF}/ydoc?access_token=x&workspaceId=${WS}`);
    expect(res.status).toBe(426);
  });

  it("401s when access_token is missing", async () => {
    const res = await SELF.fetch(`https://example.com/workflows/${WF}/ydoc?workspaceId=${WS}`, {
      headers: { Upgrade: "websocket" },
    });
    expect(res.status).toBe(401);
  });

  it("400s when workspaceId is missing or malformed", async () => {
    const missing = await SELF.fetch(`https://example.com/workflows/${WF}/ydoc?access_token=x`, {
      headers: { Upgrade: "websocket" },
    });
    expect(missing.status).toBe(400);
    const bad = await SELF.fetch(
      `https://example.com/workflows/${WF}/ydoc?access_token=x&workspaceId=not-a-uuid`,
      { headers: { Upgrade: "websocket" } },
    );
    expect(bad.status).toBe(400);
  });

  it("401s a garbage token at the edge (no DO billed, no 101)", async () => {
    const res = await SELF.fetch(
      `https://example.com/workflows/${WF}/ydoc?access_token=not-a-jwt&workspaceId=${WS}`,
      { headers: { Upgrade: "websocket" } },
    );
    expect(res.status).toBe(401);
    expect(res.webSocket).toBeFalsy();
  });
});
