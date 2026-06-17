import {
  mintRealtimeToken,
  verifyRealtimeToken,
  isRealtimeTokenConfigured,
  InvalidRealtimeTokenError,
} from "./realtimeToken";

const SECRET = "test-realtime-secret-at-least-32-bytes-long!!";

describe("realtime token (HEL-708)", () => {
  const original = process.env.REALTIME_TOKEN_SECRET;
  beforeEach(() => {
    process.env.REALTIME_TOKEN_SECRET = SECRET;
  });
  afterAll(() => {
    if (original === undefined) delete process.env.REALTIME_TOKEN_SECRET;
    else process.env.REALTIME_TOKEN_SECRET = original;
  });

  it("mints + verifies a scoped, read-only token", () => {
    const { token, payload } = mintRealtimeToken({ workspaceId: "ws-1", runId: "run-1" });
    expect(payload).toMatchObject({ workspace_id: "ws-1", run_id: "run-1", scope: "run_read" });
    const verified = verifyRealtimeToken(token);
    expect(verified.workspace_id).toBe("ws-1");
    expect(verified.run_id).toBe("run-1");
    expect(verified.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("rejects a tampered signature", () => {
    const { token } = mintRealtimeToken({ workspaceId: "ws-1", runId: "run-1" });
    const tampered = `${token.slice(0, -2)}xy`;
    expect(() => verifyRealtimeToken(tampered)).toThrow(InvalidRealtimeTokenError);
  });

  it("rejects a token signed with a different secret", () => {
    const { token } = mintRealtimeToken({ workspaceId: "ws-1", runId: "run-1" });
    process.env.REALTIME_TOKEN_SECRET = "a-totally-different-secret-also-32-bytes-xx";
    expect(() => verifyRealtimeToken(token)).toThrow(/signature/);
  });

  it("rejects an expired token", () => {
    const { token } = mintRealtimeToken({ workspaceId: "ws-1", runId: "run-1", ttlSeconds: -1 });
    expect(() => verifyRealtimeToken(token)).toThrow(/expired/);
  });

  it("rejects a malformed token", () => {
    expect(() => verifyRealtimeToken("not-a-token")).toThrow(/format/);
  });

  it("isRealtimeTokenConfigured reflects the secret", () => {
    expect(isRealtimeTokenConfigured()).toBe(true);
    delete process.env.REALTIME_TOKEN_SECRET;
    expect(isRealtimeTokenConfigured()).toBe(false);
    process.env.REALTIME_TOKEN_SECRET = "too-short";
    expect(isRealtimeTokenConfigured()).toBe(false);
  });
});
