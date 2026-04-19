import { createHmac, timingSafeEqual } from "crypto";
import { ConnectorError } from "./types";

const FIVE_MINUTES_SECONDS = 60 * 5;
const replayCache = new Set<string>();

export function verifySlackSignature(params: {
  rawBody: Buffer;
  signatureHeader?: string;
  timestampHeader?: string;
  signingSecret: string;
}): void {
  const signature = params.signatureHeader;
  const timestamp = params.timestampHeader;

  if (!signature || !timestamp) {
    throw new ConnectorError("auth", "Missing Slack signature headers", 401);
  }

  const tsNumber = Number(timestamp);
  if (!Number.isFinite(tsNumber)) {
    throw new ConnectorError("auth", "Invalid Slack timestamp header", 401);
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - tsNumber) > FIVE_MINUTES_SECONDS) {
    throw new ConnectorError("auth", "Slack request timestamp is outside replay window", 401);
  }

  const replayKey = `${timestamp}:${signature}`;
  if (replayCache.has(replayKey)) {
    throw new ConnectorError("auth", "Slack webhook replay detected", 409);
  }

  const baseString = `v0:${timestamp}:${params.rawBody.toString("utf8")}`;
  const digest = createHmac("sha256", params.signingSecret)
    .update(baseString)
    .digest("hex");
  const expected = `v0=${digest}`;

  const a = Buffer.from(signature, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new ConnectorError("auth", "Invalid Slack webhook signature", 401);
  }

  replayCache.add(replayKey);
  setTimeout(() => replayCache.delete(replayKey), FIVE_MINUTES_SECONDS * 1000);
}

export function clearSlackWebhookReplayCache(): void {
  replayCache.clear();
}
