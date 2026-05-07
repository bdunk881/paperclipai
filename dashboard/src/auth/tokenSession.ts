import type { StoredAuthSession, StoredAuthUser } from "./authStorage";

function decodeJwtPayload(token: string | undefined): Record<string, unknown> | null {
  if (!token) {
    return null;
  }

  const [, rawPayload] = token.split(".");
  if (!rawPayload) {
    return null;
  }

  try {
    const normalized = rawPayload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function firstString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value;
  }

  if (Array.isArray(value)) {
    const first = value.find((entry) => typeof entry === "string" && entry.trim());
    return typeof first === "string" ? first : undefined;
  }

  return undefined;
}

function claimsToUser(accessTokenClaims: Record<string, unknown>): StoredAuthUser {
  const email =
    firstString(accessTokenClaims.email) ??
    firstString(accessTokenClaims.preferred_username) ??
    "unknown@autoflow.local";

  const name =
    firstString(accessTokenClaims.name) ??
    firstString(accessTokenClaims.given_name) ??
    email;

  return {
    id:
      firstString(accessTokenClaims.sub) ??
      firstString(accessTokenClaims.oid) ??
      email,
    email,
    name,
    tenantId: firstString(accessTokenClaims.tid),
  };
}

export function sessionFromAccessToken(accessToken: string, authProvider: StoredAuthSession["authProvider"]): StoredAuthSession {
  const accessTokenClaims = decodeJwtPayload(accessToken);
  if (!accessTokenClaims) {
    throw new Error("Access token payload could not be decoded.");
  }

  const expiresAtClaim = accessTokenClaims.exp;
  if (typeof expiresAtClaim !== "number") {
    throw new Error("Access token is missing an expiration timestamp.");
  }

  return {
    accessToken,
    expiresAt: expiresAtClaim * 1000,
    user: claimsToUser(accessTokenClaims),
    authProvider,
  };
}
