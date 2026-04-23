/**
 * Integration Framework API routes.
 *
 * Catalog endpoints (public, no auth):
 *   GET  /api/integrations/catalog                   — list all integrations
 *   GET  /api/integrations/catalog/:slug             — get one by slug
 *
 * Connection endpoints (requires auth):
 *   GET  /api/integrations/connections               — list user's connections
 *   POST /api/integrations/connections               — create a connection (api_key / bearer / basic)
 *   GET  /api/integrations/connections/:id           — get one connection
 *   PATCH /api/integrations/connections/:id          — update label
 *   DELETE /api/integrations/connections/:id         — remove a connection
 *   POST /api/integrations/connections/:id/default   — set as default
 *   POST /api/integrations/connections/:id/test      — test connectivity
 *
 * OAuth2 endpoints:
 *   GET  /api/integrations/oauth2/:slug/authorize    — start OAuth2 PKCE flow (requires auth)
 *   GET  /api/integrations/oauth2/:slug/callback     — exchange code for token (public — browser redirect)
 *
 * MCP adapter endpoints (requires auth):
 *   GET  /api/integrations/mcp                       — list MCP-backed integration slugs
 *   GET  /api/integrations/mcp/discover              — discover tools across all user MCP connections
 *   GET  /api/integrations/mcp/:slug/tools           — discover tools for one integration
 *   POST /api/integrations/mcp/:slug/invoke          — invoke a tool on a connected integration
 *
 * Action endpoints (requires auth):
 *   POST /api/integrations/actions/:slug/:actionId   — execute an action (sandbox)
 *
 * Webhook relay:
 *   POST /api/webhooks/relay/:subscriptionId         — inbound relay endpoint (public)
 *   GET  /api/integrations/triggers/subscriptions    — list user's subscriptions (requires auth)
 *   POST /api/integrations/triggers/subscriptions    — create a trigger subscription (requires auth)
 *   DELETE /api/integrations/triggers/subscriptions/:id — remove subscription (requires auth)
 *   GET  /api/integrations/triggers/subscriptions/:id/events — list relay events (requires auth)
 */

import { Router } from "express";
import { AuthenticatedRequest } from "../auth/authMiddleware";
import {
  INTEGRATION_CATALOG,
  INTEGRATION_CATALOG_CATEGORIES,
  getIntegrationBySlug,
} from "./integrationCatalog";
import { integrationCredentialStore } from "./integrationCredentialStore";
import { IntegrationCredentials } from "./integrationManifest";
import {
  beginOAuth2PkceFlow,
  completeOAuth2PkceFlow,
  fetchClientCredentialsToken,
} from "./authAdapters";
import { executeAction, testConnection } from "./actionExecutor";
import { webhookRelay, WebhookSignatureScheme } from "./webhookRelay";
import {
  listMcpBackedIntegrations,
  discoverIntegrationMcpTools,
  invokeIntegrationMcpTool,
  discoverAllUserMcpTools,
} from "./integrationMcpAdapter";

const VALID_SIGNATURE_SCHEMES: WebhookSignatureScheme[] = [
  "stripe",
  "hubspot",
  "github",
  "hmac-sha256",
  "none",
];

// ---------------------------------------------------------------------------
// Catalog router — public, no auth required
// Mounted at /api/integrations/catalog in app.ts
// ---------------------------------------------------------------------------

export const catalogRouter = Router();

/** GET /api/integrations/catalog */
catalogRouter.get("/", (_req, res) => {
  const { category } = _req.query;
  const catalog = category && typeof category === "string"
    ? INTEGRATION_CATALOG.filter((i) => i.category === category)
    : INTEGRATION_CATALOG;

  res.json({
    catalog: catalog.map((m) => ({
      slug: m.slug,
      name: m.name,
      description: m.description,
      category: m.category,
      icon: m.icon,
      authKind: m.authKind,
      actionCount: m.actions.length,
      triggerCount: m.triggers.length,
      verified: m.verified,
    })),
    categories: INTEGRATION_CATALOG_CATEGORIES,
    total: catalog.length,
  });
});

