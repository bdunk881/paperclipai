import { describe, expect, it, vi } from "vitest";
import {
  runConnectAction,
  type ConnectActionIntegration,
  type LiveConnectorDescriptor,
  type RunConnectActionDeps,
} from "./integrationMarketplaceConnect";

function buildIntegration(
  overrides: Partial<ConnectActionIntegration> = {},
): ConnectActionIntegration {
  return {
    id: "slack",
    name: "Slack",
    premium: false,
    connected: false,
    ...overrides,
  };
}

function buildDeps(
  overrides: Partial<RunConnectActionDeps> = {},
  providerOverrides: Partial<LiveConnectorDescriptor> = {},
): RunConnectActionDeps {
  return {
    authorizedFetch: vi.fn(),
    loadStatuses: vi.fn().mockResolvedValue(undefined),
    providerKeyFor: (id: string) => (id === "slack" ? "slack" : null) as never,
    providerCatalog: {
      slack: {
        supportsOAuth: true,
        supportsApiKey: false,
        ...providerOverrides,
      } as LiveConnectorDescriptor,
    },
    redirect: vi.fn(),
    setBusyIntegrationId: vi.fn(),
    setConnectionError: vi.fn(),
    ...overrides,
  };
}

describe("runConnectAction", () => {
  // Branch 1
  it("returns early without state changes when premium + not connected", async () => {
    const deps = buildDeps();
    await runConnectAction(buildIntegration({ premium: true, connected: false }), deps);

    expect(deps.authorizedFetch).not.toHaveBeenCalled();
    expect(deps.setBusyIntegrationId).not.toHaveBeenCalled();
    expect(deps.setConnectionError).not.toHaveBeenCalled();
    expect(deps.redirect).not.toHaveBeenCalled();
  });

  // Branch 2
  it("returns early when integration has no live-connector provider", async () => {
    const deps = buildDeps({
      providerKeyFor: () => null,
    });
    await runConnectAction(buildIntegration({ id: "unknown" }), deps);

    expect(deps.authorizedFetch).not.toHaveBeenCalled();
    expect(deps.setBusyIntegrationId).not.toHaveBeenCalled();
  });

  // Branch 3
  it("disconnects + reloads when already connected", async () => {
    const authorizedFetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const loadStatuses = vi.fn().mockResolvedValue(undefined);
    const deps = buildDeps({ authorizedFetch, loadStatuses });

    await runConnectAction(buildIntegration({ connected: true }), deps);

    expect(authorizedFetch).toHaveBeenCalledWith(
      "/api/integrations/slack/disconnect",
      { method: "DELETE" },
    );
    expect(loadStatuses).toHaveBeenCalledTimes(1);
    expect(deps.setBusyIntegrationId).toHaveBeenCalledWith("slack");
    expect(deps.setBusyIntegrationId).toHaveBeenLastCalledWith(null); // finally
    expect(deps.setConnectionError).toHaveBeenCalledWith(null);
    expect(deps.redirect).not.toHaveBeenCalled();
  });

  // Branch 4 — OAuth happy path
  it("POSTs /connect and redirects via the OAuth URL", async () => {
    const authorizedFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ redirectUrl: "https://oauth.example.com/slack" }), {
        status: 201,
      }),
    );
    const deps = buildDeps({ authorizedFetch });

    await runConnectAction(buildIntegration(), deps);

    expect(authorizedFetch).toHaveBeenCalledWith(
      "/api/integrations/slack/connect",
      { method: "POST" },
    );
    expect(deps.redirect).toHaveBeenCalledWith("https://oauth.example.com/slack");
  });

  // Branch 4 (variant) — server returned authUrl instead of redirectUrl
  it("falls back to authUrl when redirectUrl is absent on the OAuth response", async () => {
    const authorizedFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ authUrl: "https://oauth.example.com/auth" }), { status: 201 }),
    );
    const deps = buildDeps({ authorizedFetch });

    await runConnectAction(buildIntegration(), deps);

    expect(deps.redirect).toHaveBeenCalledWith("https://oauth.example.com/auth");
  });

  // Branch 5 — API key path
  it("redirects to /integrations on the API-key provider path", async () => {
    const deps = buildDeps(
      { authorizedFetch: vi.fn() },
      { supportsOAuth: false, supportsApiKey: true },
    );

    await runConnectAction(buildIntegration(), deps);

    expect(deps.redirect).toHaveBeenCalledWith("/integrations");
    expect(deps.authorizedFetch).not.toHaveBeenCalled();
  });

  // Branch 6 — OAuth response missing both redirectUrl and authUrl
  it("sets connectionError when the OAuth /connect response has no redirect URL", async () => {
    const authorizedFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({}), { status: 201 }),
    );
    const deps = buildDeps({ authorizedFetch });

    await runConnectAction(buildIntegration(), deps);

    expect(deps.setConnectionError).toHaveBeenCalledWith(null); // initial reset
    expect(deps.setConnectionError).toHaveBeenLastCalledWith(
      "No OAuth redirect URL returned for Slack",
    );
    expect(deps.setBusyIntegrationId).toHaveBeenLastCalledWith(null); // finally cleanup
  });

  // Branch 7 — provider supports neither
  it("sets connectionError when provider supports neither OAuth nor API key", async () => {
    const deps = buildDeps({}, { supportsOAuth: false, supportsApiKey: false });

    await runConnectAction(buildIntegration(), deps);

    expect(deps.setConnectionError).toHaveBeenLastCalledWith(
      "Slack does not support a live connection flow yet",
    );
    expect(deps.setBusyIntegrationId).toHaveBeenLastCalledWith(null);
    expect(deps.redirect).not.toHaveBeenCalled();
  });

  // Network-error branch
  it("captures network errors via setConnectionError", async () => {
    const authorizedFetch = vi.fn().mockRejectedValue(new Error("network down"));
    const deps = buildDeps({ authorizedFetch });

    await runConnectAction(buildIntegration({ connected: true }), deps);

    expect(deps.setConnectionError).toHaveBeenLastCalledWith("network down");
    expect(deps.setBusyIntegrationId).toHaveBeenLastCalledWith(null);
  });

  // Non-Error throw → defaults to a friendly message.
  it("falls back to a generic message when the thrown value is not an Error", async () => {
    const authorizedFetch = vi.fn().mockImplementation(() => {
      throw "string-error";
    });
    const deps = buildDeps({ authorizedFetch });

    await runConnectAction(buildIntegration({ connected: true }), deps);

    expect(deps.setConnectionError).toHaveBeenLastCalledWith(
      "Failed to update Slack connection",
    );
  });
});
