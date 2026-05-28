import { lookup } from "node:dns/promises";
import { assertSafeMcpUrl, assertSafeOutboundUrl } from "./mcpUrlSecurity";

jest.mock("node:dns/promises", () => ({
  lookup: jest.fn(),
}));

const lookupMock = lookup as jest.MockedFunction<typeof lookup>;

describe("assertSafeMcpUrl", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("rejects non-https urls", async () => {
    await expect(assertSafeMcpUrl("http://example.com/mcp")).rejects.toThrow(/https/i);
  });

  it("rejects localhost hostnames", async () => {
    await expect(assertSafeMcpUrl("https://localhost:8787")).rejects.toThrow(/hostname is not allowed/i);
  });

  it("rejects private IPv4 literals", async () => {
    await expect(assertSafeMcpUrl("https://127.0.0.1:8787")).rejects.toThrow(/private or internal/i);
  });

  it("rejects hostnames that resolve to private ranges", async () => {
    lookupMock.mockResolvedValue(
      [{ address: "10.0.4.5", family: 4 }] as unknown as Awaited<ReturnType<typeof lookup>>
    );
    await expect(assertSafeMcpUrl("https://mcp.example.com")).rejects.toThrow(/private or internal/i);
  });

  it("accepts public https hostnames", async () => {
    lookupMock.mockResolvedValue(
      [{ address: "93.184.216.34", family: 4 }] as unknown as Awaited<ReturnType<typeof lookup>>
    );
    await expect(assertSafeMcpUrl("https://mcp.example.com/tools")).resolves.toBe(
      "https://mcp.example.com/tools"
    );
  });
});

describe("assertSafeOutboundUrl (HEL-255 — workflow webhook.send + mcp step guard)", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("accepts http urls to public hostnames (webhook.send may not be TLS)", async () => {
    lookupMock.mockResolvedValue(
      [{ address: "93.184.216.34", family: 4 }] as unknown as Awaited<ReturnType<typeof lookup>>
    );
    await expect(assertSafeOutboundUrl("http://hook.example.com/in")).resolves.toBe(
      "http://hook.example.com/in"
    );
  });

  it("accepts https urls to public hostnames", async () => {
    lookupMock.mockResolvedValue(
      [{ address: "93.184.216.34", family: 4 }] as unknown as Awaited<ReturnType<typeof lookup>>
    );
    await expect(assertSafeOutboundUrl("https://hook.example.com/in")).resolves.toBe(
      "https://hook.example.com/in"
    );
  });

  it("rejects http://localhost", async () => {
    await expect(assertSafeOutboundUrl("http://localhost:3000/api")).rejects.toThrow(
      /hostname is not allowed/i,
    );
  });

  it("rejects http://127.0.0.1 (loopback literal)", async () => {
    await expect(assertSafeOutboundUrl("http://127.0.0.1:3000/api")).rejects.toThrow(
      /private or internal/i,
    );
  });

  it("rejects http://169.254.169.254 (cloud metadata endpoint)", async () => {
    await expect(
      assertSafeOutboundUrl("http://169.254.169.254/latest/meta-data/"),
    ).rejects.toThrow(/private or internal/i);
  });

  it("rejects hostnames that resolve to RFC-1918 private ranges", async () => {
    lookupMock.mockResolvedValue(
      [{ address: "10.0.4.5", family: 4 }] as unknown as Awaited<ReturnType<typeof lookup>>
    );
    await expect(assertSafeOutboundUrl("http://internal.example.com")).rejects.toThrow(
      /private or internal/i,
    );
  });

  it("rejects ftp:// and other non-http(s) schemes", async () => {
    await expect(assertSafeOutboundUrl("ftp://example.com/file")).rejects.toThrow(
      /http:\/\/ or https:\/\//i,
    );
  });

  it("rejects urls carrying embedded credentials", async () => {
    await expect(
      assertSafeOutboundUrl("http://user:pass@example.com/path"),
    ).rejects.toThrow(/embedded credentials/i);
  });

  it("requireHttps: true rejects http:// (mirrors assertSafeMcpUrl)", async () => {
    await expect(
      assertSafeOutboundUrl("http://example.com", { requireHttps: true }),
    ).rejects.toThrow(/https/i);
  });
});
