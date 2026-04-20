/**
 * Action Executor — executes authenticated REST actions for integrations.
 *
 * Features:
 *   - Resolves the integration manifest and user credentials
 *   - Auto-refreshes expired OAuth2 tokens before the call
 *   - Interpolates {{key}} placeholders in URL paths and request bodies
 *   - Executes the HTTP request with exponential-backoff retry on 429 / 5xx
 *   - Returns the parsed response body as a plain JS object
 *   - Supports sandbox mode (uses sandboxBaseUrl when available)
 */

import { IntegrationAction, IntegrationCredentials, IntegrationManifest } from "./integrationManifest";
import { buildAuthHeaders, isTokenExpired, refreshOAuth2Token, resolveUrlTemplate } from "./authAdapters";
import { integrationCredentialStore } from "./integrationCredentialStore";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ActionExecutionParams {
  /** ID of the user whose credentials to use */
  userId: string;
  /** Slug of the integration, e.g. "hubspot" */
  integrationSlug: string;
  /** Action ID, e.g. "contacts.upsert" */
  actionId: string;
  /** Input values for the action (path params + body fields) */
  input: Record<string, unknown>;
  /** When true, use the sandbox base URL if available */
  sandbox?: boolean;
  /**
   * Optional: specify a connection ID explicitly.
   * If omitted, the user's default connection for this integration is used.
   */
  connectionId?: string;
}

export interface ActionExecutionResult {
  /** Raw parsed response body */
  data: unknown;
  /** HTTP status code */
  statusCode: number;
  /** Whether the call was a success (2xx) */
  success: boolean;
  /** How many attempts were made (1 = no retry needed) */
  attempts: number;
}

// ---------------------------------------------------------------------------
// Retry configuration
// ---------------------------------------------------------------------------

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 500;

/** Returns true for status codes that warrant a retry. */
function isRetryable(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

/** Exponential backoff with jitter: base * 2^attempt + random(0..200ms) */
function backoffMs(attempt: number): number {
  return INITIAL_BACKOFF_MS * Math.pow(2, attempt) + Math.floor(Math.random() * 200);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// URL / body template helpers
// ---------------------------------------------------------------------------

/**
 * Interpolate {{key}} placeholders in a string using values from the input map.
 * Used for both URL path segments and request body fields.
 */
function interpolate(template: string, values: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const val = values[key];
    return val !== undefined ? String(val) : `{{${key}}}`;
  });
}

/**
 * Build the URL for an action call.
 * Applies instanceDomain substitution and path interpolation.
 */
function buildUrl(
  manifest: IntegrationManifest,
  action: IntegrationAction,
  input: Record<string, unknown>,
  sandbox: boolean,
  credentials: IntegrationCredentials
): string {
  const rawBase = sandbox && manifest.sandboxBaseUrl
    ? manifest.sandboxBaseUrl
    : manifest.baseUrl;

  const instanceDomain = credentials.instanceDomain ??
    (typeof input["instanceDomain"] === "string" ? input["instanceDomain"] : undefined);

  const base = resolveUrlTemplate(rawBase, instanceDomain);
  const path = interpolate(action.path, input);
  return `${base}${path}`;
}

/**
 * Build the request body (for POST / PUT / PATCH).
 * Path-parameter keys are stripped; remaining input keys become the body.
 */
function buildBody(action: IntegrationAction, input: Record<string, unknown>): Record<string, unknown> {
  // Extract keys used in the path template
  const pathKeys = new Set<string>();
  for (const match of action.path.matchAll(/\{\{(\w+)\}\}/g)) {
    pathKeys.add(match[1]);
  }

  const body: Record<string, unknown> = {};
  for (const field of action.inputSchema) {
    if (!pathKeys.has(field.key) && field.key in input) {
      body[field.key] = input[field.key];
    }
  }
  return body;
}

/**
 * Build query params (for GET / DELETE) from input keys not in the path template.
 */
function buildQueryParams(action: IntegrationAction, input: Record<string, unknown>): URLSearchParams {
  const pathKeys = new Set<string>();
  for (const match of action.path.matchAll(/\{\{(\w+)\}\}/g)) {
    pathKeys.add(match[1]);
  }

  const params = new URLSearchParams();
  for (const field of action.inputSchema) {
    if (!pathKeys.has(field.key) && field.key in input) {
      const val = input[field.key];
      if (val !== undefined && val !== null) {
        params.set(field.key, String(val));
      }
    }
  }
  return params;
}

