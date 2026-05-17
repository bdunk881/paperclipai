import { Pool } from "pg";
import { deriveIdempotencyKey, withIdempotency } from "./withIdempotency";

describe("deriveIdempotencyKey", () => {
  it("is deterministic for the same inputs", () => {
    expect(deriveIdempotencyKey("run-1", 0, "v1")).toBe(
      deriveIdempotencyKey("run-1", 0, "v1")
    );
  });

  it("produces a 64-character hex string (SHA-256)", () => {
    const key = deriveIdempotencyKey("run-1", 0, "v1");
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs when stepIndex changes", () => {
    expect(deriveIdempotencyKey("run-1", 0, "v1")).not.toBe(
      deriveIdempotencyKey("run-1", 1, "v1")
    );
  });

  it("differs when runId changes", () => {
    expect(deriveIdempotencyKey("run-1", 0, "v1")).not.toBe(
      deriveIdempotencyKey("run-2", 0, "v1")
    );
  });

  it("differs when workflowVersionId changes", () => {
    expect(deriveIdempotencyKey("run-1", 0, "v1")).not.toBe(
      deriveIdempotencyKey("run-1", 0, "v2")
    );
  });

  it("works without workflowVersionId", () => {
    const key = deriveIdempotencyKey("run-1", 0);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces a different key without workflowVersionId vs with it", () => {
    expect(deriveIdempotencyKey("run-1", 0)).not.toBe(
      deriveIdempotencyKey("run-1", 0, "v1")
    );
  });
});

describe("withIdempotency", () => {
  function makePool(rows: Record<string, unknown>[]): Pool {
    return {
      query: jest.fn().mockResolvedValue({ rows }),
    } as unknown as Pool;
  }

  it("calls fn and returns its result when no cached row exists", async () => {
    const pool = makePool([]);
    const fn = jest.fn().mockResolvedValue({ answer: 42 });

    const result = await withIdempotency(pool, "key-abc", fn);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ answer: 42 });
  });

  it("returns cached output without calling fn when a row exists", async () => {
    const pool = makePool([{ output: { answer: 99 } }]);
    const fn = jest.fn();

    const result = await withIdempotency(pool, "key-abc", fn);

    expect(fn).not.toHaveBeenCalled();
    expect(result).toEqual({ answer: 99 });
  });

  it("queries step_results by idempotency_key", async () => {
    const pool = makePool([]);
    const fn = jest.fn().mockResolvedValue(null);

    await withIdempotency(pool, "my-key", fn);

    expect((pool.query as jest.Mock)).toHaveBeenCalledWith(
      expect.stringContaining("idempotency_key"),
      ["my-key"]
    );
  });
});
