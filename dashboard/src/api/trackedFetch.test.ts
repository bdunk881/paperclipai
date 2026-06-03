import { describe, it, expect, vi, afterEach } from "vitest";

// trackedFetch logs metrics/errors to Sentry in its finally block; stub the
// module so the test doesn't depend on a real Sentry client.
vi.mock("@sentry/react", () => ({
  metrics: { count: vi.fn(), distribution: vi.fn() },
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
  captureException: vi.fn(),
}));

import { trackedFetch } from "./trackedFetch";
import {
  STEP_UP_REQUIRED_EVENT,
  emitStepUpSatisfied,
  emitStepUpCancelled,
} from "../auth/stepUpEvents";

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

describe("trackedFetch step-up self-heal (HEL-441)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stepUp401(): Response {
    return new Response(
      JSON.stringify({ error: "mfa_step_up_required", reason: "aal_below_two" }),
      { status: 401, headers: { "content-type": "application/json" } },
    );
  }

  it("opens step-up on a mfa_step_up_required 401 and retries once after satisfaction", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(stepUp401())
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    let opened = false;
    const onReq = () => {
      opened = true;
      emitStepUpSatisfied(); // simulate the user completing the passkey challenge
    };
    window.addEventListener(STEP_UP_REQUIRED_EVENT, onReq);
    try {
      const res = await trackedFetch("https://api.example.com/x", { method: "POST" });
      expect(opened).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(res.status).toBe(200);
    } finally {
      window.removeEventListener(STEP_UP_REQUIRED_EVENT, onReq);
    }
  });

  it("surfaces the original 401 when the user cancels step-up (no retry)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(stepUp401());
    vi.stubGlobal("fetch", fetchMock);

    const onReq = () => emitStepUpCancelled();
    window.addEventListener(STEP_UP_REQUIRED_EVENT, onReq);
    try {
      const res = await trackedFetch("https://api.example.com/x", { method: "POST" });
      expect(res.status).toBe(401);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(STEP_UP_REQUIRED_EVENT, onReq);
    }
  });

  it("does not trigger step-up for a non-step-up 401", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Authentication required" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    let opened = false;
    const onReq = () => {
      opened = true;
    };
    window.addEventListener(STEP_UP_REQUIRED_EVENT, onReq);
    try {
      const res = await trackedFetch("https://api.example.com/x");
      expect(opened).toBe(false);
      expect(res.status).toBe(401);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(STEP_UP_REQUIRED_EVENT, onReq);
    }
  });

  it("retries at most once — a still-step-up 401 on the retry is surfaced, not looped", async () => {
    const fetchMock = vi.fn().mockResolvedValue(stepUp401());
    vi.stubGlobal("fetch", fetchMock);

    let emits = 0;
    const onReq = () => {
      emits += 1;
      emitStepUpSatisfied();
    };
    window.addEventListener(STEP_UP_REQUIRED_EVENT, onReq);
    try {
      const res = await trackedFetch("https://api.example.com/x", { method: "POST" });
      expect(res.status).toBe(401);
      expect(emits).toBe(1); // modal opened once; the retry carries _isStepUpRetry and doesn't re-open
      expect(fetchMock).toHaveBeenCalledTimes(2); // original + exactly one retry
    } finally {
      window.removeEventListener(STEP_UP_REQUIRED_EVENT, onReq);
    }
  });
});
