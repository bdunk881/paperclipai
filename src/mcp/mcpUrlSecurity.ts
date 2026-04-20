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

export async function assertSafeMcpUrl(rawUrl: string): Promise<string> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    throw new Error("url must be a valid absolute URL");
  }

  if (parsedUrl.protocol !== "https:") {
    throw new Error("url must use https://");
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
