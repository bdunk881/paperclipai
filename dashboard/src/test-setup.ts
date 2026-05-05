import "@testing-library/jest-dom";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

if (typeof window !== "undefined") {
  window.AbortController = globalThis.AbortController;
  window.AbortSignal = globalThis.AbortSignal;
}

afterEach(() => {
  cleanup();
});
