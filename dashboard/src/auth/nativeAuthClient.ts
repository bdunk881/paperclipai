import type { StoredAuthSession, StoredAuthUser } from "./authStorage";

const DEFAULT_CIAM_CLIENT_ID = "2dfd3a08-277c-4893-b07d-eca5ae322310";
const DEFAULT_SCOPE = "openid profile email offline_access";

/**
 * In production the dashboard is served by Vercel and API calls go through a
 * Vercel rewrite (`/api/* → https://api.helloautoflow.com/api/*`).  Vercel
 * rewrites can silently drop or corrupt POST bodies in certain browsers,
 * causing Azure CIAM to report missing parameters (AADSTS900144).
 *
 * Bypass the rewrite by sending native-auth requests directly to the API
 * backend when running on the production dashboard domain.
 */
function resolveNativeAuthProxyBase(): string {
  const envBase = import.meta.env.VITE_API_BASE_URL;
  if (typeof envBase === "string" && envBase.trim()) {
    return `${envBase.replace(/\/+$/, "")}/api/auth/native`;
  }

  if (
    typeof window !== "undefined" &&
    window.location.hostname === "app.helloautoflow.com"
  ) {
    return "https://api.helloautoflow.com/api/auth/native";
  }

  return "/api/auth/native";
}

const NATIVE_AUTH_PROXY_BASE = resolveNativeAuthProxyBase();

type NativeAuthPrimitive = string | number | boolean | null | undefined;
type NativeAuthPayload = Record<string, NativeAuthPrimitive>;

export type NativeAuthFlowResponse = {
  continuation_token?: string;
  expires_in?: number;
  interval?: number;
  challenge_channel?: string;
  challenge_target_label?: string;
  code_length?: number;
  binding_method?: string;
  error?: string;
  error_description?: string;
  [key: string]: unknown;
};

export type NativeAuthTokenResponse = {
  token_type: string;
  scope?: string;
  expires_in: number;
  access_token: string;
  refresh_token?: string;
  id_token?: string;
};

export class NativeAuthError extends Error {
  readonly code?: string;
  readonly description?: string;
  readonly status: number;

  constructor(message: string, status: number, code?: string, description?: string) {
    super(message);
    this.name = "NativeAuthError";
    this.status = status;
    this.code = code;
    this.description = description;
  }
}

export function isRedirectRequired(error: unknown): boolean {
  return error instanceof NativeAuthError && error.code === "redirect_required";
}

function clientId(): string {
  return import.meta.env.VITE_AZURE_CIAM_CLIENT_ID ?? DEFAULT_CIAM_CLIENT_ID;
}

function buildJsonBody(input: NativeAuthPayload): string {
  const clean: Record<string, string> = {};

  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    clean[key] = String(value);
  }

  return JSON.stringify(clean);
}

async function readNativeAuthError(response: Response): Promise<NativeAuthError> {
  const payload = (await response.json().catch(() => null)) as NativeAuthFlowResponse | null;
  const description = payload?.error_description;
  const message =
    description ??
    payload?.error ??
    `Native auth request failed with status ${response.status}.`;
  return new NativeAuthError(message, response.status, payload?.error, description);
}