/** GET /api/integrations/catalog/:slug */
catalogRouter.get("/:slug", (req, res) => {
  const manifest = getIntegrationBySlug(req.params.slug);
  if (!manifest) {
    res.status(404).json({ error: `No integration found for slug: ${req.params.slug}` });
    return;
  }
  // Omit oauth2Config.clientSecretHint from public response — it's doc-only anyway
  res.json(manifest);
});

// ---------------------------------------------------------------------------
// OAuth2 callback router — must remain unauthenticated (no auth required).
// During an OAuth2 PKCE flow the authorization server redirects the browser
// back to this URL; the browser carries no Bearer token at that point.
// The userId is read from the X-User-Id header as a known limitation.
// A future improvement should encode the userId in the PKCE state instead.
// Mounted at /api/integrations/oauth2 in app.ts (before the protected mount).
// ---------------------------------------------------------------------------

function resolveUserIdFromHeader(
  req: { headers: Record<string, string | string[] | undefined> }
): string | null {
  const h = req.headers["x-user-id"];
  return typeof h === "string" && h.trim() ? h.trim() : null;
}

export const oauthCallbackRouter = Router();

/**
 * GET /api/integrations/oauth2/:slug/callback
 * Exchanges the authorization code for tokens and stores the connection.
 * Returns the new IntegrationConnectionPublic record.
 */
oauthCallbackRouter.get("/:slug/callback", async (req, res) => {
  const userId = resolveUserIdFromHeader(req);
  if (!userId) { res.status(401).json({ error: "X-User-Id header is required" }); return; }

  const manifest = getIntegrationBySlug(req.params.slug);
  if (!manifest) { res.status(404).json({ error: `Integration not found: ${req.params.slug}` }); return; }
  if (!manifest.oauth2Config) { res.status(400).json({ error: `Integration "${manifest.slug}" does not use OAuth2` }); return; }

  const { code, state, instanceDomain, clientSecret, clientId, label } = req.query as Record<string, string>;
  if (!code) { res.status(400).json({ error: "code query param is required" }); return; }
  if (!state) { res.status(400).json({ error: "state query param is required" }); return; }
  if (!clientId) { res.status(400).json({ error: "clientId query param is required (forwarded from authorize step)" }); return; }

  try {
    const credentials = await completeOAuth2PkceFlow({
      code,
      state,
      oauth2Config: manifest.oauth2Config,
      clientId,
      clientSecret,
      instanceDomain,
    });

    const conn = integrationCredentialStore.create({
      userId,
      integrationSlug: manifest.slug,
      label: label ?? `${manifest.name} (OAuth2)`,
      credentials,
    });

    res.status(201).json(conn);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: msg });
  }
});

// ---------------------------------------------------------------------------
// Main protected router — auth is applied at mount in app.ts.
// All handlers use req.auth!.sub (set by requireAuth middleware) for identity.
// ---------------------------------------------------------------------------

const router = Router();

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

/** GET /api/integrations/connections */
router.get("/connections", (req, res) => {
  const userId = (req as AuthenticatedRequest).auth!.sub;

  const { integration } = req.query;
  const connections = integrationCredentialStore.list(
    userId,
    typeof integration === "string" ? integration : undefined
  );
  res.json({ connections, total: connections.length });
});

