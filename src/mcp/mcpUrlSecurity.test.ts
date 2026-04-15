import { lookup } from "node:dns/promises";
import { assertSafeMcpUrl } from "./mcpUrlSecurity";

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
