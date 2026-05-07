import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { onRequestOptions, onRequestPost } from "./[[path]]";

type Env = {
  AUTH_NATIVE_AUTH_PROXY_ALLOWED_ORIGINS?: string;
  AZURE_CIAM_TENANT_SUBDOMAIN?: string;
  AZURE_CIAM_TENANT_ID?: string;
};

function makeContext(
  request: Request,
  path: string,
  env: Env = {}
): {
  env: Env;
  params: { path: string[] };
  request: Request;
} {
  return {
    env,
    params: { path: path.split("/") },
    request,
  };
}

describe("dashboard native auth function", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("answers signup-start CORS preflight for the production app origin", async () => {
    const response = await onRequestOptions(
      makeContext(
        new Request("https://app.helloautoflow.com/api/auth/native/signup/v1.0/start", {
          method: "OPTIONS",
          headers: {
            Origin: "https://app.helloautoflow.com",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
          },
        }),
        "signup/v1.0/start",
        {
          AUTH_NATIVE_AUTH_PROXY_ALLOWED_ORIGINS: "https://app.helloautoflow.com",
        }
      )
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://app.helloautoflow.com");
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe("POST, OPTIONS");
    expect(response.headers.get("Access-Control-Allow-Headers")).toBe("content-type");
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns CORS headers on proxied POST responses for allowed origins", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ continuation_token: "signup-123" }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      })
    );

    const response = await onRequestPost(
      makeContext(
        new Request("https://app.helloautoflow.com/api/auth/native/signup/v1.0/start", {
          method: "POST",
          headers: {
            Origin: "https://app.helloautoflow.com",
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            username: "alex@example.com",
            challenge_type: "oob password redirect",
          }),
        }),
        "signup/v1.0/start",
        {
          AUTH_NATIVE_AUTH_PROXY_ALLOWED_ORIGINS: "https://app.helloautoflow.com",
          AZURE_CIAM_TENANT_SUBDOMAIN: "autoflowciam",
          AZURE_CIAM_TENANT_ID: "tenant-guid",
        }
      )
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ continuation_token: "signup-123" });
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://app.helloautoflow.com");
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe("POST, OPTIONS");
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    expect(global.fetch).toHaveBeenCalledWith(
      "https://autoflowciam.ciamlogin.com/tenant-guid/signup/v1.0/start",
      expect.objectContaining({
        method: "POST",
        body: "username=alex%40example.com&challenge_type=oob+password+redirect",
      })
    );
  });

  it("rejects browser POST requests from origins outside the native auth allowlist", async () => {
    const response = await onRequestPost(
      makeContext(
        new Request("https://app.helloautoflow.com/api/auth/native/signup/v1.0/start", {
          method: "POST",
          headers: {
            Origin: "https://evil.example",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ username: "alex@example.com" }),
        }),
        "signup/v1.0/start",
        {
          AUTH_NATIVE_AUTH_PROXY_ALLOWED_ORIGINS: "https://app.helloautoflow.com",
        }
      )
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Origin is not allowed for native auth proxy requests.",
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