/** POST /api/integrations/connections — store a static credential */
router.post("/connections", (req, res) => {
  const userId = (req as AuthenticatedRequest).auth!.sub;

  const { integrationSlug, label, credentials } = req.body as {
    integrationSlug?: unknown;
    label?: unknown;
    credentials?: unknown;
  };

  if (typeof integrationSlug !== "string" || !integrationSlug.trim()) {
    res.status(400).json({ error: "integrationSlug is required" }); return;
  }
  if (typeof label !== "string" || !label.trim()) {
    res.status(400).json({ error: "label is required" }); return;
  }
  if (!credentials || typeof credentials !== "object" || Array.isArray(credentials)) {
    res.status(400).json({ error: "credentials must be an object" }); return;
  }

  const manifest = getIntegrationBySlug(integrationSlug);
  if (!manifest) {
    res.status(400).json({ error: `Unknown integration slug: ${integrationSlug}` }); return;
  }

  const conn = integrationCredentialStore.create({
    userId,
    integrationSlug,
    label,
    credentials: credentials as IntegrationCredentials,
  });

  res.status(201).json(conn);
});

/** GET /api/integrations/connections/:id */
router.get("/connections/:id", (req, res) => {
  const userId = (req as AuthenticatedRequest).auth!.sub;

  const conn = integrationCredentialStore.get(req.params.id, userId);
  if (!conn) { res.status(404).json({ error: "Connection not found" }); return; }
  res.json(conn);
});

/** PATCH /api/integrations/connections/:id */
router.patch("/connections/:id", (req, res) => {
  const userId = (req as AuthenticatedRequest).auth!.sub;

  const { label } = req.body as { label?: unknown };
  if (typeof label !== "string" || !label.trim()) {
    res.status(400).json({ error: "label is required" }); return;
  }

  const conn = integrationCredentialStore.update(req.params.id, userId, { label });
  if (!conn) { res.status(404).json({ error: "Connection not found" }); return; }
  res.json(conn);
});

/** DELETE /api/integrations/connections/:id */
router.delete("/connections/:id", (req, res) => {
  const userId = (req as AuthenticatedRequest).auth!.sub;

  const deleted = integrationCredentialStore.delete(req.params.id, userId);
  if (!deleted) { res.status(404).json({ error: "Connection not found" }); return; }
  res.status(204).end();
});

/** POST /api/integrations/connections/:id/default */
router.post("/connections/:id/default", (req, res) => {
  const userId = (req as AuthenticatedRequest).auth!.sub;

  const conn = integrationCredentialStore.setDefault(req.params.id, userId);
  if (!conn) { res.status(404).json({ error: "Connection not found" }); return; }
  res.json(conn);
});

/** POST /api/integrations/connections/:id/test */
router.post("/connections/:id/test", async (req, res) => {
  const userId = (req as AuthenticatedRequest).auth!.sub;

  const conn = integrationCredentialStore.get(req.params.id, userId);
  if (!conn) { res.status(404).json({ error: "Connection not found" }); return; }

  const manifest = getIntegrationBySlug(conn.integrationSlug);
  if (!manifest) { res.status(404).json({ error: `Integration manifest not found: ${conn.integrationSlug}` }); return; }

  try {
    const result = await testConnection(manifest, req.params.id, userId);
    res.status(result.ok ? 200 : 502).json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ ok: false, message: `Test failed: ${msg}` });
  }
});

// ---------------------------------------------------------------------------
// OAuth2 flows — authorize and client-credentials (auth required)
// The callback is handled by oauthCallbackRouter (public, see above).
// ---------------------------------------------------------------------------

/**
 * GET /api/integrations/oauth2/:slug/authorize
 * Query params: clientId, redirectUri, instanceDomain (optional)
 * Begins an OAuth2 PKCE authorization flow.
 * Returns: { authorizationUrl: string } — the caller should redirect the user here.
 */
router.get("/oauth2/:slug/authorize", (req, res) => {
  const userId = (req as AuthenticatedRequest).auth!.sub;

  const manifest = getIntegrationBySlug(req.params.slug);
  if (!manifest) { res.status(404).json({ error: `Integration not found: ${req.params.slug}` }); return; }
  if (!manifest.oauth2Config) { res.status(400).json({ error: `Integration "${manifest.slug}" does not use OAuth2` }); return; }

  const { clientId, redirectUri, instanceDomain } = req.query as Record<string, string>;
  if (!clientId) { res.status(400).json({ error: "clientId query param is required" }); return; }
  if (!redirectUri) { res.status(400).json({ error: "redirectUri query param is required" }); return; }

  try {
    const result = beginOAuth2PkceFlow({
      manifest,
      userId,
      redirectUri,
      clientId,
      instanceDomain,
    });
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: msg });
  }
});

