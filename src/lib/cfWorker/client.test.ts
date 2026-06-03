import { callWorker } from "./client";

const ORIGINAL_BASE_URL = process.env.CF_WORKER_BASE_URL;

describe("callWorker", () => {
  beforeEach(() => {
    process.env.CF_WORKER_BASE_URL = "https://worker.test.example";
    jest.restoreAllMocks();
  });

  afterAll(() => {
    if (ORIGINAL_BASE_URL === undefined) {
      delete process.env.CF_WORKER_BASE_URL;
    } else {
      process.env.CF_WORKER_BASE_URL = ORIGINAL_BASE_URL;
    }
  });

  function mockFetchResolving(response: Response): jest.SpyInstance {
    return jest.spyOn(globalThis, "fetch").mockResolvedValue(response);
  }

  it("returns ok=true with parsed data on a 2xx response", async () => {
    mockFetchResolving(new Response(JSON.stringify({ value: 7 }), { status: 200 }));
    const result = await callWorker<{ value: number }>("/__health", { method: "GET" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({ value: 7 });
      expect(result.status).toBe(200);
    }
  });

  it("fail-open: returns ok=false with errorReason on a non-2xx", async () => {
    mockFetchResolving(new Response("nope", { status: 500 }));
    const result = await callWorker("/__health", { method: "GET" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorReason).toBe("non_2xx");
    }
  });

  it("fail-closed: throws on a non-2xx", async () => {
    mockFetchResolving(new Response("nope", { status: 500 }));
    await expect(
      callWorker("/__health", { method: "GET" }, { onFailure: "fail-closed" }),
    ).rejects.toThrow(/cf-worker.*500/);
  });

  it("fail-open: returns errorReason=timeout when the fetch is aborted past timeoutMs", async () => {
    jest.spyOn(globalThis, "fetch").mockImplementation(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const abortErr = new Error("aborted");
            abortErr.name = "AbortError";
            reject(abortErr);
          });
        }),
    );
    const result = await callWorker("/__health", { method: "GET" }, { timeoutMs: 5 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorReason).toBe("timeout");
    }
  });

  it("fail-open: returns errorReason=network on a thrown fetch", async () => {
    jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("DNS lookup failed"));
    const result = await callWorker("/__health", { method: "GET" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorReason).toBe("network");
    }
  });

  it("fail-open: returns errorReason=no_base_url when CF_WORKER_BASE_URL is unset", async () => {
    delete process.env.CF_WORKER_BASE_URL;
    const result = await callWorker("/__health", { method: "GET" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorReason).toBe("no_base_url");
      expect(result.durationMs).toBe(0);
    }
  });

  it("fail-closed: throws when CF_WORKER_BASE_URL is unset", async () => {
    delete process.env.CF_WORKER_BASE_URL;
    await expect(
      callWorker("/__health", { method: "GET" }, { onFailure: "fail-closed" }),
    ).rejects.toThrow(/CF_WORKER_BASE_URL is not configured/);
  });

  it("attaches Authorization: Bearer <secret> when CF_WORKER_SHARED_SECRET is set (HEL-427)", async () => {
    process.env.CF_WORKER_SHARED_SECRET = "shh";
    const spy = mockFetchResolving(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await callWorker("/rate-limit/consume", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const init = spy.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer shh");
    // The caller's existing headers are preserved.
    expect(headers.get("content-type")).toBe("application/json");
    delete process.env.CF_WORKER_SHARED_SECRET;
  });

  it("omits Authorization when CF_WORKER_SHARED_SECRET is unset (HEL-427)", async () => {
    delete process.env.CF_WORKER_SHARED_SECRET;
    const spy = mockFetchResolving(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    await callWorker("/rate-limit/consume", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const init = spy.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Headers;
    expect(headers.get("Authorization")).toBeNull();
  });
});
