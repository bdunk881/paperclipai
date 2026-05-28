/**
 * HEL-286 — unit tests for the Y.Doc room's persistence lifecycle.
 *
 * The room's WS attach surface goes through y-websocket's setupWSConnection
 * which expects a real ws.WebSocket. These tests drive the room via the
 * public `hydrate` seam instead — that's the same code path attachClient
 * uses internally, just without the WS wiring. Together with the explicit
 * CRDT-convergence check, these prove the parts that aren't exercised by
 * an integration test against real WebSockets.
 */

import * as Y from "yjs";
import { getYDoc } from "y-websocket/bin/utils";
import { WorkflowYDocRoom } from "./workflowYDocRoom";
import type { YDocSnapshotStore, YDocSnapshot } from "./ydocSnapshotStore";

const SAMPLE_WORKSPACE_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const SAMPLE_USER_ID = "user-1";

function uniqueWorkflowId(suffix: string): string {
  // y-websocket's `docs` map is process-global. Tests share that map, so
  // each test needs a unique workflowId or the doc state leaks between
  // cases.
  const hex = Buffer.from(suffix).toString("hex").padEnd(12, "0").slice(0, 12);
  return `11111111-2222-3333-4444-${hex}`;
}

function createMockStore(initial: YDocSnapshot | null = null): {
  store: YDocSnapshotStore;
  loadCount: () => number;
  saves: Array<{
    workflowId: string;
    workspaceId: string;
    userId: string;
    state: Uint8Array;
  }>;
} {
  let nextSnapshot: YDocSnapshot | null = initial;
  const saves: Array<{
    workflowId: string;
    workspaceId: string;
    userId: string;
    state: Uint8Array;
  }> = [];
  let loads = 0;
  const store: YDocSnapshotStore = {
    async load() {
      loads += 1;
      return nextSnapshot;
    },
    async save(workflowId, workspaceId, userId, state) {
      saves.push({ workflowId, workspaceId, userId, state });
      nextSnapshot = { state, version: (nextSnapshot?.version ?? 0) + 1 };
    },
  };
  return { store, loadCount: () => loads, saves };
}

describe("WorkflowYDocRoom", () => {
  it("CRDT convergence: two docs editing the same Y.Text merge cleanly", () => {
    // Prove the underlying Yjs guarantees the WS bridge depends on. The
    // room is a transport wrapper — if Y.applyUpdate composes both sides
    // correctly here, it composes them correctly over the wire too.
    const docA = new Y.Doc();
    const docB = new Y.Doc();

    docA.getText("text").insert(0, "hello ");
    docB.getText("text").insert(0, "world");

    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    const merged = docA.getText("text").toString();
    expect(merged.length).toBe("hello world".length);
    expect(merged).toBe(docB.getText("text").toString());
  });

  it("hydrates the in-memory doc from a stored snapshot before exposing it", async () => {
    const workflowId = uniqueWorkflowId("hydrate");
    const seed = new Y.Doc();
    seed.getText("text").insert(0, "stored");
    const seedState = Y.encodeStateAsUpdate(seed);

    const { store, loadCount } = createMockStore({ state: seedState, version: 7 });
    const room = new WorkflowYDocRoom(workflowId, SAMPLE_WORKSPACE_ID, {
      snapshotStore: store,
      intervalMs: 1_000_000,
    });

    await room.hydrate(SAMPLE_USER_ID);
    expect(loadCount()).toBe(1);

    const live = getYDoc(workflowId);
    expect(live.getText("text").toString()).toBe("stored");

    await room.flushAndStop();
  });

  it("flush() persists the in-memory Y.Doc state to the snapshot store", async () => {
    const workflowId = uniqueWorkflowId("flush");
    const { store, saves } = createMockStore(null);
    const room = new WorkflowYDocRoom(workflowId, SAMPLE_WORKSPACE_ID, {
      snapshotStore: store,
      intervalMs: 1_000_000,
    });

    // No hydration yet → flush is a no-op so we don't churn the store.
    await room.flush();
    expect(saves).toHaveLength(0);

    const doc = await room.hydrate(SAMPLE_USER_ID);
    doc.getText("text").insert(0, "persisted");

    await room.flush();
    expect(saves).toHaveLength(1);
    expect(saves[0].workflowId).toBe(workflowId);
    expect(saves[0].workspaceId).toBe(SAMPLE_WORKSPACE_ID);
    expect(saves[0].userId).toBe(SAMPLE_USER_ID);

    const restored = new Y.Doc();
    Y.applyUpdate(restored, saves[0].state);
    expect(restored.getText("text").toString()).toBe("persisted");

    await room.flushAndStop();
  });

  it("flushAndStop() saves the final state and detaches the doc", async () => {
    const workflowId = uniqueWorkflowId("stop");
    const { store, saves } = createMockStore(null);
    const room = new WorkflowYDocRoom(workflowId, SAMPLE_WORKSPACE_ID, {
      snapshotStore: store,
      intervalMs: 1_000_000,
    });

    const doc = await room.hydrate(SAMPLE_USER_ID);
    doc.getText("text").insert(0, "final");

    await room.flushAndStop();
    expect(saves).toHaveLength(1);
    expect(saves[0].state.byteLength).toBeGreaterThan(0);
    expect(room.connectionCount).toBe(0);
  });

  it("restart survival: snapshot → load → continue editing", async () => {
    // The acceptance criterion "State survives API restart" reduces to
    // saving then loading. Two rooms with the same store, sequential.
    const workflowId = uniqueWorkflowId("restart");
    const { store } = createMockStore(null);

    const roomA = new WorkflowYDocRoom(workflowId, SAMPLE_WORKSPACE_ID, {
      snapshotStore: store,
      intervalMs: 1_000_000,
    });
    const docA = await roomA.hydrate(SAMPLE_USER_ID);
    docA.getText("text").insert(0, "alpha ");
    await roomA.flushAndStop();

    const roomB = new WorkflowYDocRoom(workflowId, SAMPLE_WORKSPACE_ID, {
      snapshotStore: store,
      intervalMs: 1_000_000,
    });
    const docB = await roomB.hydrate(SAMPLE_USER_ID);
    expect(docB.getText("text").toString()).toBe("alpha ");

    docB.getText("text").insert(docB.getText("text").length, "beta");
    await roomB.flushAndStop();

    const roomC = new WorkflowYDocRoom(workflowId, SAMPLE_WORKSPACE_ID, {
      snapshotStore: store,
      intervalMs: 1_000_000,
    });
    const docC = await roomC.hydrate(SAMPLE_USER_ID);
    expect(docC.getText("text").toString()).toBe("alpha beta");
    await roomC.flushAndStop();
  });
});