/**
 * POST /api/integrations/oauth2/:slug/client-credentials
 * Body: { clientId, clientSecret, instanceDomain?, label? }
 * Fetches a client-credentials token and stores the connection.
 */
router.post("/oauth2/:slug/client-credentials", async (req, res) => {
  const userId = (req as AuthenticatedRequest).auth!.sub;

  const manifest = getIntegrationBySlug(req.params.slug);
  if (!manifest) { res.status(404).json({ error: `Integration not found: ${req.params.slug}` }); return; }
  if (manifest.authKind !== "oauth2_client_credentials") {
    res.status(400).json({ error: `Integration "${manifest.slug}" does not use client-credentials flow` }); return;
  }

  const { clientId, clientSecret, instanceDomain, label } = req.body as {
    clientId?: unknown;
    clientSecret?: unknown;
    instanceDomain?: unknown;
    label?: unknown;
  };

  if (typeof clientId !== "string" || !clientId) {
    res.status(400).json({ error: "clientId is required" }); return;
  }
  if (typeof clientSecret !== "string" || !clientSecret) {
    res.status(400).json({ error: "clientSecret is required" }); return;
  }

  try {
    const credentials = await fetchClientCredentialsToken({
      oauth2Config: manifest.oauth2Config!,
      clientId,
      clientSecret,
      instanceDomain: typeof instanceDomain === "string" ? instanceDomain : undefined,
    });

    const conn = integrationCredentialStore.create({
      userId,
      integrationSlug: manifest.slug,
      label: typeof label === "string" ? label : `${manifest.name} (Client Credentials)`,
      credentials,
    });

    res.status(201).json(conn);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: msg });
  }
});

// ---------------------------------------------------------------------------
// Action execution — sandbox testing
// ---------------------------------------------------------------------------

/**
 * POST /api/integrations/actions/:slug/:actionId
 * Body: { input: Record<string, unknown>, connectionId?: string, sandbox?: boolean }
 * Executes an integration action using the caller's stored credentials.
 */
router.post("/actions/:slug/:actionId", async (req, res) => {
  const userId = (req as AuthenticatedRequest).auth!.sub;

  const manifest = getIntegrationBySlug(req.params.slug);
  if (!manifest) { res.status(404).json({ error: `Integration not found: ${req.params.slug}` }); return; }

  const { input, connectionId, sandbox } = req.body as {
    input?: unknown;
    connectionId?: unknown;
    sandbox?: unknown;
  };

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    res.status(400).json({ error: "input must be a JSON object" }); return;
  }

  try {
    const result = await executeAction(manifest, {
      userId,
      integrationSlug: manifest.slug,
      actionId: req.params.actionId,
      input: input as Record<string, unknown>,
      sandbox: sandbox === true,
      connectionId: typeof connectionId === "string" ? connectionId : undefined,
    });

    res.status(result.success ? 200 : result.statusCode).json({
      success: result.success,
      statusCode: result.statusCode,
      attempts: result.attempts,
      data: result.data,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: msg });
  }
});

// ---------------------------------------------------------------------------
// Trigger subscriptions
// ---------------------------------------------------------------------------

/** GET /api/integrations/triggers/subscriptions */
router.get("/triggers/subscriptions", (req, res) => {
  const userId = (req as AuthenticatedRequest).auth!.sub;

  const { integration } = req.query;
  const subs = webhookRelay.listSubscriptions(
    userId,
    typeof integration === "string" ? integration : undefined
  );
  res.json({ subscriptions: subs, total: subs.length });
});