// ---------------------------------------------------------------------------
// Core executor
// ---------------------------------------------------------------------------

/**
 * Execute a single integration action with automatic token refresh and retry.
 */
export async function executeAction(
  manifest: IntegrationManifest,
  params: ActionExecutionParams
): Promise<ActionExecutionResult> {
  const { userId, actionId, input, sandbox = false, connectionId } = params;

  // Resolve the action definition
  const action = manifest.actions.find((a) => a.id === actionId);
  if (!action) {
    throw new Error(`Action "${actionId}" not found in integration "${manifest.slug}"`);
  }

  // Resolve credentials
  const resolved = connectionId
    ? integrationCredentialStore.getDecrypted(connectionId, userId)
    : integrationCredentialStore.getDecryptedDefault(userId, manifest.slug);

  if (!resolved && manifest.authKind !== "none") {
    throw new Error(
      `No credentials found for integration "${manifest.slug}". ` +
      "Connect the integration in Settings → Integrations."
    );
  }

  let credentials: IntegrationCredentials = resolved?.credentials ?? {};

  // Auto-refresh expired OAuth2 tokens
  if (
    manifest.authKind === "oauth2_pkce" &&
    isTokenExpired(credentials) &&
    credentials.refreshToken &&
    manifest.oauth2Config
  ) {
    credentials = await refreshOAuth2Token({
      oauth2Config: manifest.oauth2Config,
      credentials,
      instanceDomain: credentials.instanceDomain,
    });
    // Persist the refreshed tokens
    if (resolved) {
      integrationCredentialStore.updateCredentials(resolved.connection.id, userId, credentials);
    }
  }

  // Build auth headers
  const authHeaders = buildAuthHeaders(manifest.authKind, credentials, manifest.authHeaderKey);

  // Build the full URL
  const url = buildUrl(manifest, action, input, sandbox, credentials);

  // Execute with retry
  let attempt = 0;
  let lastStatus = 0;
  let lastData: unknown = null;

  while (attempt <= MAX_RETRIES) {
    let fetchUrl = url;
    let fetchInit: RequestInit = {
      method: action.method,
      headers: {
        Accept: "application/json",
        ...authHeaders,
      } as Record<string, string>,
    };

    if (["GET", "DELETE"].includes(action.method)) {
      const queryParams = buildQueryParams(action, input);
      const qs = queryParams.toString();
      if (qs) fetchUrl = `${url}?${qs}`;
    } else {
      const body = buildBody(action, input);
      (fetchInit.headers as Record<string, string>)["Content-Type"] = "application/json";
      fetchInit.body = JSON.stringify(body);
    }

    const response = await fetch(fetchUrl, fetchInit);
    lastStatus = response.status;

    // Parse response
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      lastData = await response.json();
    } else {
      lastData = await response.text();
    }

    if (!isRetryable(lastStatus)) {
      return {
        data: lastData,
        statusCode: lastStatus,
        success: lastStatus >= 200 && lastStatus < 300,
        attempts: attempt + 1,
      };
    }

    if (attempt < MAX_RETRIES) {
      await sleep(backoffMs(attempt));
    }
    attempt++;
  }

  return {
    data: lastData,
    statusCode: lastStatus,
    success: false,
    attempts: attempt,
  };
}

// ---------------------------------------------------------------------------
// Sandbox connectivity test
// ---------------------------------------------------------------------------

/**
 * Test that a connection is live by hitting the first GET action (or a HEAD
 * on the base URL) and checking for a non-5xx response.
 */
export async function testConnection(
  manifest: IntegrationManifest,
  connectionId: string,
  userId: string
): Promise<{ ok: boolean; message: string }> {
  const resolved = integrationCredentialStore.getDecrypted(connectionId, userId);
  if (!resolved) {
    return { ok: false, message: "Connection not found" };
  }

  const { credentials } = resolved;
  const authHeaders = buildAuthHeaders(manifest.authKind, credentials, manifest.authHeaderKey);
  const baseUrl = resolveUrlTemplate(manifest.baseUrl, credentials.instanceDomain);

  try {
    const response = await fetch(baseUrl, {
      method: "HEAD",
      headers: { Accept: "application/json", ...authHeaders },
    });

    if (response.status < 500) {
      return { ok: true, message: `Connection successful (HTTP ${response.status})` };
    }
    return { ok: false, message: `Server error (HTTP ${response.status})` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `Connection failed: ${msg}` };
  }
}
