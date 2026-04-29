import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function importObservabilityWithMockMode() {
  vi.resetModules();
  vi.stubEnv("VITE_USE_MOCK", "true");
  vi.stubGlobal("fetch", vi.fn());
  return import("./observability");
}

describe("observability mock mode", () => {
  it("returns mock events without fetching", async () => {
    const observability = await importObservabilityWithMockMode();

    const page = await observability.listObservabilityEvents("mock-token", {
      categories: ["alert"],
      limit: 5,
    });

    expect(page.events).toHaveLength(1);
    expect(page.events[0]?.category).toBe("alert");
    expect(vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("returns a mock throughput snapshot without fetching", async () => {
    const observability = await importObservabilityWithMockMode();

    const snapshot = await observability.getObservabilityThroughput("mock-token", 6);

    expect(snapshot.windowHours).toBe(6);
    expect(snapshot.summary.completedCount).toBeGreaterThan(0);
    expect(vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("emits a ready event for the mock stream without fetching", async () => {
    const observability = await importObservabilityWithMockMode();
    const controller = new AbortController();
    const onReady = vi.fn();

    const streamPromise = observability.streamObservabilityEvents("mock-token", {
      signal: controller.signal,
      limit: 20,
      onEvent: vi.fn(),
      onReady,
    });

    expect(onReady).toHaveBeenCalledWith(
      expect.objectContaining({
        replayed: expect.any(Number),
        nextCursor: expect.any(String),
      })
    );

    controller.abort();
    await streamPromise;
    expect(vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });
});
