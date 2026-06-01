/**
 * Unit tests for the generic catalog connection + OAuth helpers.
 * Mocks global fetch (trackedFetch wraps it) to assert URL / method / body.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fetchIntegrationCatalog,
  listCatalogConnections,
  createCatalogConnection,
  deleteCatalogConnection,
  startCatalogOAuth,
} from "./integrationCatalogApi";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("integrationCatalogApi", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches the catalog without auth", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ catalog: [], categories: [], total: 0 }));
    await fetchIntegrationCatalog();
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/integrations/catalog");
  });

  it("lists stored connections with a bearer token", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ connections: [{ id: "c1", integrationSlug: "sendgrid" }] }));
    const conns = await listCatalogConnections("tok-1");
    expect(conns).toHaveLength(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/integrations/connections");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer tok-1" });
  });

  it("creates an API-key connection via POST /connections", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "c2", integrationSlug: "sendgrid" }, 201));
    await createCatalogConnection("tok-1", {
      integrationSlug: "sendgrid",
      label: "SendGrid",
      credentials: { token: "SG.test" },
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/integrations/connections");
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      integrationSlug: "sendgrid",
      label: "SendGrid",
      credentials: { token: "SG.test" },
    });
  });

  it("deletes a connection by id and tolerates 404", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));
    await expect(deleteCatalogConnection("tok-1", "c3")).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/integrations/connections/c3");
    expect((init as RequestInit).method).toBe("DELETE");
  });

  it("starts OAuth, forwarding clientId/clientSecret and a callback redirectUri", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ authorizationUrl: "https://provider/oauth?x=1" }));
    const url = await startCatalogOAuth("tok-1", "salesforce", {
      clientId: "cid",
      clientSecret: "secret",
      instanceDomain: "mycompany",
    });
    expect(url).toBe("https://provider/oauth?x=1");
    const [requestUrl] = fetchMock.mock.calls[0];
    const parsed = new URL(String(requestUrl), "http://localhost");
    expect(parsed.pathname).toContain("/integrations/oauth2/salesforce/authorize");
    expect(parsed.searchParams.get("clientId")).toBe("cid");
    expect(parsed.searchParams.get("clientSecret")).toBe("secret");
    expect(parsed.searchParams.get("instanceDomain")).toBe("mycompany");
    expect(parsed.searchParams.get("redirectUri")).toContain(
      "/api/integrations/oauth2/salesforce/callback",
    );
  });

  it("throws when OAuth authorize returns no URL", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    await expect(startCatalogOAuth("tok-1", "salesforce", { clientId: "cid" })).rejects.toThrow();
  });
});
