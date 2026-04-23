import { createHash } from "crypto";
import jwt, { JwtHeader, JwtPayload } from "jsonwebtoken";
import jwksRsa from "jwks-rsa";
import { ConnectorError, GmailWebhookNotification } from "./types";

const DEFAULT_TOLERANCE_SECONDS = 300;
const GOOGLE_JWKS_URI = process.env.GMAIL_PUBSUB_JWKS_URI ?? "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS: [string, ...string[]] = ["accounts.google.com", "https://accounts.google.com"];
const replayCache = new Map<string, number>();

const jwksClient = jwksRsa({
  jwksUri: GOOGLE_JWKS_URI,
  cache: true,
  cacheMaxEntries: 5,
  cacheMaxAge: 10 * 60 * 1000,
});

function getSigningKey(header: JwtHeader, callback: jwt.SigningKeyCallback) {
  jwksClient.getSigningKey(header.kid, (err, key) => {
    if (err || !key) {
      callback(err ?? new Error("Google signing key not found"));
      return;
    }
    callback(null, key.getPublicKey());
  });
}

function toleranceSeconds(): number {
  const raw = process.env.GMAIL_PUBSUB_TOLERANCE_SECONDS;
  const parsed = raw ? Number(raw) : DEFAULT_TOLERANCE_SECONDS;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_TOLERANCE_SECONDS;
}

function cleanupReplayCache(nowMs: number): void {
  for (const [key, expiry] of replayCache.entries()) {
    if (expiry <= nowMs) {
      replayCache.delete(key);
    }
  }
}

async function verifyOidcToken(token: string, audience: string): Promise<JwtPayload> {
  return new Promise<JwtPayload>((resolve, reject) => {
    jwt.verify(
      token,
      getSigningKey,
      {
        audience,
        issuer: GOOGLE_ISSUERS,
        algorithms: ["RS256"],
      },
      (error: jwt.VerifyErrors | null, decoded?: string | JwtPayload) => {
        if (error || !decoded || typeof decoded === "string") {
          reject(new ConnectorError("auth", "Invalid Google Pub/Sub OIDC token", 401));
          return;
        }
        resolve(decoded as JwtPayload);
      }
    );
  });
}

export async function verifyGooglePubSubPush(params: {
  authorizationHeader?: string;
  body: unknown;
  audience?: string;
}): Promise<GmailWebhookNotification> {
  const authHeader = params.authorizationHeader?.trim();
  if (!authHeader?.startsWith("Bearer ")) {
    throw new ConnectorError("auth", "Missing Google Pub/Sub bearer token", 401);
  }

  const audience = params.audience ?? process.env.GMAIL_PUBSUB_AUDIENCE;
  if (!audience?.trim()) {
    throw new ConnectorError("auth", "GMAIL_PUBSUB_AUDIENCE is not configured", 503);
  }

  const claims = await verifyOidcToken(authHeader.slice(7), audience.trim());
  const expectedEmail = process.env.GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL?.trim();
  const tokenEmail = typeof claims.email === "string" ? claims.email.trim() : "";
  if (expectedEmail && tokenEmail !== expectedEmail) {
    throw new ConnectorError("auth", "Unexpected Google Pub/Sub service account", 401);
  }

  const envelope = params.body as {
    subscription?: string;
    message?: {
      data?: string;
      messageId?: string;
      publishTime?: string;
    };
  };

  if (!envelope?.message?.messageId || !envelope.message.data) {
    throw new ConnectorError("schema", "Invalid Gmail Pub/Sub payload", 400);
  }

  const toleranceMs = toleranceSeconds() * 1000;
  const nowMs = Date.now();
  cleanupReplayCache(nowMs);

  const replayKey = createHash("sha256")
    .update(envelope.message.messageId)
    .update(".")
    .update(envelope.message.publishTime ?? "")
    .digest("hex");

  if (replayCache.has(replayKey)) {
    throw new ConnectorError("auth", "Gmail Pub/Sub replay detected", 409);
  }

  const decodedPayload = JSON.parse(
    Buffer.from(envelope.message.data, "base64").toString("utf8")
  ) as {
    emailAddress?: string;
    historyId?: string;
  };

  replayCache.set(replayKey, nowMs + Math.max(toleranceMs, DEFAULT_TOLERANCE_SECONDS * 1000));

  return {
    subscription: envelope.subscription,
    messageId: envelope.message.messageId,
    publishTime: envelope.message.publishTime,
    emailAddress: decodedPayload.emailAddress,
    historyId: decodedPayload.historyId,
  };
}

export function clearGmailWebhookReplayCache(): void {
  replayCache.clear();
}
