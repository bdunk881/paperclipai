/**
 * Coverage for the Redis-backed agent presence layer (Wave 2a).
 *
 * Redis is mocked through the existing redisClient seam so these tests
 * stay fast and don't need a live ioredis instance.
 */

import {
  AGENT_PRESENCE_TTL_SECONDS,
  getAgentPresence,
  listWorkspaceAgentPresence,
  presenceChannel,
  presenceKey,
  setAgentPresence,
} from "./agentPresence";
import { resetRedisClientForTests } from "../queue/redisClient";

// Mock module behind getRedisClient(). The factory captures a shared
// mock Redis we control from each test.
const mockRedis = {
  get: jest.fn<Promise<string | null>, [string]>(),
  set: jest.fn<Promise<unknown>, unknown[]>(),
  publish: jest.fn<Promise<number>, [string, string]>(),
  scan: jest.fn<Promise<[string, string[]]>, unknown[]>(),
  mget: jest.fn<Promise<Array<string | null>>, string[]>(),
};

jest.mock("../queue/redisClient", () => ({
  getRedisClient: () => mockRedis,
  resetRedisClientForTests: jest.fn(),
}));

beforeEach(() => {
  mockRedis.get.mockReset();
  mockRedis.set.mockReset();
  mockRedis.publish.mockReset();
  mockRedis.scan.mockReset();
  mockRedis.mget.mockReset();
});

const WS = "11111111-1111-4111-8111-111111111111";
const AGENT = "22222222-2222-4222-8222-222222222222";

describe("agentPresence", () => {
  describe("setAgentPresence", () => {
    it("writes a TTL'd key and publishes to the workspace channel", async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      mockRedis.set.mockResolvedValueOnce("OK");
      mockRedis.publish.mockResolvedValueOnce(1);

      const presence = await setAgentPresence({
        workspaceId: WS,
        agentId: AGENT,
        state: "working",
        currentTask: "processing invoice #42",
      });

      expect(presence.state).toBe("working");
      expect(presence.currentTask).toBe("processing invoice #42");
      expect(presence.since).toBe(presence.updatedAt);
      expect(mockRedis.set).toHaveBeenCalledWith(
        presenceKey(WS, AGENT),
        expect.any(String),
        "EX",
        AGENT_PRESENCE_TTL_SECONDS,
      );
      expect(mockRedis.publish).toHaveBeenCalledWith(
        presenceChannel(WS),
        expect.any(String),
      );
    });

    it("preserves `since` when the state hasn't changed", async () => {
      const prior = {
        agentId: AGENT,
        workspaceId: WS,
        state: "working",
        currentTask: "step A",
        since: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:10.000Z",
      };
      mockRedis.get.mockResolvedValueOnce(JSON.stringify(prior));
      mockRedis.set.mockResolvedValueOnce("OK");
      mockRedis.publish.mockResolvedValueOnce(1);

      const presence = await setAgentPresence({
        workspaceId: WS,
        agentId: AGENT,
        state: "working",
        currentTask: "step A",
      });

      expect(presence.since).toBe(prior.since);
      expect(presence.updatedAt).not.toBe(prior.updatedAt);
    });

    it("resets `since` on a state transition", async () => {
      const prior = {
        agentId: AGENT,
        workspaceId: WS,
        state: "working",
        currentTask: "step A",
        since: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:10.000Z",
      };
      mockRedis.get.mockResolvedValueOnce(JSON.stringify(prior));
      mockRedis.set.mockResolvedValueOnce("OK");
      mockRedis.publish.mockResolvedValueOnce(1);

      const presence = await setAgentPresence({
        workspaceId: WS,
        agentId: AGENT,
        state: "idle",
        currentTask: null,
      });

      expect(presence.since).not.toBe(prior.since);
      expect(presence.since).toBe(presence.updatedAt);
    });

    it("normalizes empty currentTask to null", async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      mockRedis.set.mockResolvedValueOnce("OK");
      mockRedis.publish.mockResolvedValueOnce(1);

      const presence = await setAgentPresence({
        workspaceId: WS,
        agentId: AGENT,
        state: "idle",
        currentTask: "   ",
      });

      expect(presence.currentTask).toBeNull();
    });

    it("swallows Redis errors — presence is a hint, never blocks the producer", async () => {
      mockRedis.get.mockRejectedValueOnce(new Error("read failed"));
      mockRedis.set.mockRejectedValueOnce(new Error("write failed"));

      await expect(
        setAgentPresence({
          workspaceId: WS,
          agentId: AGENT,
          state: "working",
        }),
      ).resolves.toMatchObject({ state: "working" });
    });
  });

  describe("getAgentPresence", () => {
    it("returns the parsed value when the key exists", async () => {
      const value = {
        agentId: AGENT,
        workspaceId: WS,
        state: "working",
        currentTask: "x",
        since: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:01.000Z",
      };
      mockRedis.get.mockResolvedValueOnce(JSON.stringify(value));
      const out = await getAgentPresence(WS, AGENT);
      expect(out).toEqual(value);
    });

    it("returns null when the TTL has lapsed (key gone)", async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      expect(await getAgentPresence(WS, AGENT)).toBeNull();
    });

    it("returns null on a Redis read error rather than throwing", async () => {
      mockRedis.get.mockRejectedValueOnce(new Error("oops"));
      expect(await getAgentPresence(WS, AGENT)).toBeNull();
    });
  });

  describe("listWorkspaceAgentPresence", () => {
    it("scans the workspace prefix and returns parsed values for every live key", async () => {
      mockRedis.scan
        .mockResolvedValueOnce(["0", [
          presenceKey(WS, "a-1"),
          presenceKey(WS, "a-2"),
        ]]);
      mockRedis.mget.mockResolvedValueOnce([
        JSON.stringify({ agentId: "a-1", workspaceId: WS, state: "working", currentTask: null, since: "x", updatedAt: "x" }),
        JSON.stringify({ agentId: "a-2", workspaceId: WS, state: "idle", currentTask: null, since: "y", updatedAt: "y" }),
      ]);

      const list = await listWorkspaceAgentPresence(WS);
      expect(list).toHaveLength(2);
      expect(list.map((p) => p.agentId).sort()).toEqual(["a-1", "a-2"]);
    });

    it("returns [] when no live keys match", async () => {
      mockRedis.scan.mockResolvedValueOnce(["0", []]);
      expect(await listWorkspaceAgentPresence(WS)).toEqual([]);
    });

    it("skips malformed entries rather than failing the whole list", async () => {
      mockRedis.scan.mockResolvedValueOnce(["0", [presenceKey(WS, "a-1"), presenceKey(WS, "a-2")]]);
      mockRedis.mget.mockResolvedValueOnce([
        "not-json",
        JSON.stringify({ agentId: "a-2", workspaceId: WS, state: "idle", currentTask: null, since: "y", updatedAt: "y" }),
      ]);

      const list = await listWorkspaceAgentPresence(WS);
      expect(list).toHaveLength(1);
      expect(list[0]?.agentId).toBe("a-2");
    });
  });
});

afterAll(() => {
  resetRedisClientForTests();
});