/** POST /api/integrations/triggers/subscriptions */
router.post("/triggers/subscriptions", (req, res) => {
  const userId = (req as AuthenticatedRequest).auth!.sub;

  const {
    integrationSlug,
    triggerId,
    eventTypes,
    workflowTemplateId,
    label,
    signatureScheme,
    signingSecret,
    signatureHeaderKey,
  } = req.body as {
    integrationSlug?: unknown;
    triggerId?: unknown;
    eventTypes?: unknown;
    workflowTemplateId?: unknown;
    label?: unknown;
    signatureScheme?: unknown;
    signingSecret?: unknown;
    signatureHeaderKey?: unknown;
  };

  if (typeof integrationSlug !== "string" || !integrationSlug.trim()) {
    res.status(400).json({ error: "integrationSlug is required" }); return;
  }
  if (typeof triggerId !== "string" || !triggerId.trim()) {
    res.status(400).json({ error: "triggerId is required" }); return;
  }
  if (!Array.isArray(eventTypes) || !eventTypes.every((e) => typeof e === "string")) {
    res.status(400).json({ error: "eventTypes must be an array of strings" }); return;
  }
  if (
    signatureScheme !== undefined &&
    !VALID_SIGNATURE_SCHEMES.includes(signatureScheme as WebhookSignatureScheme)
  ) {
    res.status(400).json({
      error: `signatureScheme must be one of: ${VALID_SIGNATURE_SCHEMES.join(", ")}`,
    });
    return;
  }
  if (signatureScheme && signatureScheme !== "none" && !signingSecret) {
    res.status(400).json({ error: "signingSecret is required when signatureScheme is set" }); return;
  }

  const manifest = getIntegrationBySlug(integrationSlug);
  if (!manifest) { res.status(400).json({ error: `Unknown integration: ${integrationSlug}` }); return; }

  const trigger = manifest.triggers.find((t) => t.id === triggerId);
  if (!trigger) { res.status(400).json({ error: `Trigger "${triggerId}" not found in integration "${integrationSlug}"` }); return; }

  const sub = webhookRelay.subscribe({
    userId,
    integrationSlug,
    triggerId,
    eventTypes: eventTypes as string[],
    workflowTemplateId: typeof workflowTemplateId === "string" ? workflowTemplateId : undefined,
    label: typeof label === "string" ? label : `${manifest.name} / ${trigger.name}`,
    signatureScheme: typeof signatureScheme === "string"
      ? (signatureScheme as WebhookSignatureScheme)
      : "none",
    signingSecret: typeof signingSecret === "string" ? signingSecret : undefined,
    signatureHeaderKey: typeof signatureHeaderKey === "string" ? signatureHeaderKey : undefined,
  });

  // Return the subscription without exposing the signing secret
  const { signingSecret: _secret, ...subPublic } = sub;
  res.status(201).json({
    subscription: subPublic,
    relayUrl: `/api/webhooks/relay/${sub.id}`,
  });
});

/** DELETE /api/integrations/triggers/subscriptions/:id */
router.delete("/triggers/subscriptions/:id", (req, res) => {
  const userId = (req as AuthenticatedRequest).auth!.sub;

  const deleted = webhookRelay.deleteSubscription(req.params.id, userId);
  if (!deleted) { res.status(404).json({ error: "Subscription not found" }); return; }
  res.status(204).end();
});

/** GET /api/integrations/triggers/subscriptions/:id/events */
router.get("/triggers/subscriptions/:id/events", (req, res) => {
  const userId = (req as AuthenticatedRequest).auth!.sub;

  const { limit, unconsumedOnly } = req.query;
  const eventsList = webhookRelay.listEvents(req.params.id, userId, {
    limit: typeof limit === "string" ? parseInt(limit, 10) : undefined,
    unconsumedOnly: unconsumedOnly === "true",
  });

  res.json({ events: eventsList, total: eventsList.length });
});

// ---------------------------------------------------------------------------
// MCP Adapter — integration-scoped MCP tool discovery and invocation
// ---------------------------------------------------------------------------

