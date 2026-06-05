/**
 * AWS SNS message signature verification (HEL-361) for the SES notifications
 * webhook. SNS cryptographically signs each message; we MUST verify before
 * acting on a bounce/complaint so a forged POST can't poison the suppression
 * list.
 *
 * Algorithm (per AWS docs): build a canonical string-to-sign from a fixed set
 * of fields in the documented order, fetch the signing certificate (only from
 * an `sns.<region>.amazonaws.com` HTTPS host — SSRF guard), and RSA-verify the
 * base64 signature. `SignatureVersion` 1 → SHA1, 2 → SHA256. No SDK dependency.
 */

import { createVerify } from "node:crypto";

export interface SnsMessage {
  Type: string;
  MessageId?: string;
  TopicArn?: string;
  Message?: string;
  Timestamp?: string;
  Subject?: string;
  Token?: string;
  SubscribeURL?: string;
  Signature?: string;
  SignatureVersion?: string;
  SigningCertURL?: string;
  [key: string]: unknown;
}

// Fields included in the string-to-sign, in the exact order AWS specifies.
const SIGNABLE_FIELDS: Record<string, string[]> = {
  Notification: ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"],
  SubscriptionConfirmation: [
    "Message",
    "MessageId",
    "SubscribeURL",
    "Timestamp",
    "Token",
    "TopicArn",
    "Type",
  ],
  UnsubscribeConfirmation: [
    "Message",
    "MessageId",
    "SubscribeURL",
    "Timestamp",
    "Token",
    "TopicArn",
    "Type",
  ],
};

const SNS_HOST = /^sns\.[a-z0-9-]+\.amazonaws\.com$/;

export type CertFetcher = (url: string) => Promise<string>;

const certCache = new Map<string, string>();

/** True only for an `https://sns.<region>.amazonaws.com/...` URL (SSRF guard). */
export function isSnsUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && SNS_HOST.test(parsed.hostname);
  } catch {
    return false;
  }
}

const defaultCertFetcher: CertFetcher = async (url) => {
  const cached = certCache.get(url);
  if (cached) {
    return cached;
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`SNS cert fetch failed (${response.status})`);
  }
  const pem = await response.text();
  certCache.set(url, pem);
  return pem;
};

function buildStringToSign(message: SnsMessage): string | null {
  const fields = SIGNABLE_FIELDS[message.Type];
  if (!fields) {
    return null;
  }
  let out = "";
  for (const field of fields) {
    const value = message[field];
    if (value === undefined || value === null) {
      continue; // Subject is optional and omitted from the string-to-sign when absent
    }
    out += `${field}\n${String(value)}\n`;
  }
  return out;
}

/**
 * Verify an SNS message signature. Returns false on any problem (unknown type,
 * non-SNS cert URL, fetch failure, signature mismatch) — never throws.
 */
export async function verifySnsMessage(
  message: SnsMessage,
  opts: { certFetcher?: CertFetcher } = {},
): Promise<boolean> {
  try {
    if (!message.Signature || !message.SigningCertURL) {
      return false;
    }
    if (!isSnsUrl(message.SigningCertURL)) {
      return false;
    }
    const stringToSign = buildStringToSign(message);
    if (!stringToSign) {
      return false;
    }

    const pem = await (opts.certFetcher ?? defaultCertFetcher)(message.SigningCertURL);
    const algorithm = message.SignatureVersion === "2" ? "RSA-SHA256" : "RSA-SHA1";
    const verifier = createVerify(algorithm);
    verifier.update(stringToSign, "utf8");
    return verifier.verify(pem, message.Signature, "base64");
  } catch {
    return false;
  }
}
