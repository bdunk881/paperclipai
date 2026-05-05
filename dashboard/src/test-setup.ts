import "@testing-library/jest-dom";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

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