/** GET /api/integrations/mcp — list integrations with native MCP servers */
router.get("/mcp", (_req, res) => {
  res.json({ integrations: listMcpBackedIntegrations() });
});

/**
 * GET /api/integrations/mcp/discover
 * Discovers MCP tools across all of the user's MCP-backed connections.
 */
router.get("/mcp/discover", async (req, res) => {
  const userId = (req as AuthenticatedRequest).auth!.sub;

  try {
    const results = await discoverAllUserMcpTools(userId);
    res.json({ results, total: results.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: msg });
  }
});

/**
 * GET /api/integrations/mcp/:slug/tools
 * Query params: connectionId (optional)
 * Discovers available MCP tools for one connected integration.
 */
router.get("/mcp/:slug/tools", async (req, res) => {
  const userId = (req as AuthenticatedRequest).auth!.sub;

  const { connectionId } = req.query as Record<string, string>;

  try {
    const tools = await discoverIntegrationMcpTools(
      userId,
      req.params.slug,
      connectionId || undefined
    );
    res.json({ tools, total: tools.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg.includes("No connection found") || msg.includes("does not have a native MCP")
      ? 404
      : 502;
    res.status(status).json({ error: msg });
  }
});

/**
 * POST /api/integrations/mcp/:slug/invoke
 * Body: { toolName: string, args: Record<string, unknown>, connectionId?: string }
 * Invokes an MCP tool on a connected integration.
 */
router.post("/mcp/:slug/invoke", async (req, res) => {
  const userId = (req as AuthenticatedRequest).auth!.sub;

  const { toolName, args, connectionId } = req.body as {
    toolName?: unknown;
    args?: unknown;
    connectionId?: unknown;
  };

  if (typeof toolName !== "string" || !toolName.trim()) {
    res.status(400).json({ error: "toolName is required" }); return;
  }
  if (args !== undefined && (typeof args !== "object" || Array.isArray(args))) {
    res.status(400).json({ error: "args must be a JSON object" }); return;
  }

  try {
    const result = await invokeIntegrationMcpTool(
      userId,
      req.params.slug,
      toolName,
      (args as Record<string, unknown>) ?? {},
      typeof connectionId === "string" ? connectionId : undefined
    );
    res.status(result.isError ? 502 : 200).json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg.includes("No connection found") || msg.includes("does not have a native MCP")
      ? 404
      : 502;
    res.status(status).json({ error: msg });
  }
});

export default router;

// ---------------------------------------------------------------------------
// Webhook relay router — mounted separately at /api/webhooks/relay
// Public endpoint (no auth) — third-party services POST here.
// ---------------------------------------------------------------------------

export const webhookRelayRouter = Router();

/**
 * POST /api/webhooks/relay/:subscriptionId
 * Inbound webhook from a third-party service.
 * Responds 200 immediately (acknowledge receipt).
 */
webhookRelayRouter.post("/:subscriptionId", (req, res) => {
  const payload = req.body as Record<string, unknown>;

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    res.status(400).json({ error: "Webhook body must be a JSON object" });
    return;
  }

  // Normalise headers to lowercase string map
  const rawHeaders = req.headers as Record<string, string | string[] | undefined>;
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawHeaders)) {
    if (typeof v === "string") headers[k.toLowerCase()] = v;
    else if (Array.isArray(v)) headers[k.toLowerCase()] = v[0] ?? "";
  }

  // rawBody is attached by the express.json verify callback in app.ts
  const rawBody = (req as unknown as { rawBody?: string }).rawBody ?? "";

  const event = webhookRelay.ingest(req.params.subscriptionId, payload, headers, rawBody);

  if (!event) {
    // Either subscription not found, inactive, or event type not matched — still 200
    // to avoid third-party services retrying unnecessarily
    res.json({ received: true, matched: false });
    return;
  }

  res.json({ received: true, matched: true, eventId: event.id });
});
