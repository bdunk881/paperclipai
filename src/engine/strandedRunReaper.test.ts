/**
 * HEL-695: reapStrandedRuns — unit tests (fake pool + queue).
 *
 * Verifies the reaper flips stranded `running` runs to `queued` and re-enqueues a
 * replay-from-0, fails a run past the attempt cap, and never touches anything the
 * SELECT didn't return (legitimately-paused runs are `queued`/`awaiting_approval`,
 * so the `status='running'` filter excludes them at the source).
 */
import { reapStrandedRuns } from "./strandedRunReaper";

interface FakeRow {
  id: string;
  workspace_id: string | null;
  workflow_version_id: string | null;
  external_template_id: string | null;
  resume_attempts: number;
}

function makePool(staleRows: FakeRow[], opts?: { updateRowCount?: number }) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const updateRowCount = opts?.updateRowCount ?? 1;
  const query = jest.fn(async (sql: string, params: unknown[]) => {
    calls.push({ sql, params });
    if (/SELECT[\s\S]*FROM runs/i.test(sql)) {
      return { rows: staleRows, rowCount: staleRows.length };
    }
    if (/UPDATE runs/i.test(sql)) {
      return { rows: [], rowCount: updateRowCount };
    }
    return { rows: [], rowCount: 0 };
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { pool: { query } as any, calls, query };
}

function makeFakeQueue() {
  const calls: Array<{ name: string; data: Record<string, unknown>; opts: Record<string, unknown> }> = [];
  const add = jest.fn(async (name: string, data: Record<string, unknown>, o: Record<string, unknown>) => {
    calls.push({ name, data, opts: o });
    return { id: o?.["jobId"] };
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { queue: { add } as any, calls, add };
}

const row = (over: Partial<FakeRow> = {}): FakeRow => ({
  id: "33333333-3333-4333-8333-333333333333",
  workspace_id: "22222222-2222-4222-8222-222222222222",
  workflow_version_id: "44444444-4444-4444-8444-444444444444",
  external_template_id: "tpl-x",
  resume_attempts: 0,
  ...over,
});

describe("reapStrandedRuns (HEL-695)", () => {
  it("flips a stranded running run to queued + enqueues a replay-from-0", async () => {
    const { pool, calls } = makePool([row()]);
    const { queue, calls: qCalls } = makeFakeQueue();

    const result = await reapStrandedRuns({ pool, runQueue: queue, staleMs: 1000, maxAttempts: 3 });

    expect(result).toEqual({ scanned: 1, resumed: 1, failed: 0 });
    // SELECT carried the staleMs threshold
    expect(calls.some((c) => /FROM runs/i.test(c.sql) && c.params.includes(1000))).toBe(true);
    // claimed via running → queued
    expect(calls.some((c) => /UPDATE runs[\s\S]*status = 'queued'/i.test(c.sql))).toBe(true);
    // enqueued replay-from-0
    expect(qCalls).toHaveLength(1);
    expect(qCalls[0]!.name).toBe("run");
    expect(qCalls[0]!.data).toMatchObject({
      runId: row().id,
      templateId: "tpl-x",
      stepIndex: 0,
    });
    expect(qCalls[0]!.opts).toMatchObject({ jobId: `resume:${row().id}:1` });
  });

  it("fails a run past the attempt cap instead of resurrecting it", async () => {
    const { pool, calls } = makePool([row({ resume_attempts: 3 })]);
    const { queue, calls: qCalls } = makeFakeQueue();

    const result = await reapStrandedRuns({ pool, runQueue: queue, staleMs: 1000, maxAttempts: 3 });

    expect(result).toEqual({ scanned: 1, resumed: 0, failed: 1 });
    expect(calls.some((c) => /UPDATE runs[\s\S]*status = 'failed'/i.test(c.sql))).toBe(true);
    expect(qCalls).toHaveLength(0);
  });

  it("is a no-op when nothing is stranded", async () => {
    const { pool } = makePool([]);
    const { queue, calls: qCalls } = makeFakeQueue();

    const result = await reapStrandedRuns({ pool, runQueue: queue });

    expect(result).toEqual({ scanned: 0, resumed: 0, failed: 0 });
    expect(qCalls).toHaveLength(0);
  });

  it("skips enqueue when the claim is lost to a race (UPDATE affected 0 rows)", async () => {
    const { pool } = makePool([row()], { updateRowCount: 0 });
    const { queue, calls: qCalls } = makeFakeQueue();

    const result = await reapStrandedRuns({ pool, runQueue: queue, staleMs: 1000 });

    expect(result.resumed).toBe(0);
    expect(qCalls).toHaveLength(0);
  });

  it("claims the run even with no queue (still flips status; no enqueue)", async () => {
    const { pool } = makePool([row()]);

    const result = await reapStrandedRuns({ pool, runQueue: null, staleMs: 1000 });

    expect(result).toEqual({ scanned: 1, resumed: 1, failed: 0 });
  });
});
