/**
 * HMAC-SHA256 signer for outbound Ask-an-Agent webhooks (HEL infra PR #2).
 *
 * Follows the Slack incoming-webhook convention so receivers can verify
 * with a one-line HMAC check:
 *
 *   HMAC-SHA256(secret, `${timestamp}.${rawBody}`)
 *
 * Sent as `X-AutoFlow-Signature: sha256=<hex>` alongside
 * `X-AutoFlow-Webhook-Id` and `X-AutoFlow-Timestamp` so the receiver can
 * reject replays past their own freshness window.
 */

import { createHmac } from "crypto";

export interface SignedRequestHeaders {
  "X-AutoFlow-Webhook-Id": string;
  "X-AutoFlow-Timestamp": string;
  "X-AutoFlow-Signature"?: string;
}

export function buildSignedHeaders(args: {
  webhookId: string;
  secret?: string | null;
  rawBody: string;
  timestamp?: number;
}): SignedRequestHeaders {
  const timestamp = String(args.timestamp ?? Math.floor(Date.now() / 1000));
  const headers: SignedRequestHeaders = {
    "X-AutoFlow-Webhook-Id": args.webhookId,
    "X-AutoFlow-Timestamp": timestamp,
  };
  if (args.secret) {
    const mac = createHmac("sha256", args.secret);
    mac.update(`${timestamp}.${args.rawBody}`);
    headers["X-AutoFlow-Signature"] = `sha256=${mac.digest("hex")}`;
  }
  return headers;
}
