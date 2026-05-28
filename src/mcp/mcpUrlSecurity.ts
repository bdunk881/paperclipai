import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

function isPrivateIpv4(ip: string): boolean {
  const octets = ip.split(".").map((segment) => Number(segment));
  if (octets.length !== 4 || octets.some((octet) => Number.isNaN(octet))) {
    return false;
  }

  const [a, b] = octets;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  return (
    normalized === "::1" ||
    normalized.startsWith("fe80:") ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd")
  );
}

function isPrivateOrInternalIp(ip: string): boolean {
  if (ip.includes(".")) {
    return isPrivateIpv4(ip);
  }
  return isPrivateIpv6(ip);
}

export interface OutboundUrlOpts {
  /** When true, only https:// is accepted. Defaults to false (http and https both allowed). */
  requireHttps?: boolean;
}

/**
 * Generic SSRF guard for outbound URLs (HEL-255). Blocks:
 *   - non-absolute / unparseable URLs
 *   - URLs carrying embedded credentials
 *   - localhost and the `.localhost` TLD
 *   - IP literals in private / link-local / loopback ranges
 *   - hostnames that resolve to any private / link-local / loopback IP
 *
 * Pass `requireHttps: true` to additionally reject `http://`. Returns the
 * normalized URL string on success.
 */
export async function assertSafeOutboundUrl(
  rawUrl: string,
  opts: OutboundUrlOpts = {},
): Promise<string> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    throw new Error("url must be a valid absolute URL");
  }

  if (opts.requireHttps) {
    if (parsedUrl.protocol !== "https:") {
      throw new Error("url must use https://");
    }
  } else if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    throw new Error("url must use http:// or https://");
  }

  if (parsedUrl.username || parsedUrl.password) {
    throw new Error("url must not include embedded credentials");
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("url hostname is not allowed");
  }

  if (isIP(hostname) && isPrivateOrInternalIp(hostname)) {
    throw new Error("url resolves to a private or internal IP address");
  }

  const resolved = await lookup(hostname, { all: true, verbatim: true });
  if (resolved.length === 0) {
    throw new Error("url hostname could not be resolved");
  }

  for (const entry of resolved) {
    if (isPrivateOrInternalIp(entry.address)) {
      throw new Error("url resolves to a private or internal IP address");
    }
  }

  return parsedUrl.toString();
}

/**
 * Strict guard for admin-registered MCP server URLs. Same SSRF checks
 * plus an https-only requirement (MCP carries auth headers — cleartext
 * isn't acceptable). Existing callers in `src/mcp/mcpRoutes.ts` rely on
 * this signature.
 */
export async function assertSafeMcpUrl(rawUrl: string): Promise<string> {
  return assertSafeOutboundUrl(rawUrl, { requireHttps: true });
}
