import { describe, it, expect, vi, afterEach } from "vitest";

// trackedFetch logs metrics/errors to Sentry in its finally block; stub the
// module so the test doesn't depend on a real Sentry client.
vi.mock("@sentry/react", () => ({
  metrics: { count: vi.fn(), distribution: vi.fn() },
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
  captureException: vi.fn(),
}));

import { trackedFetch } from "./trackedFetch";

describe("trackedFetch credentials (HEL-424)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults credentials to 'include' so the AAL2 attestation cookie rides cross-origin calls", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await trackedFetch("https://api.example.com/x");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.credentials).toBe("include");
  });

  it("respects an explicit credentials override", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await trackedFetch("https://api.example.com/x", { credentials: "omit" });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.credentials).toBe("omit");
  });
});
