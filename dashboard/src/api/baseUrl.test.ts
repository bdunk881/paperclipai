import { afterEach, describe, expect, it, vi } from "vitest";

import { getApiBasePath, getConfiguredApiOrigin } from "./baseUrl";

describe("baseUrl host fallback", () => {
  const originalLocation = window.location;

  afterEach(() => {
    vi.unstubAllEnvs();
    Object.defineProperty(window, "location", {
      value: originalLocation,
      configurable: true,
    });
  });

  it("uses the production backend origin on the production dashboard host", () => {
    Object.defineProperty(window, "location", {
      value: { hostname: "app.helloautoflow.com" },
      configurable: true,
    });

    expect(getConfiguredApiOrigin()).toBe("https://api.helloautoflow.com");
    expect(getApiBasePath()).toBe("https://api.helloautoflow.com/api");
  });

  it("uses the staging backend origin on the staging dashboard host", () => {
    Object.defineProperty(window, "location", {
      value: { hostname: "staging.app.helloautoflow.com" },
      configurable: true,
    });

    expect(getConfiguredApiOrigin()).toBe("https://staging-api.helloautoflow.com");
    expect(getApiBasePath()).toBe("https://staging-api.helloautoflow.com/api");
  });

  it("uses the staging backend origin on Vercel preview hosts", () => {
    Object.defineProperty(window, "location", {
      value: { hostname: "dashboard-r6ww4hpqu-brad-duncans-projects.vercel.app" },
      configurable: true,
    });

    expect(getConfiguredApiOrigin()).toBe("https://staging-api.helloautoflow.com");
    expect(getApiBasePath()).toBe("https://staging-api.helloautoflow.com/api");
  });

  it("prefers the hosted origin over an explicit environment origin", () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://custom-api.example.com/api");
    Object.defineProperty(window, "location", {
      value: { hostname: "staging.app.helloautoflow.com" },
      configurable: true,
    });

    expect(getConfiguredApiOrigin()).toBe("https://staging-api.helloautoflow.com");
    expect(getApiBasePath()).toBe("https://staging-api.helloautoflow.com/api");
  });

  it("uses the explicit environment origin when the host is not recognized", () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://custom-api.example.com/api");
    Object.defineProperty(window, "location", {
      value: { hostname: "localhost" },
      configurable: true,
    });

    expect(getConfiguredApiOrigin()).toBe("https://custom-api.example.com");
    expect(getApiBasePath()).toBe("https://custom-api.example.com/api");
  });
});
