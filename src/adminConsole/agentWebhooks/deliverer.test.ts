import {
  assertSafeWebhookUrl,
  deliver,
  isPrivateIPv4,
  WebhookPrivateHostError,
  WebhookSchemeError,
} from "./deliverer";

describe("isPrivateIPv4", () => {
  it("flags RFC1918 ranges", () => {
    expect(isPrivateIPv4("10.0.0.1")).toBe(true);
    expect(isPrivateIPv4("172.16.5.5")).toBe(true);
    expect(isPrivateIPv4("172.31.255.254")).toBe(true);
    expect(isPrivateIPv4("192.168.1.1")).toBe(true);
  });
  it("flags loopback + link-local + CGNAT", () => {
    expect(isPrivateIPv4("127.0.0.1")).toBe(true);
    expect(isPrivateIPv4("169.254.169.254")).toBe(true);
    expect(isPrivateIPv4("100.64.0.1")).toBe(true);
  });
  it("permits public IPs", () => {
    expect(isPrivateIPv4("8.8.8.8")).toBe(false);
    expect(isPrivateIPv4("1.1.1.1")).toBe(false);
    expect(isPrivateIPv4("172.32.0.1")).toBe(false);
  });
});

describe("assertSafeWebhookUrl", () => {
  it("rejects non-https", async () => {
    await expect(
      assertSafeWebhookUrl("http://example.com", async () => [{ address: "8.8.8.8" }]),
    ).rejects.toBeInstanceOf(WebhookSchemeError);
  });
  it("rejects when DNS resolves to a private IP", async () => {
    await expect(
      assertSafeWebhookUrl("https://internal.test", async () => [{ address: "192.168.1.1" }]),
    ).rejects.toBeInstanceOf(WebhookPrivateHostError);
  });
  it("rejects when DNS resolves to loopback IPv6", async () => {
    await expect(
      assertSafeWebhookUrl("https://example.test", async () => [{ address: "::1" }]),
    ).rejects.toBeInstanceOf(WebhookPrivateHostError);
  });
  it("rejects when DNS lookup fails entirely", async () => {
    await expect(
      assertSafeWebhookUrl("https://nx.test", async () => []),
    ).rejects.toBeInstanceOf(WebhookPrivateHostError);
  });
  it("allows public IPv4 resolution", async () => {
    await expect(
      assertSafeWebhookUrl("https://hooks.slack.com", async () => [{ address: "44.230.45.91" }]),
    ).resolves.toBeUndefined();
  });
});

describe("deliver", () => {
  it("returns sent + http status + excerpt on 2xx", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "{\"ok\":true}",
    });
    const result = await deliver({
      webhookId: "wh-1",
      url: "https://hooks.slack.com/services/T/B/X",
      hmacSecret: "shh",
      customHeaders: null,
      body: { kind: "test" },
      fetchImpl: fetchMock as unknown as typeof fetch,
      dnsLookupImpl: async () => [{ address: "44.230.45.91" }],
    });
    expect(result.status).toBe("sent");
    expect(result.httpStatus).toBe(200);
    expect(result.responseExcerpt).toContain("ok");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect((init as { headers: Record<string, string> }).headers["X-AutoFlow-Webhook-Id"]).toBe(
      "wh-1",
    );
    expect(
      (init as { headers: Record<string, string> }).headers["X-AutoFlow-Signature"],
    ).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it("rejects private URLs without calling fetch", async () => {
    const fetchMock = jest.fn();
    const result = await deliver({
      webhookId: "wh-1",
      url: "https://internal.test",
      hmacSecret: null,
      customHeaders: null,
      body: {},
      fetchImpl: fetchMock as unknown as typeof fetch,
      dnsLookupImpl: async () => [{ address: "10.0.0.1" }],
    });
    expect(result.status).toBe("failed");
    expect(result.error).toBe("webhook_url_resolves_to_private_host");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats non-2xx as failed and stores excerpt", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "boom",
    });
    const result = await deliver({
      webhookId: "wh-1",
      url: "https://hooks.slack.com/x",
      hmacSecret: null,
      customHeaders: null,
      body: {},
      fetchImpl: fetchMock as unknown as typeof fetch,
      dnsLookupImpl: async () => [{ address: "8.8.8.8" }],
    });
    expect(result.status).toBe("failed");
    expect(result.httpStatus).toBe(500);
    expect(result.responseExcerpt).toBe("boom");
    expect(result.error).toBe("http_500");
  });

  it("omits HMAC header when no secret configured", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "",
    });
    await deliver({
      webhookId: "wh-2",
      url: "https://hooks.slack.com/x",
      hmacSecret: null,
      customHeaders: { Authorization: "Bearer abc" },
      body: {},
      fetchImpl: fetchMock as unknown as typeof fetch,
      dnsLookupImpl: async () => [{ address: "8.8.8.8" }],
    });
    const [, init] = fetchMock.mock.calls[0];
    const headers = (init as { headers: Record<string, string> }).headers;
    expect(headers["X-AutoFlow-Signature"]).toBeUndefined();
    expect(headers["Authorization"]).toBe("Bearer abc");
  });
});
