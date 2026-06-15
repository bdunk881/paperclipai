import { afterEach, describe, expect, it, vi } from "vitest";

import { getWorkflowDocWorkerOrigin } from "./baseUrl";
import { workflowYDocWebSocketUrl } from "./workflowsApi";

describe("getWorkflowDocWorkerOrigin (HEL-803 B6)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is empty by default (the doc stays on the in-process API room)", () => {
    expect(getWorkflowDocWorkerOrigin()).toBe("");
  });

  it("returns the configured Worker origin when the cutover env is set", () => {
    vi.stubEnv("VITE_WF_DOC_WS_ORIGIN", "https://worker.helloautoflow.com");
    expect(getWorkflowDocWorkerOrigin()).toBe("https://worker.helloautoflow.com");
  });

  it("trims trailing slashes", () => {
    vi.stubEnv("VITE_WF_DOC_WS_ORIGIN", "https://autoflow-api-worker-dev.example.workers.dev/");
    expect(getWorkflowDocWorkerOrigin()).toBe(
      "https://autoflow-api-worker-dev.example.workers.dev",
    );
  });
});

describe("workflowYDocWebSocketUrl (HEL-803 B6)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("defaults to the in-process API room (/api/workflows) over ws/wss", () => {
    const url = workflowYDocWebSocketUrl();
    expect(url).toMatch(/^wss?:\/\//);
    expect(url.endsWith("/api/workflows")).toBe(true);
  });

  it("points at the Worker origin (/workflows, no /api) when cut over", () => {
    vi.stubEnv("VITE_WF_DOC_WS_ORIGIN", "https://worker.helloautoflow.com");
    expect(workflowYDocWebSocketUrl()).toBe("wss://worker.helloautoflow.com/workflows");
  });
});
