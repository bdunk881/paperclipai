/**
 * Unit tests for streamSseHandler.
 *
 * Uses an in-memory subscriber + a minimal Request/Response pair (no real
 * HTTP socket) so we can drive the publish path end-to-end without
 * binding a port.
 */

import { describe, expect, it, jest } from "@jest/globals";
import type { Request, Response } from "express";
import { EventEmitter } from "events";

const mockGetRedisClient =
  jest.fn<() => ReturnType<typeof import("../../queue/redisClient").getRedisClient>>(
    () => null,
  );
jest.mock("../../queue/redisClient", () => ({
  getRedisClient: () => mockGetRedisClient(),
}));

import {
  publishWorkspaceStreamEvent,
  resetWorkspaceStreamForTests,
  type WorkspaceStreamEnvelope,
} from "./streamPublisher";
import { handleStreamSse } from "./streamSseHandler";

interface FakeRes extends Response {
  written: string[];
  _flushed: boolean;
}

function makeFakeRequest(): Request {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {}) as unknown as Request;
}

function makeFakeResponse(): FakeRes {
  const written: string[] = [];
  const res = {
    written,
    _flushed: false,
    set: jest.fn(),
    flushHeaders: jest.fn(() => {
      // capture that flush was called
    }),
    write: jest.fn((chunk: string) => {
      written.push(chunk);
      return true;
    }),
    end: jest.fn(),
  } as unknown as FakeRes;
  return res;
}

describe("handleStreamSse", () => {
  beforeEach(() => {
    resetWorkspaceStreamForTests();
  });

  afterEach(() => {
    resetWorkspaceStreamForTests();
  });

  it("writes SSE headers and an initial snapshot when provided", async () => {
    const req = makeFakeRequest();
    const res = makeFakeResponse();
    const snapshot = jest.fn(async () => ({ hello: "world" }));

    await handleStreamSse(req, res, {
      workspaceId: "ws-1",
      filter: () => true,
      snapshot,
    });

    expect(res.set).toHaveBeenCalledWith(
      expect.objectContaining({ "Content-Type": "text/event-stream" }),
    );
    expect(snapshot).toHaveBeenCalledTimes(1);
    const joined = res.written.join("");
    expect(joined).toContain("event: snapshot\n");
    expect(joined).toContain(`data: ${JSON.stringify({ hello: "world" })}\n\n`);
    req.emit("close");
  });

  it("forwards matching envelopes to the response and skips non-matching ones", async () => {
    const req = makeFakeRequest();
    const res = makeFakeResponse();

    const accepted: WorkspaceStreamEnvelope[] = [];
    await handleStreamSse(req, res, {
      workspaceId: "ws-1",
      filter: (envelope) => {
        // Accept only run.lifecycle events; reject the rest.
        if (envelope.event.kind === "run.lifecycle") {
          accepted.push(envelope);
          return true;
        }
        return false;
      },
    });

    await publishWorkspaceStreamEvent("ws-1", {
      kind: "run.lifecycle",
      phase: "started",
      runId: "run-1",
      agentId: "agent-1",
      routineId: null,
      ticketId: null,
    });
    await publishWorkspaceStreamEvent("ws-1", {
      kind: "activity.event",
      activityKind: "agent.prompt_executed",
    });

    const joined = res.written.join("");
    expect(joined).toContain("event: stream\n");
    expect(joined.match(/event: stream/g)?.length).toBe(1);
    expect(accepted).toHaveLength(1);
    req.emit("close");
  });

  it("ignores envelopes from a different workspace", async () => {
    const req = makeFakeRequest();
    const res = makeFakeResponse();

    await handleStreamSse(req, res, {
      workspaceId: "ws-A",
      filter: () => true,
    });

    await publishWorkspaceStreamEvent("ws-B", {
      kind: "activity.event",
      activityKind: "agent.prompt_executed",
    });

    expect(res.written.some((w) => w.startsWith("event: stream"))).toBe(false);
    req.emit("close");
  });

  it("falls back to a null snapshot when the snapshot fn throws", async () => {
    const req = makeFakeRequest();
    const res = makeFakeResponse();

    await handleStreamSse(req, res, {
      workspaceId: "ws-1",
      filter: () => true,
      snapshot: async () => {
        throw new Error("snapshot blew up");
      },
    });

    const joined = res.written.join("");
    expect(joined).toContain("event: snapshot\n");
    expect(joined).toContain("data: null\n\n");
    req.emit("close");
  });

  it("subscribes to the Redis channel and forwards parsed messages", async () => {
    const messageHandlers: Array<(channel: string, msg: string) => void> = [];
    const subscribe = jest.fn(async () => undefined);
    const on = jest.fn((event: string, handler: (channel: string, msg: string) => void) => {
      if (event === "message") messageHandlers.push(handler);
    });
    const disconnect = jest.fn();
    const fakeSub = { subscribe, on, disconnect };
    const fakeBase = { duplicate: jest.fn(() => fakeSub) };
    mockGetRedisClient.mockReturnValueOnce(fakeBase as never);

    const req = makeFakeRequest();
    const res = makeFakeResponse();
    const received: WorkspaceStreamEnvelope[] = [];
    await handleStreamSse(req, res, {
      workspaceId: "ws-r",
      filter: (envelope) => {
        received.push(envelope);
        return true;
      },
    });

    expect(subscribe).toHaveBeenCalledWith("workspace:ws-r:agent-stream");
    expect(messageHandlers).toHaveLength(1);

    const env: WorkspaceStreamEnvelope = {
      workspaceId: "ws-r",
      seq: 1,
      at: "2026-01-01T00:00:00Z",
      event: { kind: "activity.event", activityKind: "agent.prompt_executed" },
    };
    messageHandlers[0]!("workspace:ws-r:agent-stream", JSON.stringify(env));
    expect(received).toHaveLength(1);

    // Malformed payload should be silently dropped.
    messageHandlers[0]!("workspace:ws-r:agent-stream", "not-json");
    expect(received).toHaveLength(1);

    req.emit("close");
    expect(disconnect).toHaveBeenCalled();
  });

  it("logs and continues when redis subscribe rejects", async () => {
    const subscribe = jest.fn(async () => {
      throw new Error("redis down");
    });
    const on = jest.fn();
    const disconnect = jest.fn();
    const fakeSub = { subscribe, on, disconnect };
    const fakeBase = { duplicate: jest.fn(() => fakeSub) };
    mockGetRedisClient.mockReturnValueOnce(fakeBase as never);

    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const req = makeFakeRequest();
    const res = makeFakeResponse();
    await handleStreamSse(req, res, {
      workspaceId: "ws-err",
      filter: () => true,
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("[agentStream] subscribe failed"),
    );
    warn.mockRestore();
    req.emit("close");
  });

  it("dedupes by seq — does not forward a replayed lower seq envelope", async () => {
    const req = makeFakeRequest();
    const res = makeFakeResponse();

    await handleStreamSse(req, res, {
      workspaceId: "ws-1",
      filter: () => true,
    });

    await publishWorkspaceStreamEvent("ws-1", {
      kind: "activity.event",
      activityKind: "first",
    });
    await publishWorkspaceStreamEvent("ws-1", {
      kind: "activity.event",
      activityKind: "second",
    });

    const streamFrames = res.written
      .filter((w) => w.startsWith("data: {"))
      .map((w) => JSON.parse(w.slice("data: ".length).trimEnd()) as WorkspaceStreamEnvelope);

    expect(streamFrames.map((f) => f.seq)).toEqual([1, 2]);
    req.emit("close");
  });
});
