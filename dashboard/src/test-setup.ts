import "@testing-library/jest-dom";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

vi.mock("./context/useWorkspace", () => ({
  useWorkspace: () => ({
    workspaces: [{ id: "ws-test", name: "Test Workspace" }],
    activeWorkspace: { id: "ws-test", name: "Test Workspace" },
    activeWorkspaceId: "ws-test",
    loading: false,
    creating: false,
    error: null,
    setActiveWorkspaceId: vi.fn(),
    refreshWorkspaces: vi.fn(async () => {}),
    createWorkspace: vi.fn(),
  }),
}));

if (typeof window !== "undefined") {
  window.AbortController = globalThis.AbortController;
  window.AbortSignal = globalThis.AbortSignal;
}

// Node 25's built-in Request (undici) validates that signal is an instance of
// undici's internal AbortSignal class. jsdom replaces globalThis.AbortController
// with its own implementation whose signals fail that instanceof check. Patch
// Request to fall back gracefully so routing tests can run in jsdom.
if (typeof globalThis.Request !== "undefined") {
  const OriginalRequest = globalThis.Request;
  const TestRequest = function (
    this: Request,
    input: RequestInfo | URL,
    init?: RequestInit,
  ) {
    if (init?.signal) {
      try {
        return new OriginalRequest(input, init);
      } catch (e) {
        if (e instanceof TypeError && String(e.message).includes("AbortSignal")) {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { signal: _s, ...rest } = init;
          return new OriginalRequest(input, rest);
        }
        throw e;
      }
    }
    return new OriginalRequest(input, init ?? undefined);
  } as unknown as typeof Request;
  Object.setPrototypeOf(TestRequest, OriginalRequest);
  Object.setPrototypeOf(TestRequest.prototype, OriginalRequest.prototype);
  Object.defineProperty(TestRequest, "name", { value: "Request" });
  globalThis.Request = TestRequest;
}

afterEach(() => {
  cleanup();
});