async function postForm<T>(path: string, payload: NativeAuthPayload): Promise<T> {
  const response = await fetch(`${NATIVE_AUTH_PROXY_BASE}/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: buildJsonBody(payload),
  });

  if (!response.ok) {
    throw await readNativeAuthError(response);
  }

  return (await response.json()) as T;
}

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

function claimsToUser(idTokenClaims: Record<string, unknown> | null, accessTokenClaims: Record<string, unknown> | null): StoredAuthUser {
  const claims = idTokenClaims ?? accessTokenClaims ?? {};
  const accessClaims = accessTokenClaims ?? {};

  const email =
    firstString(claims.email) ??
    firstString(claims.preferred_username) ??
    firstString(claims.emails) ??
    firstString(accessClaims.email) ??
    firstString(accessClaims.preferred_username) ??
    "unknown@autoflow.local";

  const name =
    firstString(claims.name) ??
    firstString(claims.given_name) ??
    email;

  return {
    id:
      firstString(accessClaims.sub) ??
      firstString(claims.sub) ??
      firstString(accessClaims.oid) ??
      firstString(claims.oid) ??
      email,
    email,
    name,
    tenantId:
      firstString(accessClaims.tid) ??
      firstString(claims.tid),
  };
}

export function sessionFromTokenResponse(tokens: NativeAuthTokenResponse): StoredAuthSession {
  const idTokenClaims = decodeJwtPayload(tokens.id_token);
  const accessTokenClaims = decodeJwtPayload(tokens.access_token);

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    idToken: tokens.id_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
    scope: tokens.scope,
    user: claimsToUser(idTokenClaims, accessTokenClaims),
  };
}

export function isSessionExpiring(session: StoredAuthSession | null, thresholdMs = 60_000): boolean {
  if (!session) {
    return true;
  }

  return session.expiresAt - thresholdMs <= Date.now();
}

export async function refreshNativeAuthSession(refreshToken: string): Promise<NativeAuthTokenResponse> {
  return postForm<NativeAuthTokenResponse>("oauth2/v2.0/token", {
    client_id: clientId(),
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: DEFAULT_SCOPE,
  });
}

export async function signInWithPassword(email: string, password: string): Promise<NativeAuthTokenResponse> {
  const initiated = await postForm<NativeAuthFlowResponse>("oauth2/v2.0/initiate", {
    client_id: clientId(),
    scope: DEFAULT_SCOPE,
    username: email,
    challenge_type: "oob password redirect",
    capabilities: "registration_required mfa_required",
  });

  if (!initiated.continuation_token) {
    throw new NativeAuthError("Sign-in did not return a continuation token.", 500);
  }

  const challenged = await postForm<NativeAuthFlowResponse>("oauth2/v2.0/challenge", {
    client_id: clientId(),
    continuation_token: initiated.continuation_token,
    challenge_type: "password redirect",
  });

  if (challenged.challenge_type === "redirect") {
    throw new NativeAuthError(
      "This account uses Microsoft sign-in. Use the \"Sign in with Microsoft\" button instead.",
      400,
      "redirect_required",
      "This account was created with Microsoft and doesn't have a password. Use the \"Sign in with Microsoft\" button below.",
    );
  }

  const continuationToken = challenged.continuation_token ?? initiated.continuation_token;

  return postForm<NativeAuthTokenResponse>("oauth2/v2.0/token", {
    client_id: clientId(),
    scope: DEFAULT_SCOPE,
    continuation_token: continuationToken,
    grant_type: "password",
    password,
  });
}

export async function startSignUp(email: string, password: string, displayName: string): Promise<NativeAuthFlowResponse> {
  return postForm<NativeAuthFlowResponse>("signup/v1.0/start", {
    client_id: clientId(),
    username: email,
    password,
    challenge_type: "oob password redirect",
    attributes: JSON.stringify({ displayName }),
    capabilities: "registration_required mfa_required",
  });
}

export async function challengeSignUp(continuationToken: string): Promise<NativeAuthFlowResponse> {
  return postForm<NativeAuthFlowResponse>("signup/v1.0/challenge", {
    client_id: clientId(),
    continuation_token: continuationToken,
    challenge_type: "oob password redirect",
  });
}

export async function continueSignUp(continuationToken: string, code: string): Promise<NativeAuthFlowResponse> {
  return postForm<NativeAuthFlowResponse>("signup/v1.0/continue", {
    client_id: clientId(),
    continuation_token: continuationToken,
    oob: code,
  });
}

export async function exchangeContinuationToken(continuationToken: string): Promise<NativeAuthTokenResponse> {
  return postForm<NativeAuthTokenResponse>("oauth2/v2.0/token", {
    client_id: clientId(),
    scope: DEFAULT_SCOPE,
    continuation_token: continuationToken,
    grant_type: "continuation_token",
  });
}

export async function startPasswordReset(email: string): Promise<NativeAuthFlowResponse> {
  return postForm<NativeAuthFlowResponse>("resetpassword/v1.0/start", {
    client_id: clientId(),
    username: email,
    challenge_type: "oob redirect",
  });
}

export async function challengePasswordReset(continuationToken: string): Promise<NativeAuthFlowResponse> {
  return postForm<NativeAuthFlowResponse>("resetpassword/v1.0/challenge", {
    client_id: clientId(),
    continuation_token: continuationToken,
    challenge_type: "oob",
  });
}

export async function continuePasswordReset(continuationToken: string, code: string): Promise<NativeAuthFlowResponse> {
  return postForm<NativeAuthFlowResponse>("resetpassword/v1.0/continue", {
    client_id: clientId(),
    continuation_token: continuationToken,
    oob: code,
  });
}

export async function submitPasswordReset(
  continuationToken: string,
  newPassword: string
): Promise<NativeAuthFlowResponse> {
  return postForm<NativeAuthFlowResponse>("resetpassword/v1.0/submit", {
    client_id: clientId(),
    continuation_token: continuationToken,
    new_password: newPassword,
  });
}

export async function pollPasswordResetCompletion(
  continuationToken: string,
  maxAttempts = 8
): Promise<NativeAuthFlowResponse> {
  let lastResponse: NativeAuthFlowResponse | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const response = await postForm<NativeAuthFlowResponse>("resetpassword/v1.0/poll_completion", {
      client_id: clientId(),
      continuation_token: continuationToken,
    });

    lastResponse = response;

    if (response.continuation_token || response.error) {
      return response;
    }

    const intervalSeconds = typeof response.interval === "number" && response.interval > 0
      ? response.interval
      : 2;

    await new Promise((resolve) => window.setTimeout(resolve, intervalSeconds * 1000));
  }

  if (!lastResponse) {
    throw new NativeAuthError("Password reset confirmation did not return a continuation token.", 500);
  }

  return lastResponse;
}
