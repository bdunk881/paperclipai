/**
 * useTaskTrigger (HEL-710) — mint a trigger token → start a run → expose the
 * runId so the caller can feed it into useRealtimeRun.
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchTriggerTokenMock, triggerRunMock, requireAccessTokenMock } = vi.hoisted(() => ({
  fetchTriggerTokenMock: vi.fn(),
  triggerRunMock: vi.fn(),
  requireAccessTokenMock: vi.fn(),
}));

vi.mock("../api/runsApi", () => ({
  fetchTriggerToken: fetchTriggerTokenMock,
  triggerRun: triggerRunMock,
}));
vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ requireAccessToken: requireAccessTokenMock }),
}));

import { useTaskTrigger } from "./useTaskTrigger";

beforeEach(() => {
  vi.clearAllMocks();
  requireAccessTokenMock.mockResolvedValue("access-tok");
  fetchTriggerTokenMock.mockResolvedValue({
    token: "trig-tok",
    templateId: "tpl-1",
    expiresAt: "2026-06-18T12:00:00Z",
  });
  triggerRunMock.mockResolvedValue({
    runId: "run-9",
    token: "read-tok",
    expiresAt: "2026-06-18T12:30:00Z",
  });
});

describe("useTaskTrigger", () => {
  it("mints a trigger token then starts a run, exposing the runId + read token", async () => {
    const { result } = renderHook(() => useTaskTrigger("tpl-1"));
    expect(result.current.runId).toBeNull();

    await act(async () => {
      const r = await result.current.trigger({ message: "hi" });
      expect(r?.runId).toBe("run-9");
    });

    expect(fetchTriggerTokenMock).toHaveBeenCalledWith("access-tok", "tpl-1");
    expect(triggerRunMock).toHaveBeenCalledWith("trig-tok", "tpl-1", { message: "hi" });
    expect(result.current.runId).toBe("run-9");
    expect(result.current.token).toBe("read-tok");
    expect(result.current.error).toBeNull();
  });

  it("sets an error and returns null when no template is selected", async () => {
    const { result } = renderHook(() => useTaskTrigger(null));
    await act(async () => {
      const r = await result.current.trigger();
      expect(r).toBeNull();
    });
    expect(result.current.error).toBe("No template selected");
    expect(fetchTriggerTokenMock).not.toHaveBeenCalled();
  });

  it("surfaces a trigger failure as error", async () => {
    triggerRunMock.mockRejectedValueOnce(new Error("quota exceeded"));
    const { result } = renderHook(() => useTaskTrigger("tpl-1"));
    await act(async () => {
      const r = await result.current.trigger();
      expect(r).toBeNull();
    });
    expect(result.current.error).toBe("quota exceeded");
    expect(result.current.runId).toBeNull();
  });

  it("reset() clears runId / token / error", async () => {
    const { result } = renderHook(() => useTaskTrigger("tpl-1"));
    await act(async () => {
      await result.current.trigger();
    });
    expect(result.current.runId).toBe("run-9");
    act(() => {
      result.current.reset();
    });
    expect(result.current.runId).toBeNull();
    expect(result.current.token).toBeNull();
  });
});
