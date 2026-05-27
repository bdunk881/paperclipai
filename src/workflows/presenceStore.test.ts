/**
 * presenceStore tests — HEL-241C.
 */
import { describe, it, expect } from "@jest/globals";
import {
  createPresenceStore,
  colorForUser,
  PRESENCE_COLORS,
  PRESENCE_TTL_MS,
  type PresenceState,
} from "./presenceStore";

function state(
  overrides: Partial<PresenceState> & Pick<PresenceState, "userId">,
): PresenceState {
  return {
    name: "Test",
    color: "#000000",
    selectedStepId: null,
    lastSeen: Date.now(),
    ...overrides,
  };
}

describe("createPresenceStore", () => {
  it("returns peers for a workflow, excluding the caller", () => {
    const store = createPresenceStore();
    store.upsert("wf-1", state({ userId: "u1", lastSeen: Date.now() }));
    store.upsert("wf-1", state({ userId: "u2", lastSeen: Date.now() }));

    expect(store.peers("wf-1", "u1").map((p) => p.userId)).toEqual(["u2"]);
    expect(store.peers("wf-1", "u2").map((p) => p.userId)).toEqual(["u1"]);
    expect(store.peers("wf-1").map((p) => p.userId).sort()).toEqual(["u1", "u2"]);
  });

  it("reaps stale entries past PRESENCE_TTL_MS on read", () => {
    let clock = 1_000_000;
    const store = createPresenceStore(() => clock);
    store.upsert("wf-1", state({ userId: "u1", lastSeen: clock }));
    store.upsert("wf-1", state({ userId: "u2", lastSeen: clock }));

    clock += PRESENCE_TTL_MS + 1;
    // u1 heartbeats again, u2 goes stale.
    store.upsert("wf-1", state({ userId: "u1", lastSeen: clock }));

    expect(store.peers("wf-1").map((p) => p.userId)).toEqual(["u1"]);
  });

  it("upsert replaces an existing entry's selectedStepId", () => {
    const store = createPresenceStore();
    store.upsert("wf-1", state({ userId: "u1", selectedStepId: "step-a" }));
    store.upsert("wf-1", state({ userId: "u1", selectedStepId: "step-b" }));

    const peers = store.peers("wf-1");
    expect(peers).toHaveLength(1);
    expect(peers[0].selectedStepId).toBe("step-b");
  });

  it("remove drops the entry and cleans up empty workflow buckets", () => {
    const store = createPresenceStore();
    store.upsert("wf-1", state({ userId: "u1" }));
    store.remove("wf-1", "u1");
    expect(store.peers("wf-1")).toEqual([]);
  });

  it("isolates state across workflows", () => {
    const store = createPresenceStore();
    store.upsert("wf-1", state({ userId: "u1" }));
    store.upsert("wf-2", state({ userId: "u1" }));

    store.remove("wf-1", "u1");
    expect(store.peers("wf-1")).toEqual([]);
    expect(store.peers("wf-2")).toHaveLength(1);
  });
});

describe("colorForUser", () => {
  it("returns a stable color across calls", () => {
    expect(colorForUser("user-abc")).toBe(colorForUser("user-abc"));
  });

  it("only returns values from the PRESENCE_COLORS palette", () => {
    for (const u of ["a", "b", "c", "d", "e", "very-long-user-id-here"]) {
      expect(PRESENCE_COLORS).toContain(colorForUser(u));
    }
  });

  it("distributes across the palette for varied inputs", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) seen.add(colorForUser(`user-${i}`));
    expect(seen.size).toBeGreaterThan(1);
  });
});
