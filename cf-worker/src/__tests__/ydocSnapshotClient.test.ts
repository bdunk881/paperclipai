/**
 * HEL-802 (B5) — the DO ⇄ Postgres snapshot client. base64 helpers are pure; the
 * GET/POST logic is exercised with an injected fake `callInternalApi` (this
 * vitest-pool-workers build exposes no outbound fetch mock), so we assert path /
 * method / body and response handling without a live API.
 */
import { describe, it, expect } from "vitest";
import {
  bytesToBase64,
  base64ToBytes,
  loadYDocSnapshot,
  saveYDocSnapshot,
  type CallInternalApi,
} from "../ydocSnapshotClient";

const ENV = {
  API_BASE_URL: "https://api.test",
  CF_WORKER_SHARED_SECRET: "test-secret",
  CF_WORKER_INTERNAL_JWT_AUDIENCE: "autoflow-api-internal",
};
const T = { workflowId: "wf-1", workspaceId: "ws-1", userId: "u-1" };

interface Captured {
  path: string;
  method?: string;
  body?: unknown;
}

/** Build a fake caller that records the call and returns a canned Response. */
function fakeCall(response: Response): { call: CallInternalApi; calls: Captured[] } {
  const calls: Captured[] = [];
  const call: CallInternalApi = async (_env, path, init = {}) => {
    calls.push({
      path,
      method: init.method,
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
    });
    return response;
  };
  return { call, calls };
}

describe("base64 round-trip", () => {
  it("round-trips arbitrary bytes including high/zero values", () => {
    const bytes = new Uint8Array([0, 1, 2, 127, 128, 250, 255, 7]);
    expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes));
  });

  it("round-trips a large buffer (chunked encode)", () => {
    const big = new Uint8Array(40_000);
    for (let i = 0; i < big.length; i++) big[i] = i % 256;
    expect(base64ToBytes(bytesToBase64(big))).toEqual(big);
  });
});

describe("saveYDocSnapshot", () => {
  it("POSTs base64 state to the snapshot path and resolves on 204", async () => {
    const { call, calls } = fakeCall(new Response(null, { status: 204 }));
    await saveYDocSnapshot(ENV, T, new Uint8Array([1, 2, 3, 250]), call);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].path).toBe(`workflows/${T.workflowId}/ydoc-snapshot`);
    const body = calls[0].body as { workspaceId: string; userId: string; state: string };
    expect([body.workspaceId, body.userId]).toEqual([T.workspaceId, T.userId]);
    expect(Array.from(base64ToBytes(body.state))).toEqual([1, 2, 3, 250]);
  });

  it("throws on a non-2xx response", async () => {
    const { call } = fakeCall(new Response("boom", { status: 500 }));
    await expect(saveYDocSnapshot(ENV, T, new Uint8Array([1]), call)).rejects.toThrow();
  });
});

describe("loadYDocSnapshot", () => {
  it("GETs with workspace/user query and returns decoded bytes from a 200", async () => {
    const state = bytesToBase64(new Uint8Array([9, 8, 7]));
    const { call, calls } = fakeCall(
      new Response(JSON.stringify({ state, version: 3 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const out = await loadYDocSnapshot(ENV, T, call);
    expect(out && Array.from(out)).toEqual([9, 8, 7]);
    expect(calls[0].method).toBe("GET");
    expect(calls[0].path).toBe(
      `workflows/${T.workflowId}/ydoc-snapshot?workspaceId=${T.workspaceId}&userId=${T.userId}`,
    );
  });

  it("returns null on a 404 (no snapshot yet)", async () => {
    const { call } = fakeCall(new Response(null, { status: 404 }));
    expect(await loadYDocSnapshot(ENV, T, call)).toBeNull();
  });

  it("throws on other non-2xx", async () => {
    const { call } = fakeCall(new Response("boom", { status: 500 }));
    await expect(loadYDocSnapshot(ENV, T, call)).rejects.toThrow();
  });
});
