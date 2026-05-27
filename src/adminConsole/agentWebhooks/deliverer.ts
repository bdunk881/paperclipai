/**
 * Outbound POST deliverer for Ask-an-Agent webhooks (HEL infra PR #2).
 *
 * Responsibilities:
 *   - Sandboxed scheme + host (https only; reject private/loopback ranges)
 *   - Apply optional custom headers + HMAC signature
 *   - Bounded timeout, no redirect following, response excerpt for storage
 *
 * The caller (routes.ts) is responsible for:
 *   - Audit-row written BEFORE calling this
 *   - Rate-limit consumed BEFORE calling this
 *   - The admin_agent_asks row updated AFTER this returns
 */

import { lookup as dnsLookup } from "dns/promises";
import { buildSignedHeaders } from "./signer";

export interface DeliveryResult {
  status: "sent" | "failed";
  httpStatus: number | null;
  responseExcerpt: string | null;
  error: string | null;
}

export interface DeliveryInput {
  webhookId: string;
  url: string;
  hmacSecret: string | null;
  customHeaders: Record<string, string> | null;
  body: unknown;
  timeoutMs?: number;
  /** Override for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Override for tests; defaults to dns/promises.lookup. */
  dnsLookupImpl?: (hostname: string) => Promise<{ address: string }[]>;
}

const PRIVATE_CIDR_RANGES: Array<[number, number]> = [
  [ipv4ToInt("10.0.0.0"), ipv4ToInt("10.255.255.255")],
  [ipv4ToInt("172.16.0.0"), ipv4ToInt("172.31.255.255")],
  [ipv4ToInt("192.168.0.0"), ipv4ToInt("192.168.255.255")],
  [ipv4ToInt("127.0.0.0"), ipv4ToInt("127.255.255.255")],
  [ipv4ToInt("169.254.0.0"), ipv4ToInt("169.254.255.255")],
  [ipv4ToInt("100.64.0.0"), ipv4ToInt("100.127.255.255")],
  [ipv4ToInt("0.0.0.0"), ipv4ToInt("0.255.255.255")],
];

function ipv4ToInt(ip: string): number {
  return ip
    .split(".")
    .reduce((acc, octet) => (acc << 8) + Number.parseInt(octet, 10), 0) >>> 0;
}

export function isPrivateIPv4(addr: string): boolean {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(addr)) return false;
  const n = ipv4ToInt(addr);
  return PRIVATE_CIDR_RANGES.some(([lo, hi]) => n >= lo && n <= hi);
}

function isPrivateIPv6(addr: string): boolean {
  const lower = addr.toLowerCase();
  return (
    lower === "::1" ||
    lower.startsWith("fc") || // fc00::/7 ULA
    lower.startsWith("fd") ||
    lower.startsWith("fe80") || // link-local
    lower === "::"
  );
}

export class WebhookSchemeError extends Error {
  constructor() {
    super("webhook_url_scheme_must_be_https");
  }
}

export class WebhookPrivateHostError extends Error {
  constructor(public readonly host: string) {
    super("webhook_url_resolves_to_private_host");
  }
}

/**
 * Validates a webhook URL: HTTPS only, host must not resolve to any
 * private / loopback / link-local address. Throws WebhookSchemeError or
 * WebhookPrivateHostError; callers translate to HTTP 400.
 */
export async function assertSafeWebhookUrl(
  url: string,
  dnsLookupImpl?: DeliveryInput["dnsLookupImpl"],
): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new WebhookSchemeError();
  }
  if (parsed.protocol !== "https:") throw new WebhookSchemeError();
  const lookup = dnsLookupImpl ?? (async (h: string) => {
    const results = await dnsLookup(h, { all: true });
    return results.map((r) => ({ address: r.address }));
  });
  const addrs = await lookup(parsed.hostname).catch(() => [] as { address: string }[]);
  if (addrs.length === 0) throw new WebhookPrivateHostError(parsed.hostname);
  for (const { address } of addrs) {
    if (address.includes(":")) {
      if (isPrivateIPv6(address)) throw new WebhookPrivateHostError(parsed.hostname);
    } else if (isPrivateIPv4(address)) {
      throw new WebhookPrivateHostError(parsed.hostname);
    }
  }
}

export async function deliver(input: DeliveryInput): Promise<DeliveryResult> {
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  const timeoutMs = input.timeoutMs ?? 15_000;

  try {
    await assertSafeWebhookUrl(input.url, input.dnsLookupImpl);
  } catch (err) {
    return {
      status: "failed",
      httpStatus: null,
      responseExcerpt: null,
      error: err instanceof Error ? err.message : "url_validation_failed",
    };
  }

  const rawBody = JSON.stringify(input.body);
  const signedHeaders = buildSignedHeaders({
    webhookId: input.webhookId,
    secret: input.hmacSecret,
    rawBody,
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "AutoFlow-AdminConsole-Agent-Webhook/1",
    ...signedHeaders,
    ...(input.customHeaders ?? {}),
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(input.url, {
      method: "POST",
      headers,
      body: rawBody,
      redirect: "manual",
      signal: controller.signal,
    });
    const text = await res.text().catch(() => "");
    return {
      status: res.ok ? "sent" : "failed",
      httpStatus: res.status,
      responseExcerpt: text.slice(0, 500),
      error: res.ok ? null : `http_${res.status}`,
    };
  } catch (err) {
    return {
      status: "failed",
      httpStatus: null,
      responseExcerpt: null,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timeout);
  }
}
