/**
 * HEL-774: webhook-resume endpoint — route tests (supertest).
 *
 * Stubs the run store + queue (and the engine, for the no-queue inline
 * fallback — jest intercepts the route's dynamic import) so the route's
 * lookup → merge/consume → re-enqueue logic is exercised in isolation. The
 * payload merge uses the REAL mergeResumePayload, so the clobber-guard is
 * covered end-to-end.
 */

import express from "express";
import request from "supertest";

jest.mock("../engine/runStore", () => ({
  runStore: { getByResumeToken: jest.fn(), update: jest.fn(async () => undefined) },
}));
jest.mock("../queue/queues", () => ({
  getRunQueue: jest.fn(() => null),
  // HEL-700: addRunJob forwards to queue.add (adding a priority option), so the
  // mock delegates — tests still spy on the queue's own add().
  addRunJob: (
    queue: { add: (...args: unknown[]) => unknown },
    name: string,
    payload: unknown,
    opts: unknown,
  ) => queue.add(name, payload, opts),
}));
jest.mock("../engine/WorkflowEngine", () => ({
  workflowEngine: { executeQueuedRun: jest.fn(async () => undefined) },
}));

import { createResumeRoutes } from "./resumeRoutes";
import { runStore } from "../engine/runStore";
import { getRunQueue } from "../queue/queues";
import { workflowEngine } from "../engine/WorkflowEngine";

const mockGetByToken = runStore.getByResumeToken as jest.Mock;
const mockUpdate = runStore.update as jest.Mock;
const mockGetRunQueue = getRunQueue as jest.Mock;
const mockExecuteQueuedRun = workflowEngine.executeQueuedRun as jest.Mock;

const TOKEN = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function pausedRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    templateId: "tpl-1",
    templateName: "T",
    workflowVersionId: "wv-1",
    workspaceId: "ws1",
    status: "queued",
    startedAt: new Date().toISOString(),
    input: {},
    stepResults: [],
    runtimeState: {
      config: { workspaceId: "ws1" },
      context: { workspaceId: "ws1", existing: "keep" },
      currentStepIndex: 2,
      waitingResumeToken: TOKEN,
    },
    ...overrides,
  };
}

function app() {
  const a = express();
  a.use(express.json());
  a.use("/api/runs/resume", createResumeRoutes());
  return a;
}

beforeEach(() => {
  mockGetByToken.mockReset();
  mockUpdate.mockClear();
  mockExecuteQueuedRun.mockClear();
  mockGetRunQueue.mockReturnValue(null);
});

describe("POST /api/runs/resume/:token (HEL-774)", () => {
  it("404s a malformed token without touching the store", async () => {
    const res = await request(app()).post("/api/runs/resume/not-a-uuid").send({});
    expect(res.status).toBe(404);
    expect(mockGetByToken).not.toHaveBeenCalled();
  });

  it("404s an unknown token", async () => {
    mockGetByToken.mockResolvedValue(undefined);
    const res = await request(app()).post(`/api/runs/resume/${TOKEN}`).send({});
    expect(res.status).toBe(404);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("404s when the run no longer carries the token (already consumed)", async () => {
    mockGetByToken.mockResolvedValue(
      pausedRun({
        runtimeState: { config: {}, context: {}, currentStepIndex: 2 },
      }),
    );
    const res = await request(app()).post(`/api/runs/resume/${TOKEN}`).send({});
    expect(res.status).toBe(404);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("202: merges the payload (clobber-guarded), consumes the token, enqueues the resume", async () => {
    mockGetByToken.mockResolvedValue(pausedRun());
    const fakeAdd = jest.fn().mockResolvedValue(undefined);
    mockGetRunQueue.mockReturnValue({ add: fakeAdd });

    const res = await request(app())
      .post(`/api/runs/resume/${TOKEN}`)
      .send({ approved: true, workspaceId: "ws-evil" });

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ runId: "run-1", resumedAtStepIndex: 2 });

    // One update: token cleared + payload merged, tenancy protected.
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const [updatedId, patch] = mockUpdate.mock.calls[0];
    expect(updatedId).toBe("run-1");
    expect(patch.runtimeState.waitingResumeToken).toBeUndefined();
    expect(patch.runtimeState.context).toMatchObject({
      existing: "keep",
      approved: true,
      workspaceId: "ws1", // caller's ws-evil ignored
      resumePayload: { approved: true, workspaceId: "ws-evil" },
    });

    // Re-enqueued at the persisted resume index, in the run's own workspace.
    expect(fakeAdd).toHaveBeenCalledTimes(1);
    const [, payload, opts] = fakeAdd.mock.calls[0];
    expect(payload).toMatchObject({ runId: "run-1", stepIndex: 2, workspaceId: "ws1" });
    expect(opts.jobId).toBe("run-1:webhook-resume:2");
    expect(mockExecuteQueuedRun).not.toHaveBeenCalled();
  });

  it("falls back to an inline engine resume when there is no queue", async () => {
    mockGetByToken.mockResolvedValue(pausedRun());
    const res = await request(app()).post(`/api/runs/resume/${TOKEN}`).send({ ok: 1 });
    expect(res.status).toBe(202);
    expect(mockExecuteQueuedRun).toHaveBeenCalledWith("run-1", 2);
  });
});
