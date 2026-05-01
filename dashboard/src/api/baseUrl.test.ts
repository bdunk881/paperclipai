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

  it("prefers the explicit environment origin over host fallbacks", () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://custom-api.example.com/api");
    Object.defineProperty(window, "location", {
      value: { hostname: "staging.app.helloautoflow.com" },
      configurable: true,
    });

    expect(getConfiguredApiOrigin()).toBe("https://custom-api.example.com");
    expect(getApiBasePath()).toBe("https://custom-api.example.com/api");
  });
});
