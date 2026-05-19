/**
 * AutoFlow Express application.
 * Separated from the server entry-point so the app can be imported
 * in tests without starting a live TCP listener.
 */

import * as Sentry from "@sentry/node";
import express from "express";
import rateLimit from "express-rate-limit";
import multer from "multer";
import cors from "cors";
import helmet from "helmet";
import passport from "passport";
import {
  getTemplate,
  getTemplatesByCategory,
  listTemplates,
  TEMPLATE_MAP,
} from "./templates";
import { WorkflowTemplate, WorkflowStep } from "./types/workflow";
import { workflowEngine } from "./engine/WorkflowEngine";
import { startApprovalResumeCoordinator } from "./engine/approvalResumeCoordinator";
import { startApprovalNotificationCoordinator } from "./engine/approvalNotificationCoordinator";
import { startTicketNotificationCoordinator } from "./engine/ticketSlaCoordinator";
import { runStore } from "./engine/runStore";
import { approvalStore } from "./engine/approvalStore";
import { approvalNotificationStore } from "./engine/approvalNotificationStore";
import approvalPolicyRoutes from "./approvals/policyRoutes";
import llmConfigRoutes from "./llmConfig/llmConfigRoutes";
import { createHostedFreeRoutes } from "./hostedFreeModels/hostedFreeRoutes";
import mcpRoutes from "./mcp/mcpRoutes";
import memoryRoutes from "./memory/memoryRoutes";
import agentMemoryRoutes from "./agents/agentMemoryRoutes";
import agentRoutes from "./agents/agentRoutes";
import { createAgentPresenceRoutes } from "./agents/agentPresenceRoutes";
import { createAgentJobDescriptionRoutes } from "./agents/agentJobDescriptionRoutes";
import { createAgentActionsRoutes } from "./agents/agentActionsRoutes";
import knowledgeRoutes from "./knowledge/routes";
import controlPlaneRoutes from "./controlPlane/controlPlaneRoutes";
import companyRoutes from "./companies/companyRoutes";
import hitlRoutes from "./hitl/hitlRoutes";
import { buildObservabilityCsv, buildObservabilityResponse } from "./observability/service";
import observabilityRoutes from "./observability/routes";
import reportRoutes from "./reporting/reportRoutes";
import ticketRoutes from "./tickets/ticketRoutes";
import ticketSyncRoutes from "./ticketSync/routes";
import ticketSyncWebhookRoutes from "./ticketSync/webhookRoutes";
import { llmConfigStore } from "./llmConfig/llmConfigStore";
import { getProvider } from "./engine/llmProviders";
import { extractStructuredOutput } from "./engine/structuredOutput";
import { parseFile } from "./engine/fileParser";
import { resolveModelForTier } from "./engine/llmRouter";
import {
  getClassificationDecisionLogCapacity,
  listClassificationDecisions,
} from "./engine/classificationLog";
import { requireAuth, requireAuthOrQaBypass, AuthenticatedRequest } from "./auth/authMiddleware";
import { requireEntitlement } from "./middleware/requireEntitlement";
import { requireRole } from "./middleware/requireRole";
import socialAuthRoutes from "./auth/socialAuthRoutes";
import stripeWebhookRoutes from "./billing/stripeWebhook";
import apolloWebhookRoutes from "./integrations/apollo-attio/webhookRoute";
import checkoutRoutes from "./billing/checkoutRoutes";
import {
  buildTeamAssemblyPrompt,
  parseTeamAssemblyResponse,
  teamAssemblyRequestSchema,
} from "./goals/teamAssembly";
import apolloRoutes from "./integrations/apollo/routes";
import hubSpotRoutes, { hubSpotWebhookRouter } from "./integrations/hubspot/routes";
import sentryRoutes, { sentryWebhookRouter } from "./integrations/sentry/routes";
import subscriptionRoutes from "./billing/subscriptionRoutes";
import slackRoutes, { slackWebhookRouter } from "./integrations/slack/routes";
import shopifyRoutes, { shopifyWebhookRouter } from "./integrations/shopify/routes";
import docuSignRoutes, { docuSignWebhookRouter } from "./integrations/docusign/routes";
import linearRoutes, { linearWebhookRouter } from "./integrations/linear/routes";
import teamsRoutes, { teamsWebhookRouter } from "./integrations/teams/routes";
import gmailRoutes, { gmailWebhookRouter } from "./integrations/gmail/routes";
import stripeRoutes, { stripeConnectorWebhookRouter } from "./integrations/stripe/routes";
import posthogRoutes, { posthogWebhookRouter } from "./integrations/posthog/routes";
import intercomRoutes, { intercomWebhookRouter } from "./integrations/intercom/routes";
import { composioRoutes, composioWebhookRouter } from "./integrations/composio";
import agentCatalogRoutes from "./integrations/agent-catalog/routes";
import oauthBridgeRoutes from "./integrations/oauthBridgeRoutes";
import integrationRoutes, {
  catalogRouter as integrationCatalogRoutes,
  oauthCallbackRouter as integrationOAuthCallbackRoutes,
  webhookRelayRouter,
} from "./integrations/integrationRoutes";
import googleWorkspaceConnectorRoutes from "./connectors/google-workspace/routes";
import googleWorkspaceWebhookRoutes from "./connectors/google-workspace/webhookRoutes";
import notificationRoutes from "./notifications/routes";
import { getPostgresPool, isPostgresPersistenceEnabled } from "./db/postgres";
import {
  createExplicitWorkspaceHeaderResolver,
  createWorkspaceResolver,
  WorkspaceAwareRequest,
} from "./middleware/workspaceResolver";
import { createWorkspaceRoutes } from "./workspaces/workspaceRoutes";
import profileRoutes from "./user/profileRoutes";
import { createMissionRoutes } from "./missions/missionRoutes";
import { createHiringPlanRoutes } from "./missions/hiringPlanRoutes";
import { createActivityRoutes } from "./activity/activityRoutes";
import {
  createBudgetsRoutes,
  createConnectorConnectionsRoutes,
  createEntitlementsRoutes,
  createOrgGraphRoutes,
  createStepResultsRoutes,
  createWakeEventsRoutes,
} from "./canonical/canonicalReadRoutes";
import { createWorkflowRoutes } from "./workflows/workflowRoutes";
import { createRoutineRoutes } from "./routines/routineRoutes";
import { createInstructionRoutes } from "./instructions/instructionRoutes";
import { createKnowledgeItemRoutes } from "./knowledge/knowledgeItemRoutes";
import { createEpisodeRoutes } from "./episodes/episodeRoutes";
import { createCuratedKnowledgeRoutes } from "./admin/curatedKnowledgeRoutes";
import { createReflectionRoutes } from "./knowledge/reflectionRoutes";
import {
  createPortableWorkflowBundle,
  getPortableWorkflowSchemaDescriptor,
  parsePortableWorkflowBundle,
} from "./workflows/portableSchema";
import landingPublicApiRoutes from "./landing/publicApiRoutes";
import { requirePersistence } from "./bootstrap";
import { randomUUID } from "crypto";
import { getRunQueue } from "./queue/queues";

import { getImportedTemplate, saveImportedTemplate } from "./templates/importedTemplateStore";
import { getConnectorHealthSummary, listConnectorHealth } from "./connectors/health";

requirePersistence();

// HEL-45: rehydrate in-memory subscription cache from Postgres so the
// store survives a process restart. Fire-and-forget at boot — failures
// only mean the cache rebuilds on the next webhook (Stripe retries).
import("./billing/subscriptionStore")
  .then(({ subscriptionStore }) => subscriptionStore.hydrateFromPostgres())
  .then((count) => {
    if (count > 0) console.log(`[billing] hydrated ${count} subscription(s) from Postgres`);
  })
  .catch((err) => {
    console.warn("[billing] subscription hydration failed:", (err as Error).message);
  });

const app = express();
const workspaceResolver = isPostgresPersistenceEnabled()
  ? createWorkspaceResolver(getPostgresPool())
  : createExplicitWorkspaceHeaderResolver();
const workspaceRoutes = isPostgresPersistenceEnabled()
  ? createWorkspaceRoutes(getPostgresPool())
  : express.Router()
      .get("/", (_req, res) => {
        res.json([]);
      })
      .post("/", (_req, res) => {
        res.status(501).json({ error: "Workspace creation requires PostgreSQL persistence." });
      });

// HEL-24: mission routes (POST /api/missions/:id/generate-plan).
// Requires Postgres for the mission/hiring_plans persistence; in-memory
// mode returns 501 for the generate-plan endpoint. NOTE: actual
// construction is deferred until after the rate-limiter declarations
// below so the LLM limiter can be passed in for the generate-plan
// route only (previously the limiter was applied at the router mount
// and blocked the GET list endpoint too — surfaced as "Too Many
// Requests" on Hire + MissionState).

// HEL-25: hiring plan confirm route (POST /api/hiring-plans/:id/confirm).
// Requires Postgres for the agents + org_edges + activity_events writes;
// in-memory mode returns 501 since the canonical persistence is required.
const hiringPlanRoutes = isPostgresPersistenceEnabled()
  ? createHiringPlanRoutes(getPostgresPool())
  : express.Router().post("/:hiringPlanId/confirm", (_req, res) => {
      res.status(501).json({ error: "Hiring plan confirmation requires PostgreSQL persistence." });
    });

// HEL-29: activity feed route (GET /api/activity-events).
// Polls the canonical activity_events table; SSE/WS promotion is P3.
const activityRoutes = isPostgresPersistenceEnabled()
  ? createActivityRoutes(getPostgresPool())
  : express.Router().get("/", (_req, res) => {
      res.json({ events: [], limit: 0, total: 0 });
    });

// HEL-118: canonical read-only API surfaces. Each one is RLS-scoped at the
// DB; the in-memory fallback returns empty payloads so the dashboard renders
// the empty state instead of crashing.
const canonicalReadsArePostgres = isPostgresPersistenceEnabled();
const orgGraphRoutes = canonicalReadsArePostgres
  ? createOrgGraphRoutes(getPostgresPool())
  : express.Router().get("/", (_req, res) =>
      res.json({ workspaceId: null, agents: [], edges: [] }),
    );
const stepResultsRoutes = canonicalReadsArePostgres
  ? createStepResultsRoutes(getPostgresPool())
  : express.Router().get("/:runId", (_req, res) =>
      res.json({ runId: _req.params.runId, stepResults: [], total: 0 }),
    );
const budgetsRoutes = canonicalReadsArePostgres
  ? createBudgetsRoutes(getPostgresPool())
  : express.Router().get("/", (_req, res) =>
      res.json({ budgets: [], limit: 0, total: 0 }),
    );
const entitlementsRoutes = canonicalReadsArePostgres
  ? createEntitlementsRoutes(getPostgresPool())
  : express.Router().get("/", (_req, res) =>
      res.json({
        workspaceId: null,
        plan: "explore",
        runsPerMonth: 0,
        agentCap: 0,
        integrationCap: 0,
        // Keep this aligned with billing/entitlements.ts → PLAN_LIMITS.explore.
        // The Explore tier now allows BYOK while the hosted free-model
        // path is being built; this display fallback (for non-Postgres
        // dev/test setups) should reflect that so the dashboard's
        // entitlements display matches the real backend enforcement.
        byokAllowed: true,
        logRetentionDays: 7,
        approvalTierMax: 0,
        updatedAt: null,
      }),
    );
const wakeEventsRoutes = canonicalReadsArePostgres
  ? createWakeEventsRoutes(getPostgresPool())
  : express.Router().get("/", (_req, res) =>
      res.json({ events: [], limit: 0, total: 0 }),
    );
const connectorConnectionsRoutes = canonicalReadsArePostgres
  ? createConnectorConnectionsRoutes(getPostgresPool())
  : express.Router().get("/", (_req, res) =>
      res.json({ connections: [], limit: 0, total: 0 }),
    );

// HEL-27: canonical workflow + workflow_version CRUD routes. Sits alongside
// the legacy /api/templates persistence path; the dashboard's Studio
// dual-writes on save so this canonical store fills up as customers
// build routines. Postgres-required (FK chain to workspaces + RLS).
const canonicalWorkflowRoutes = isPostgresPersistenceEnabled()
  ? createWorkflowRoutes(getPostgresPool())
  : express.Router().all("*", (_req, res) =>
      res.status(501).json({ error: "Canonical workflows require PostgreSQL persistence." }),
    );

// HEL-108: routines CRUD — list + enable/disable with BullMQ scheduler sync.
const routineRoutes = isPostgresPersistenceEnabled()
  ? createRoutineRoutes(getPostgresPool(), getRunQueue())
  : express.Router().get("/", (_req, res) => res.json({ routines: [] }));

// HEL-87: three-layer memory routes (instructions / knowledge-items / episodes).
// All three require Postgres for RLS-backed persistence; in-memory mode
// returns 501 for the entire surface.
const memoryRoutesAreLive = isPostgresPersistenceEnabled();
const instructionRoutes = memoryRoutesAreLive
  ? createInstructionRoutes(getPostgresPool())
  : express.Router().all("*", (_req, res) =>
      res.status(501).json({ error: "Workspace instructions require PostgreSQL persistence." }),
    );
const knowledgeItemRoutes = memoryRoutesAreLive
  ? createKnowledgeItemRoutes(getPostgresPool())
  : express.Router().all("*", (_req, res) =>
      res.status(501).json({ error: "Knowledge items require PostgreSQL persistence." }),
    );
const episodeRoutes = memoryRoutesAreLive
  ? createEpisodeRoutes(getPostgresPool())
  : express.Router().all("*", (_req, res) =>
      res.status(501).json({ error: "Agent episodes require PostgreSQL persistence." }),
    );

function parseAllowedOrigins(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter((origin) => origin.length > 0 && origin !== "*");
}

function getAllowedOrigins(): string[] {
  return Array.from(
    new Set([
      ...parseAllowedOrigins(process.env.ALLOWED_ORIGINS),
      ...parseAllowedOrigins(process.env.AUTH_NATIVE_AUTH_PROXY_ALLOWED_ORIGINS),
      ...parseAllowedOrigins(process.env.AUTH_SOCIAL_ALLOWED_REDIRECT_ORIGINS),
      ...parseAllowedOrigins(process.env.SOCIAL_AUTH_DASHBOARD_URL),
    ])
  );
}

const allowedOrigins = new Set(getAllowedOrigins());
const corsOptions: cors.CorsOptions = {
  credentials: true,
  origin: (origin, callback) => {
    if (!origin) {
      callback(null, true);
      return;
    }
    callback(null, allowedOrigins.has(origin));
  },
  // Allow the browser to read Sentry distributed-trace headers so frontend
  // replays can be correlated with backend traces
  exposedHeaders: ["sentry-trace", "baggage"],
};

app.use(helmet());
app.use(cors(corsOptions));

function getAuthenticatedUserId(req: express.Request): string | null {
  const authReq = req as AuthenticatedRequest;
  const userId = authReq.auth?.sub;
  return typeof userId === "string" && userId.trim() ? userId.trim() : null;
}

function getHeaderUserId(req: express.Request): string | null {
  const userId = req.headers["x-user-id"];
  return typeof userId === "string" && userId.trim() ? userId.trim() : null;
}

function getBearerTokenSubject(req: express.Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice(7).trim();
  return token || null;
}

function getRateLimitKey(req: express.Request): string {
  const userId =
    getAuthenticatedUserId(req) ?? getHeaderUserId(req) ?? getBearerTokenSubject(req);
  if (userId) {
    return `user:${userId}`;
  }
  return `ip:${req.ip || req.socket.remoteAddress || "unknown"}`;
}

function createRateLimitHandler(windowMs: number) {
  return (req: express.Request, res: express.Response) => {
    const resetTime = (req as { rateLimit?: { resetTime?: Date } }).rateLimit?.resetTime;
    const resetMs = resetTime ? resetTime.getTime() - Date.now() : windowMs;
    const retryAfterSeconds = Math.max(1, Math.ceil(resetMs / 1000));
    res.setHeader("Retry-After", String(retryAfterSeconds));
    res.status(429).json({ error: "Too Many Requests" });
  };
}

function parsePositiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const generalApiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getRateLimitKey,
  handler: createRateLimitHandler(60 * 1000),
});

const webhookRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `ip:${req.ip || req.socket.remoteAddress || "unknown"}`,
  handler: createRateLimitHandler(60 * 1000),
});

const llmEndpointRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getRateLimitKey,
  handler: createRateLimitHandler(60 * 60 * 1000),
});

// Mission routes — constructed here (not at the top with the other
// route factories) so the LLM rate limiter can be injected for the
// generate-plan endpoint only. See createMissionRoutes() docs.
const missionRoutes = isPostgresPersistenceEnabled()
  ? createMissionRoutes(getPostgresPool(), { llmRouteLimiter: llmEndpointRateLimiter })
  : express.Router().post("/:missionId/generate-plan", (_req, res) => {
      res.status(501).json({ error: "Mission planning requires PostgreSQL persistence." });
    });

const authRouteRateLimitWindowMs = parsePositiveIntegerEnv(
  "AUTH_ROUTE_RATE_LIMIT_WINDOW_MS",
  60 * 1000
);

const authRouteRateLimiter = rateLimit({
  windowMs: authRouteRateLimitWindowMs,
  limit: parsePositiveIntegerEnv("AUTH_ROUTE_RATE_LIMIT_MAX", 20),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `ip:${req.ip || req.socket.remoteAddress || "unknown"}`,
  handler: createRateLimitHandler(authRouteRateLimitWindowMs),
});

const billingMutationRateLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getRateLimitKey,
  skip: (req) => !["POST", "PUT", "PATCH", "DELETE"].includes(req.method),
  skipFailedRequests: true,
  handler: createRateLimitHandler(24 * 60 * 60 * 1000),
});

const knowledgeMutationRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getRateLimitKey,
  skip: (req) => !["POST", "PUT", "PATCH", "DELETE"].includes(req.method),
  skipFailedRequests: true,
  handler: createRateLimitHandler(60 * 60 * 1000),
});

app.use("/api", generalApiRateLimiter);
app.use("/api/webhooks", webhookRateLimiter);
// ---------------------------------------------------------------------------
// Stripe webhook — must be mounted BEFORE express.json() so the raw body
// is available for signature verification
// ---------------------------------------------------------------------------
app.use("/api/webhooks/stripe", express.raw({ type: "application/json" }), stripeWebhookRoutes);
// Slack webhook — mounted before express.json() for signature verification
app.use("/api/webhooks/slack", slackWebhookRouter);
// Shopify webhook — mounted before express.json() for signature verification
app.use("/api/webhooks/shopify", shopifyWebhookRouter);
// DocuSign webhook — mounted before express.json() for signature verification
app.use("/api/webhooks/docusign", docuSignWebhookRouter);
// Linear webhook — mounted before express.json() for signature verification
app.use("/api/webhooks/linear", linearWebhookRouter);
// Sentry webhook — mounted before express.json() for signature verification
app.use("/api/webhooks/sentry", sentryWebhookRouter);
// Gmail webhook — mounted before express.json() for Pub/Sub verification
app.use("/api/webhooks/gmail", gmailWebhookRouter);
// Microsoft Teams webhook — mounted before express.json() for signature verification
app.use("/api/webhooks/teams", teamsWebhookRouter);
// HubSpot webhook — mounted before express.json() for signature verification
app.use("/api/webhooks/hubspot", hubSpotWebhookRouter);
// Composio webhook — mounted before express.json() for signature verification
app.use("/api/webhooks/composio", composioWebhookRouter);
// Stripe connector webhook — mounted before express.json() for signature verification
app.use("/api/webhooks/stripe/connect", stripeConnectorWebhookRouter);
// PostHog webhook — mounted before express.json() for signature verification
app.use("/api/webhooks/posthog", posthogWebhookRouter);
// Intercom webhook — mounted before express.json() for signature verification
app.use("/api/webhooks/intercom", intercomWebhookRouter);
// Composio webhook — mounted before express.json() because the route verifies the raw payload
app.use("/api/webhooks/ticket-sync", ticketSyncWebhookRoutes);
app.use("/api/connectors/google-workspace", googleWorkspaceWebhookRoutes);

app.use(express.json());
app.use(passport.initialize());

// Track HTTP request duration, counts, and errors as Sentry custom metrics.
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    const endpoint = req.path
      .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "/:id")
      .replace(/\/\d{4,}/g, "/:id");
    const attributes = { method: req.method, endpoint };
    Sentry.metrics.distribution("http.request_duration_ms", duration, {
      unit: "millisecond",
      attributes: { ...attributes, status: String(res.statusCode) },
    });
    Sentry.metrics.count("http.request", 1, { attributes });
    if (res.statusCode >= 500) {
      Sentry.metrics.count("http.error", 1, {
        attributes: { ...attributes, status: String(res.statusCode) },
      });
      Sentry.logger.error(`${req.method} ${endpoint} → ${res.statusCode} (${duration}ms)`, {
        method: req.method, endpoint, status: res.statusCode, duration,
      });
    } else if (res.statusCode >= 400) {
      Sentry.metrics.count("http.error", 1, {
        attributes: { ...attributes, status: String(res.statusCode) },
      });
      Sentry.logger.warn(`${req.method} ${endpoint} → ${res.statusCode} (${duration}ms)`, {
        method: req.method, endpoint, status: res.statusCode, duration,
      });
    } else {
      Sentry.logger.info(`${req.method} ${endpoint} → ${res.statusCode} (${duration}ms)`, {
        method: req.method, endpoint, status: res.statusCode, duration,
      });
    }
  });
  next();
});

// Propagate authenticated user identity into Sentry scope so all errors
// and logs captured after auth are attributed to the correct user.
app.use((req, _res, next) => {
  const authReq = req as unknown as AuthenticatedRequest;
  if (authReq.auth?.sub) {
    Sentry.setUser({ id: authReq.auth.sub, email: authReq.auth.email });
  }
  next();
});

// Multer — in-memory storage for file uploads (max 50 MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

// ---------------------------------------------------------------------------
// Apollo webhook — receives Apollo email reply events → syncs to Attio
// ---------------------------------------------------------------------------
app.use("/api/webhooks/apollo", apolloWebhookRoutes);

// ---------------------------------------------------------------------------
// Billing API — Stripe checkout sessions + subscription lifecycle
// ---------------------------------------------------------------------------
// HEL-69: billing is workspace-scoped per the canonical role mapping (Stripe
// customer ID lives on the workspace; see HEL-22 entitlements). requireRole
// ensures only members with the billing role can manage subscriptions.
app.use("/api/billing/checkout", requireAuth, workspaceResolver, requireRole("billing"), billingMutationRateLimiter, checkoutRoutes);
app.use("/api/billing/subscription", requireAuth, workspaceResolver, requireRole("billing"), billingMutationRateLimiter, subscriptionRoutes);
app.use("/api/public/landing", landingPublicApiRoutes);

// ---------------------------------------------------------------------------
// LLM Config API — BYOLLM provider credentials
// ---------------------------------------------------------------------------
app.use("/api/llm-configs", requireAuth, workspaceResolver, requireRole("admin", "developer"), llmConfigRoutes);
// HEL-117: canonical noun alias (table is `llm_credentials` in migration 025).
// Both paths resolve to the same router until the dashboard fully migrates;
// then `/api/llm-configs` becomes a legacy alias for one release before removal.
app.use("/api/llm-credentials", requireAuth, workspaceResolver, requireRole("admin", "developer"), llmConfigRoutes);

// ---------------------------------------------------------------------------
// Hosted free model catalog (PR B.1) + per-workspace daily token usage
// (PR B.2). Read-only catalog of the three free tiers AutoFlow offers
// out of the box for Explore workspaces. Engine fallback in
// src/engine/stepHandlers.ts uses this catalog to route LLM steps when
// a workspace has no BYOK config configured. workspaceResolver is
// required so the GET handler can surface the active workspace's
// daily token usage in the response.
// ---------------------------------------------------------------------------
app.use(
  "/api/hosted-free-models",
  requireAuth,
  workspaceResolver,
  createHostedFreeRoutes(),
);

// ---------------------------------------------------------------------------
// MCP Registry API — register and discover MCP server connections
// ---------------------------------------------------------------------------
app.use("/api/mcp/servers", requireAuth, workspaceResolver, requireRole("admin", "developer"), mcpRoutes);

// ---------------------------------------------------------------------------
// Memory API — persistent context memory store for agents/workflows
// ---------------------------------------------------------------------------
app.use("/api/memory", requireAuth, workspaceResolver, requireRole("admin", "developer"), memoryRoutes);
app.use("/api/agents/:agentId/memory", requireAuth, workspaceResolver, requireRole("admin", "developer"), agentMemoryRoutes);
// Wave 2a: live agent presence (Redis-backed). Mounted BEFORE the
// catch-all agentRoutes so the /presence paths win the match. Reader
// is open to any workspace member; the role gate matches the rest of
// the agent surface for now.
//
// Wave 2b SSE: EventSource has no header API, so the stream endpoint
// accepts the token via ?access_token=… as well. This shim runs before
// the standard auth chain and promotes the query token into the
// Authorization header so the rest of the middleware stack works
// unchanged. Scoped narrowly to /api/agents/presence/stream.
app.use("/api/agents/presence/stream", (req, _res, next) => {
  if (!req.headers.authorization) {
    const queryToken = (req.query?.access_token as string | undefined) ?? "";
    if (queryToken) {
      req.headers.authorization = `Bearer ${queryToken}`;
    }
  }
  next();
});
app.use("/api/agents", requireAuth, workspaceResolver, requireRole("admin", "developer"), createAgentPresenceRoutes());
// Wave 3: Job Description wizard (calls the workspace's default LLM
// to draft a 3-section markdown body from four short answers). Mount
// before the catch-all agentRoutes so the /:agentId/job-description/
// path wins the match. Saving the draft uses the existing
// /api/instructions write surface.
//
// Gated on Postgres being configured (same pattern as instructionRoutes
// above) so tests / in-memory-only deploys don't fail at module-load
// time. In-memory mode returns 501 across the wizard surface.
const agentJobDescriptionRoutes = isPostgresPersistenceEnabled()
  ? createAgentJobDescriptionRoutes(getPostgresPool())
  : // DASH-26: same scoping as agentActionsRoutes below — `.all("*")`
    // would hijack every /api/agents/* path including /budget,
    // /heartbeat, /runs that belong to agentRoutes mounted later.
    makePgGatedFallback("Job description wizard", [
      "/:agentId/job-description/draft",
    ]);
app.use("/api/agents", requireAuth, workspaceResolver, requireRole("admin", "developer"), agentJobDescriptionRoutes);
// Wave 5: agent action routes — POST /:agentId/check-in and
// /:agentId/handoff. Both create a mission_assignment ticket through
// the existing ticketStore; check-in additionally flips presence to
// "checking-in" so the dashboard pill reflects the request. Same
// Postgres gating as the wizard above.
//
// DASH-26: when Postgres is unavailable the fallback router MUST
// scope its 501 to the action paths it owns — an `.all("*")` would
// hijack every /api/agents/* request and short-circuit the
// agentRoutes mount immediately below (so /budget, /heartbeat,
// /runs et al. would all 501 too, which is what's been breaking
// the CI test suite + blocking every dev Fly deploy since DASH-14).
const PG_GATED_AGENT_ACTION_PATHS = [
  "/priority-classify",
  "/:agentId/check-in",
  "/:agentId/handoff",
];
function makePgGatedFallback(label: string, paths: string[]) {
  const router = express.Router();
  for (const path of paths) {
    router.all(path, (_req, res) =>
      res.status(501).json({ error: `${label} requires PostgreSQL persistence.` }),
    );
  }
  return router;
}
const agentActionsRoutes = isPostgresPersistenceEnabled()
  ? createAgentActionsRoutes(getPostgresPool())
  : makePgGatedFallback("Agent actions", PG_GATED_AGENT_ACTION_PATHS);
app.use("/api/agents", requireAuth, workspaceResolver, requireRole("admin", "developer"), agentActionsRoutes);
app.use("/api/agents", requireAuth, workspaceResolver, requireRole("admin", "developer"), agentRoutes);
app.use("/api/integrations/apollo", apolloRoutes);

// HEL-108: routines CRUD (list + enable/disable).
app.use("/api/routines", requireAuth, workspaceResolver, requireRole("admin", "developer"), routineRoutes);
app.use("/api/knowledge", requireAuth, workspaceResolver, requireRole("admin", "developer"), knowledgeMutationRateLimiter, knowledgeRoutes);
app.use("/api/integrations/catalog", integrationCatalogRoutes);
app.use("/api/integrations/oauth2", integrationOAuthCallbackRoutes);
app.use("/api/integrations", requireAuth, workspaceResolver, requireRole("admin", "developer"), integrationRoutes);
app.use("/api/webhooks/relay", webhookRelayRouter);
app.use("/api/integrations", oauthBridgeRoutes);
app.use("/api/integrations/slack", slackRoutes);
app.use("/api/integrations/shopify", shopifyRoutes);
app.use("/api/integrations/docusign", docuSignRoutes);
app.use("/api/integrations/linear", linearRoutes);
app.use("/api/integrations/sentry", sentryRoutes);
app.use("/api/integrations/hubspot", hubSpotRoutes);
app.use("/api/integrations/teams", teamsRoutes);
app.use("/api/integrations/gmail", gmailRoutes);
app.use("/api/integrations/stripe", stripeRoutes);
app.use("/api/integrations/composio", composioRoutes);
app.use("/api/integrations/posthog", posthogRoutes);
app.use("/api/integrations/intercom", intercomRoutes);
app.use("/api/integrations/agent-catalog", agentCatalogRoutes);
app.use("/api/connectors/google-workspace", googleWorkspaceConnectorRoutes);
// user-scoped: workspace management creates/lists workspaces and cannot itself be workspace-gated
app.use("/api/workspaces", requireAuth, workspaceRoutes);
// DASH-41: mount profileRoutes (GET/PATCH/PUT /api/user/profile). Previously
// the router was authored + tested but never wired in, so ProfileSettings
// 404'd on every save and fell back to sessionStorage with a misleading
// "backend endpoint pending" toast. Postgres-backed via profileStore.
app.use("/api/user", requireAuth, profileRoutes);
// llmEndpointRateLimiter is now applied INSIDE missionRoutes on the
// generate-plan POST only (see createMissionRoutes). Mounting it
// here would re-block the cheap GET list endpoint that the dashboard
// polls on Hire + MissionState page loads.
app.use("/api/missions", requireAuth, workspaceResolver, requireRole("admin", "developer"), missionRoutes);
// HEL-25: hiring-plan confirm uses the same auth + workspace + role gate.
// requireRole gates this to admin/developer so a billing-only seat can't
// provision agents that incur LLM cost.
app.use("/api/hiring-plans", requireAuth, workspaceResolver, requireRole("admin", "developer"), hiringPlanRoutes);
// HEL-29: activity feed. Any authenticated workspace member can read the
// activity stream — it's the workspace-wide "room right now" surface. We
// enumerate every workspace role explicitly to satisfy the CI guard that
// requires a requireRole() declaration on every authenticated mount; the
// surface itself is RLS-scoped to the workspace and the requireRole call is
// effectively a no-op pass-through across all valid roles.
app.use(
  "/api/activity-events",
  requireAuth,
  workspaceResolver,
  requireRole("owner", "admin", "billing", "operator", "developer", "approver", "member"),
  activityRoutes,
);
// HEL-118: canonical read-only surfaces. Same role enumeration pattern as
// activity-events — read-only + RLS-scoped, every workspace member can read.
const ALL_MEMBER_ROLES = [
  "owner",
  "admin",
  "billing",
  "operator",
  "developer",
  "approver",
  "member",
] as const;
app.use(
  "/api/org-graph",
  requireAuth,
  workspaceResolver,
  requireRole(...ALL_MEMBER_ROLES),
  orgGraphRoutes,
);
// HEL-118: step-results is mounted under /api/step-results (not /api/runs/...)
// to avoid colliding with the legacy /api/runs/:id endpoint which uses
// requireAuthOrQaBypass and its own workspaceResolver chain.
app.use(
  "/api/step-results",
  requireAuth,
  workspaceResolver,
  requireRole(...ALL_MEMBER_ROLES),
  stepResultsRoutes,
);
app.use(
  "/api/budgets",
  requireAuth,
  workspaceResolver,
  requireRole(...ALL_MEMBER_ROLES),
  budgetsRoutes,
);
app.use(
  "/api/entitlements",
  requireAuth,
  workspaceResolver,
  requireRole(...ALL_MEMBER_ROLES),
  entitlementsRoutes,
);
app.use(
  "/api/wake-events",
  requireAuth,
  workspaceResolver,
  requireRole(...ALL_MEMBER_ROLES),
  wakeEventsRoutes,
);
app.use(
  "/api/connector-connections",
  requireAuth,
  workspaceResolver,
  requireRole(...ALL_MEMBER_ROLES),
  connectorConnectionsRoutes,
);
// HEL-27 canonical workflows router is mounted further below, AFTER the
// pre-existing /api/workflows/schema + /api/workflows/generate specific
// handlers, so those don't get intercepted by the :workflowId param.
// HEL-87: three-layer memory.
app.use("/api/instructions", requireAuth, workspaceResolver, requireRole("admin", "developer", "operator"), instructionRoutes);
app.use("/api/knowledge-items", requireAuth, workspaceResolver, requireRole("admin", "developer", "operator"), knowledgeItemRoutes);
app.use("/api/episodes", requireAuth, workspaceResolver, requireRole("admin", "developer", "operator"), episodeRoutes);
// HEL-93: AutoFlow staff admin — curated global knowledge tier. No workspace
// scope (cross-workspace by design); requireStaff gates access via the
// AUTOFLOW_STAFF_USER_IDS env-var allowlist.
const curatedKnowledgeRoutes = isPostgresPersistenceEnabled()
  ? createCuratedKnowledgeRoutes(getPostgresPool())
  : express.Router().all("*", (_req, res) =>
      res.status(501).json({ error: "Curated knowledge requires PostgreSQL persistence." }),
    );
app.use("/api/admin/curated-knowledge", requireAuth, curatedKnowledgeRoutes);
// HEL-91: manual reflection — clusters unreflected episodes and graduates
// durable patterns to Layer-2 synthesized knowledge_items.
const reflectionRoutes = isPostgresPersistenceEnabled()
  ? createReflectionRoutes(getPostgresPool())
  : express.Router().all("*", (_req, res) =>
      res.status(501).json({ error: "Reflection requires PostgreSQL persistence." }),
    );
app.use("/api/knowledge/reflect", requireAuth, workspaceResolver, requireRole("admin", "operator"), reflectionRoutes);
app.use("/api/companies", requireAuth, workspaceResolver, requireRole("admin", "developer"), companyRoutes);
app.use("/api/control-plane", requireAuth, workspaceResolver, requireRole("admin", "operator"), controlPlaneRoutes);
app.use("/api/hitl", requireAuth, workspaceResolver, requireRole("admin", "approver", "operator"), hitlRoutes);
app.use("/api/observability", requireAuth, workspaceResolver, requireRole("admin", "operator"), observabilityRoutes);
app.use("/api/reporting", requireAuth, workspaceResolver, requireRole("admin", "operator"), reportRoutes);
app.use("/api/tickets", requireAuth, workspaceResolver, requireRole("admin", "operator"), ticketRoutes);
app.use("/api/ticket-sync", requireAuth, workspaceResolver, requireRole("admin", "operator"), ticketSyncRoutes);
app.use("/api/notifications", requireAuth, workspaceResolver, requireRole("admin", "operator"), notificationRoutes);
app.use("/api/approval-policies", requireAuth, workspaceResolver, requireRole("admin", "approver", "operator"), approvalPolicyRoutes);

// (HEL-118 canonical-reads mounts live in the earlier block alongside their
// requireRole(...ALL_MEMBER_ROLES) gates; do not re-mount here.)

// ---------------------------------------------------------------------------
// Auth API — identity and social callback endpoints
// ---------------------------------------------------------------------------

app.use("/api/auth/social", authRouteRateLimiter, socialAuthRoutes);

/** Returns the authenticated user's claims extracted from the auth token. */
app.get("/api/me", requireAuth, (req: AuthenticatedRequest, res) => {
  res.json({ user: req.auth });
});

// ---------------------------------------------------------------------------
// Templates API — used by the dashboard UI
// ---------------------------------------------------------------------------

/** List all templates (optionally filtered by category) */
app.get("/api/templates", (req, res) => {
  const { category } = req.query;
  let templates: WorkflowTemplate[];

  if (category && typeof category === "string") {
    templates = getTemplatesByCategory(category as WorkflowTemplate["category"]);
  } else {
    templates = listTemplates();
  }

  res.json({
    templates: templates.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      category: t.category,
      version: t.version,
      stepCount: t.steps.length,
      configFieldCount: t.configFields.length,
    })),
    total: templates.length,
  });
});

/** Create or update a user-managed template */
app.post("/api/templates", requireAuth, async (req, res) => {
  const payload = req.body as Partial<WorkflowTemplate> | null;
  if (!payload || typeof payload !== "object") {
    res.status(400).json({ error: "Template payload is required" });
    return;
  }

  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  const description = typeof payload.description === "string" ? payload.description : "";
  const category = typeof payload.category === "string" ? payload.category : "custom";
  const version = typeof payload.version === "string" && payload.version.trim() ? payload.version : "1.0.0";
  const steps = Array.isArray(payload.steps) ? payload.steps : [];
  const configFields = Array.isArray(payload.configFields) ? payload.configFields : [];
  const sampleInput =
    payload.sampleInput && typeof payload.sampleInput === "object" && !Array.isArray(payload.sampleInput)
      ? (payload.sampleInput as Record<string, unknown>)
      : {};
  const expectedOutput =
    payload.expectedOutput && typeof payload.expectedOutput === "object" && !Array.isArray(payload.expectedOutput)
      ? (payload.expectedOutput as Record<string, unknown>)
      : {};

  if (!name) {
    res.status(400).json({ error: "Template name is required" });
    return;
  }

  let nextId =
    typeof payload.id === "string" && payload.id.trim()
      ? payload.id.trim()
      : `tpl-custom-${Date.now()}`;

  const importedTemplate = getImportedTemplate(nextId);
  const builtInTemplateExists = Boolean(TEMPLATE_MAP[nextId]);
  if (builtInTemplateExists && !importedTemplate) {
    nextId = `${nextId}-custom-${Date.now()}`;
  }

  const template: WorkflowTemplate = {
    id: nextId,
    name,
    description,
    category: category as WorkflowTemplate["category"],
    version,
    configFields,
    steps,
    sampleInput,
    expectedOutput,
  };

  await saveImportedTemplate(template);
  res.status(importedTemplate ? 200 : 201).json(template);
});

/** Returns the current portable workflow schema contract */
app.get("/api/workflows/schema", (_req, res) => {
  res.json(getPortableWorkflowSchemaDescriptor());
});

/** Get a single template with full definition */
app.get("/api/templates/:id", (req, res) => {
  try {
    const template = getTemplate(req.params.id);
    res.json(template);
  } catch {
    res.status(404).json({ error: `Template not found: ${req.params.id}` });
  }
});

/** Export a template in the portable AutoFlow workflow format */
app.get("/api/templates/:id/export", (req, res) => {
  try {
    const template = getTemplate(req.params.id);
    res.json(createPortableWorkflowBundle(template));
  } catch {
    res.status(404).json({ error: `Template not found: ${req.params.id}` });
  }
});

/** Import a portable workflow template into the in-memory registry */
app.post("/api/templates/import", requireAuth, async (req, res) => {
  let bundle;
  try {
    bundle = parsePortableWorkflowBundle(req.body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid portable workflow payload";
    res.status(400).json({ error: message });
    return;
  }

  try {
    getTemplate(bundle.template.id);
    res.status(409).json({ error: `Template already exists: ${bundle.template.id}` });
    return;
  } catch {
    // Template id is available; continue with import.
  }

  await saveImportedTemplate(bundle.template);
  res.status(201).json({
    imported: true,
    template: bundle.template,
    schemaVersion: bundle.schemaVersion,
  });
});

/** Get sample data for a template (for dashboard preview) */
app.get("/api/templates/:id/sample", (req, res) => {
  try {
    const template = getTemplate(req.params.id);
    res.json({
      sampleInput: template.sampleInput,
      expectedOutput: template.expectedOutput,
    });
  } catch {
    res.status(404).json({ error: `Template not found: ${req.params.id}` });
  }
});

// ---------------------------------------------------------------------------
// Runs API — execute and monitor workflow runs
// ---------------------------------------------------------------------------

/**
 * Start a new workflow run.
 * Body: { templateId, input, config? }
 * Returns the new run (status=pending) immediately; execution is async.
 */
app.post(
  "/api/runs",
  requireAuthOrQaBypass,
  workspaceResolver,
  llmEndpointRateLimiter,
  requireEntitlement("runsPerMonth", {
    getCurrent: (req) => runStore.countByWorkspaceCurrentMonth(req.workspace!.id),
    delta: 1,
  }),
  async (req: WorkspaceAwareRequest, res) => {
  const { templateId, input, config } = req.body as {
    templateId?: string;
    input?: Record<string, unknown>;
    config?: Record<string, unknown>;
  };

  if (!templateId) {
    res.status(400).json({ error: "templateId is required" });
    return;
  }

  let template: WorkflowTemplate;
  try {
    template = getTemplate(templateId);
  } catch {
    res.status(404).json({ error: `Template not found: ${templateId}` });
    return;
  }

  const userId = req.auth?.sub;
  const resolvedInput = { ...(input ?? {}) };
  if (req.workspaceId) {
    resolvedInput.workspaceId = req.workspaceId;
  }
  const resolvedConfig = req.workspaceId ? { ...(config ?? {}), workspaceId: req.workspaceId } : config;

  const runQueue = getRunQueue();
  if (runQueue) {
    // BullMQ path: create the run record with status "queued" and enqueue.
    // The worker (src/worker.ts) picks it up for execution.
    const defaultConfig: Record<string, unknown> = {};
    for (const field of template.configFields) {
      if (field.defaultValue !== undefined) defaultConfig[field.key] = field.defaultValue;
    }
    const runConfig = { ...defaultConfig, ...(resolvedConfig ?? {}) };
    const runId = randomUUID();
    const run = await runStore.create({
      id: runId,
      templateId: template.id,
      templateName: template.name,
      workspaceId: req.workspaceId,
      status: "queued",
      startedAt: new Date().toISOString(),
      input: resolvedInput,
      workflowDag: template,
      stepResults: [],
      runtimeState: {
        config: { ...runConfig },
        context: { ...runConfig, ...resolvedInput },
        currentStepIndex: 0,
      },
      ...(userId !== undefined ? { userId } : {}),
    });
    const idempotencyKey = `${run.id}:0:${run.workflowVersionId ?? template.id}`;
    await runQueue.add(
      "run",
      {
        runId: run.id,
        templateId: template.id,
        workflowVersionId: run.workflowVersionId,
        workspaceId: req.workspaceId ?? "",
        stepIndex: 0,
        idempotencyKey,
      },
      { jobId: run.id, removeOnComplete: 100 }
    );
    res.status(202).json({ runId: run.id });
    return;
  }

  // Legacy in-process path (used when Redis is not configured).
  const run = await workflowEngine.startRun(template, resolvedInput, resolvedConfig, userId);
  res.status(202).json(run);
});

/** List all runs, optionally filtered by templateId or status */
app.get("/api/runs", requireAuthOrQaBypass, workspaceResolver, async (req: WorkspaceAwareRequest, res) => {
  const { templateId, status } = req.query;
  const runs = await runStore.list(
    typeof templateId === "string" ? templateId : undefined,
    req.auth?.sub,
    typeof status === "string" ? status : undefined
  );
  res.json({ runs, total: runs.length });
});

/** Get a single run by ID */
app.get("/api/runs/:id", requireAuthOrQaBypass, workspaceResolver, async (req: WorkspaceAwareRequest, res) => {
  const run = await runStore.get(req.params.id);
  const userId = req.auth?.sub;
  if (!run || (run.userId !== undefined && run.userId !== userId)) {
    res.status(404).json({ error: `Run not found: ${req.params.id}` });
    return;
  }
  res.json(run);
});

/**
 * Cancel a queued (not yet running) run.
 * Removes the BullMQ job if it is still waiting, then marks the run canceled.
 * Returns 409 if the run has already started or finished.
 */
app.delete("/api/runs/:id/cancel", requireAuthOrQaBypass, workspaceResolver, async (req: WorkspaceAwareRequest, res) => {
  const runId = req.params.id;
  const run = await runStore.get(runId);
  const userId = req.auth?.sub;

  if (!run || (run.userId !== undefined && run.userId !== userId)) {
    res.status(404).json({ error: `Run not found: ${runId}` });
    return;
  }

  if (run.status !== "queued" && run.status !== "pending") {
    res.status(409).json({ error: `Run cannot be canceled: status is '${run.status}'` });
    return;
  }

  const runQueue = getRunQueue();
  if (runQueue) {
    try {
      const job = await runQueue.getJob(runId);
      if (job) {
        await job.remove();
      }
    } catch {
      // Job may already be gone; continue to update DB status.
    }
  }

  const canceled = await runStore.update(runId, { status: "canceled", completedAt: new Date().toISOString() });
  res.json(canceled);
});

/**
 * Re-enqueue a failed run from the DLQ.
 * Resets status to "queued" and re-adds the job to the main runs queue.
 * Returns 409 if the run is not in the "failed" state.
 */
app.post("/api/runs/:id/retry", requireAuthOrQaBypass, workspaceResolver, async (req: WorkspaceAwareRequest, res) => {
  const runId = req.params.id;
  const run = await runStore.get(runId);
  const userId = req.auth?.sub;

  if (!run || (run.userId !== undefined && run.userId !== userId)) {
    res.status(404).json({ error: `Run not found: ${runId}` });
    return;
  }

  if (run.status !== "failed") {
    res.status(409).json({ error: `Run cannot be retried: status is '${run.status}'` });
    return;
  }

  const runQueue = getRunQueue();
  if (!runQueue) {
    res.status(503).json({ error: "Queue unavailable: retry requires an active Redis connection" });
    return;
  }

  // BullMQ keeps failed jobs until removeOnFail is exhausted, so a re-add
  // with the same jobId silently no-ops. Remove the stale failed job first
  // so the retry actually lands in the waiting set.
  try {
    const staleJob = await runQueue.getJob(runId);
    if (staleJob) {
      await staleJob.remove();
    }
  } catch {
    // If we cannot remove the stale job the re-add with the same jobId would
    // silently no-op (BullMQ deduplicates by jobId), so fail fast rather than
    // marking the run "queued" with no worker execution backing it.
    res.status(503).json({ error: "Failed to clear stale job; retry aborted" });
    return;
  }

  await runQueue.add(
    "run",
    {
      runId,
      templateId: run.templateId,
      workflowVersionId: run.workflowVersionId,
      workspaceId: run.workspaceId ?? "",
      stepIndex: 0,
      idempotencyKey: `${runId}:retry:${Date.now()}`,
    },
    { jobId: runId }
  );

  const updated = await runStore.update(runId, {
    status: "queued",
    completedAt: undefined,
    error: undefined,
  });
  res.json(updated);
});

/**
 * Re-run a finished run using the CURRENT (latest) workflow version.
 * Creates a fresh run record and enqueues it. Use /retry to replay with the
 * original version instead.
 */
app.post("/api/runs/:id/replay-with-latest", requireAuthOrQaBypass, workspaceResolver, async (req: WorkspaceAwareRequest, res) => {
  const runId = req.params.id;
  const run = await runStore.get(runId);
  const userId = req.auth?.sub;

  if (!run || (run.userId !== undefined && run.userId !== userId)) {
    res.status(404).json({ error: `Run not found: ${runId}` });
    return;
  }

  if (run.status === "running" || run.status === "queued") {
    res.status(409).json({ error: `Run cannot be replayed while in status '${run.status}'` });
    return;
  }

  // Resolve the latest DAG: prefer the DB-stored latest version when available.
  let latestDag: WorkflowTemplate | Record<string, unknown> | undefined;
  if (run.workflowId && isPostgresPersistenceEnabled()) {
    try {
      const pool = getPostgresPool();
      const result = await pool.query<{ dag: unknown }>(
        `SELECT wv.dag
           FROM workflow_versions wv
           JOIN workflows w ON w.latest_version_id = wv.id
          WHERE w.id = $1::uuid`,
        [run.workflowId]
      );
      if (result.rows[0]) {
        latestDag = result.rows[0].dag as Record<string, unknown>;
      }
    } catch (err) {
      console.error("[runs] replay-with-latest DB lookup failed:", (err as Error).message);
    }
  }

  if (!latestDag) {
    try {
      latestDag = getTemplate(run.templateId);
    } catch {
      res.status(404).json({ error: `Original template not found: ${run.templateId}` });
      return;
    }
  }

  const newRunId = randomUUID();
  const newRun = await runStore.create({
    id: newRunId,
    templateId: run.templateId,
    templateName: run.templateName,
    workspaceId: run.workspaceId,
    routineId: run.routineId,
    status: "queued",
    startedAt: new Date().toISOString(),
    input: run.input,
    workflowDag: latestDag,
    stepResults: [],
    runtimeState: {
      config: run.runtimeState?.config ?? {},
      context: { ...(run.runtimeState?.config ?? {}), ...run.input },
      currentStepIndex: 0,
    },
    ...(userId !== undefined ? { userId } : {}),
  });

  const runQueue = getRunQueue();
  if (runQueue) {
    const idempotencyKey = `${newRun.id}:0:replay-latest:${Date.now()}`;
    await runQueue.add(
      "run",
      {
        runId: newRun.id,
        templateId: run.templateId,
        workflowVersionId: newRun.workflowVersionId,
        workspaceId: run.workspaceId ?? "",
        stepIndex: 0,
        idempotencyKey,
      },
      { jobId: newRun.id, removeOnComplete: 100 }
    );
    res.status(202).json({ runId: newRun.id });
    return;
  }

  res.status(202).json(newRun);
});

app.get("/api/observability", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.auth?.sub;
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const runs = await runStore.list(undefined, userId);
  // DASH-64.1: now async — see buildObservabilityResponse.
  const response = await buildObservabilityResponse(userId, runs, {
    agentId: typeof req.query.agentId === "string" ? req.query.agentId : undefined,
    taskId: typeof req.query.taskId === "string" ? req.query.taskId : undefined,
    search: typeof req.query.search === "string" ? req.query.search : undefined,
    from: typeof req.query.from === "string" ? req.query.from : undefined,
    to: typeof req.query.to === "string" ? req.query.to : undefined,
  });

  if (req.query.format === "csv") {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="observability-export.csv"');
    res.send(buildObservabilityCsv(response.records));
    return;
  }

  res.json(response);
});

// ---------------------------------------------------------------------------
// Routing analytics API — recent classifier decisions for dashboarding
// ---------------------------------------------------------------------------

app.get("/api/analytics/routing-decisions", requireAuth, (_req, res) => {
  const decisions = listClassificationDecisions();
  res.json({
    decisions,
    total: decisions.length,
    capacity: getClassificationDecisionLogCapacity(),
  });
});

// ---------------------------------------------------------------------------
// File-triggered runs — multipart upload → parse → start run
// ---------------------------------------------------------------------------

/**
 * POST /api/runs/file
 * Multipart body: { templateId: string, file: <binary> }
 * Uses the authenticated user or staging QA bypass user ID as the run owner.
 *
 * Parses the uploaded file (PDF/image/audio/text) into text content, then
 * starts a workflow run with { content, mimeType, filename } injected as input.
 * Returns the created run (status=pending).
 */
app.post("/api/runs/file", requireAuthOrQaBypass, workspaceResolver, upload.single("file"), async (req: WorkspaceAwareRequest, res) => {
  const { templateId } = req.body as { templateId?: string };

  if (!templateId) {
    res.status(400).json({ error: "templateId is required" });
    return;
  }

  if (!req.file) {
    res.status(400).json({ error: "file is required (multipart field: file)" });
    return;
  }

  let template: WorkflowTemplate;
  try {
    template = getTemplate(templateId);
  } catch {
    res.status(404).json({ error: `Template not found: ${templateId}` });
    return;
  }

  // Resolve an OpenAI key from the user's default LLM config (for vision/Whisper)
  const userId = req.auth?.sub;
  let openaiApiKey: string | undefined;
  if (userId) {
    const defaultConfig = await llmConfigStore.getDecryptedDefault(userId);
    if (defaultConfig?.config.provider === "openai") {
      openaiApiKey = defaultConfig.apiKey;
    }
  }

  let parsed;
  try {
    parsed = await parseFile(
      req.file.buffer,
      req.file.mimetype,
      req.file.originalname,
      { openaiApiKey }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(422).json({ error: `File parsing failed: ${msg}` });
    return;
  }

  const input: Record<string, unknown> = {
    content: parsed.content,
    mimeType: parsed.mimeType,
    filename: parsed.filename,
  };
  if (req.workspaceId) {
    input.workspaceId = req.workspaceId;
  }

  const run = await workflowEngine.startRun(template, input, undefined, userId);
  res.status(202).json(run);
});

// ---------------------------------------------------------------------------
// Workflow generation — NL description → DAG steps via LLM
// ---------------------------------------------------------------------------

const GENERATE_SYSTEM_PROMPT = `You are AutoFlow's workflow designer. Given a plain-English description of a business process, return a JSON array of workflow steps.

Each step MUST follow this schema (all fields required unless marked optional):
{
  "id": string,          // unique, e.g. "step-1", "step-2"
  "name": string,        // short human-readable name
  "kind": one of "trigger" | "llm" | "transform" | "condition" | "action" | "output",
  "description": string, // one sentence
  "inputKeys": string[], // keys consumed from prior steps
  "outputKeys": string[], // keys this step produces
  "promptTemplate"?: string,  // required for kind=llm, supports {{key}} interpolation
  "condition"?: string,       // required for kind=condition, JS boolean expression
  "action"?: string           // required for kind=action, e.g. "email.send", "crm.upsertLead"
}

Rules:
- First step must be kind="trigger" with no inputKeys.
- Last step should be kind="output" or kind="action".
- Wire inputKeys/outputKeys so data flows logically.
- Return ONLY the JSON array, no markdown fences, no commentary.`;

/**
 * POST /api/workflows/generate
 * Body: { description: string, llmConfigId?: string }
 * Uses the authenticated JWT subject to resolve the user's LLM config.
 * Returns: { steps: WorkflowStep[] }
 */
app.post("/api/workflows/generate", requireAuth, workspaceResolver, requireRole("admin", "developer"), llmEndpointRateLimiter, async (req: WorkspaceAwareRequest, res) => {
  const { description, llmConfigId } = req.body as {
    description?: unknown;
    llmConfigId?: unknown;
  };

  if (typeof description !== "string" || !description.trim()) {
    res.status(400).json({ error: "description is required and must be a non-empty string" });
    return;
  }

  const userId = req.auth?.sub;
  if (!userId) {
    res.status(401).json({ error: "Authenticated user is required to resolve LLM configuration" });
    return;
  }

  const resolved =
    typeof llmConfigId === "string" && llmConfigId
      ? await llmConfigStore.getDecrypted(llmConfigId, userId)
      : await llmConfigStore.getDecryptedDefault(userId);

  if (!resolved) {
    res.status(422).json({
      error: "No LLM provider configured. Go to Settings > LLM Providers to connect one.",
    });
    return;
  }

  // NL→DAG generation needs multi-step reasoning — always use standard tier
  const generationModel = resolveModelForTier(resolved.config.provider, "standard");
  const provider = getProvider({
    provider: resolved.config.provider,
    model: generationModel,
    apiKey: resolved.apiKey,
    // Force native JSON output so chatty preambles can't break the
    // array-parse downstream. Even json_object mode (no schema) is
    // enough to kill the leading "Here are the steps:" prose that
    // tripped the old fence-strip regex. The Tier 1 extractor still
    // catches providers that don't support native mode.
    responseFormat: { type: "json_object" },
  });

  let rawText: string;
  try {
    const response = await provider(
      `${GENERATE_SYSTEM_PROMPT}\n\nWorkflow description:\n${description.trim()}`
    );
    rawText = response.text;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: `LLM call failed: ${msg}` });
    return;
  }

  let steps: WorkflowStep[];
  try {
    // Shared extractor handles chatty preambles + fenced/prose-wrapped
    // JSON across every provider (Mistral routinely emits a preamble).
    const parsed = extractStructuredOutput<unknown>(rawText, {
      label: "workflow-generate",
    });
    if (!Array.isArray(parsed)) {
      throw new Error("Expected a JSON array");
    }
    steps = parsed as WorkflowStep[];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(422).json({ error: `LLM returned invalid JSON: ${msg}`, raw: rawText });
    return;
  }

  res.json({ steps });
});

// HEL-27: mount the canonical workflows router AFTER the specific
// /api/workflows/schema + /api/workflows/generate handlers above so those
// continue to win on path match. The router only defines GET/, GET/:id,
// POST/, POST/:id/versions — none of which conflict with /schema or
// /generate (those are top-level paths handled before this point).
app.use("/api/workflows", requireAuth, workspaceResolver, requireRole("admin", "developer"), canonicalWorkflowRoutes);

// ---------------------------------------------------------------------------
// POST /api/goals/team-assembly
// ---------------------------------------------------------------------------

app.post("/api/goals/team-assembly", requireAuth, llmEndpointRateLimiter, async (req: AuthenticatedRequest, res) => {
  const parsedRequest = teamAssemblyRequestSchema.safeParse(req.body);
  if (!parsedRequest.success) {
    const issue = parsedRequest.error.issues[0];
    const path = issue?.path?.[0];
    const message =
      issue?.message === "Required" && typeof path === "string"
        ? `${path} is required`
        : (issue?.message ?? "Invalid request body");
    res.status(400).json({ error: message });
    return;
  }

  const userId = req.auth?.sub;
  if (!userId) {
    res.status(401).json({ error: "Authenticated user is required to resolve LLM configuration" });
    return;
  }

  const resolved = await llmConfigStore.getDecryptedDefault(userId);
  if (!resolved) {
    res.status(422).json({
      error: "No LLM provider configured. Go to Settings > LLM Providers to connect one.",
    });
    return;
  }

  const assemblyModel = resolveModelForTier(resolved.config.provider, "power");
  const provider = getProvider({
    provider: resolved.config.provider,
    model: assemblyModel,
    apiKey: resolved.apiKey,
  });

  let rawText: string;
  try {
    rawText = (await provider(buildTeamAssemblyPrompt(parsedRequest.data))).text;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: `LLM call failed: ${msg}` });
    return;
  }

  try {
    res.json(parseTeamAssemblyResponse(rawText));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(422).json({ error: `LLM returned invalid JSON: ${msg}`, raw: rawText });
  }
});

// ---------------------------------------------------------------------------
// Webhook trigger — activates a workflow from an external event
// ---------------------------------------------------------------------------

/**
 * POST /api/webhooks/:templateId
 * Trigger a workflow run from an inbound webhook.
 * The entire request body is forwarded as the run input.
 */
app.post("/api/webhooks/:templateId", async (req, res) => {
  const { templateId } = req.params;

  let template: WorkflowTemplate;
  try {
    template = getTemplate(templateId);
  } catch {
    res.status(404).json({ error: `Template not found: ${templateId}` });
    return;
  }

  const input = req.body as Record<string, unknown>;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    res.status(400).json({ error: "Webhook body must be a JSON object" });
    return;
  }

  const webhookUserId = req.headers["x-user-id"];
  const run = await workflowEngine.startRun(
    template,
    input,
    undefined,
    typeof webhookUserId === "string" ? webhookUserId : undefined
  );
  res.status(202).json({ runId: run.id, status: run.status });
});

// ---------------------------------------------------------------------------
// Approvals API — HITL pause-and-wait approval requests
// ---------------------------------------------------------------------------

/**
 * GET /api/approvals
 * Query params: status=pending|approved|rejected|timed_out
 * Returns all approval requests, optionally filtered by status.
 */
app.get("/api/approvals", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.auth?.sub;
  const { status } = req.query;
  const validStatuses = ["pending", "approved", "rejected", "request_changes", "timed_out"];
  const filter =
    typeof status === "string" && validStatuses.includes(status)
      ? (status as "pending" | "approved" | "rejected" | "request_changes" | "timed_out")
      : undefined;
  const approvals = (await approvalStore.list(filter)).filter((approval) => approval.assignee === userId);
  res.json({ approvals, total: approvals.length });
});

/**
 * GET /api/approvals/notifications
 * Returns in-app approval notifications for the authenticated approver.
 */
app.get("/api/approvals/notifications", requireAuth, async (req: AuthenticatedRequest, res) => {
  // DASH-43: list() is now async + Postgres-aware. Without the await,
  // persisted notifications never reached this endpoint and the inbox
  // looked empty.
  const all = await approvalNotificationStore.list({
    assignee: req.auth?.sub,
    status: "pending",
  });
  const notifications = all
    .filter((notification) => notification.channel === "inbox")
    .map((notification) => ({
      ...notification,
      assignee: notification.recipient,
    }));
  res.json({ notifications, total: notifications.length });
});

/**
 * GET /api/approvals/:id
 * Returns a single approval request by ID.
 */
app.get("/api/approvals/:id", requireAuth, async (req: AuthenticatedRequest, res) => {
  const approval = await approvalStore.get(req.params.id);
  const userId = req.auth?.sub;
  if (!approval || (approval.userId !== undefined && approval.userId !== userId)) {
    res.status(404).json({ error: `Approval not found: ${req.params.id}` });
    return;
  }
  if (approval.assignee !== req.auth?.sub) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  res.json(approval);
});

/**
 * GET /api/approvals/:id/notifications
 * Returns the durable notification outbox rows created for an approval request.
 */
app.get("/api/approvals/:id/notifications", requireAuth, async (req: AuthenticatedRequest, res) => {
  const approval = await approvalStore.get(req.params.id);
  const userId = req.auth?.sub;
  if (!approval || (approval.userId !== undefined && approval.userId !== userId)) {
    res.status(404).json({ error: `Approval request not found: ${req.params.id}` });
    return;
  }

  const notifications = await approvalNotificationStore.listByApprovalRequest(req.params.id);
  res.json({ notifications, total: notifications.length });
});

/**
 * POST /api/approvals/:id/resolve
 * Body: { decision: "approved" | "rejected" | "request_changes", comment?: string }
 * Resolves the approval request, resuming or terminating the paused run.
 */
app.post("/api/approvals/:id/resolve", requireAuth, async (req: AuthenticatedRequest, res) => {
  const { decision, comment } = req.body as { decision?: string; comment?: string };

  if (decision !== "approved" && decision !== "rejected" && decision !== "request_changes") {
    res.status(400).json({ error: "decision must be 'approved', 'rejected', or 'request_changes'" });
    return;
  }

  const approval = await approvalStore.get(req.params.id);
  const userId = req.auth?.sub;
  if (!approval || (approval.userId !== undefined && approval.userId !== userId)) {
    res.status(404).json({ error: "Approval not found or already resolved" });
    return;
  }
  if (approval.assignee !== req.auth?.sub) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const ok = await approvalStore.resolve(req.params.id, decision, comment);
  if (!ok) {
    res.status(404).json({ error: "Approval not found or already resolved" });
    return;
  }
  res.json({ success: true });
});

/**
 * GET /api/executions/:id/state
 * Returns the persisted paused execution state for an awaiting-approval run.
 */
app.get("/api/executions/:id/state", requireAuth, async (req, res) => {
  const run = await runStore.get(req.params.id);
  const userId = getAuthenticatedUserId(req);
  if (!run || (run.userId !== undefined && run.userId !== userId)) {
    res.status(404).json({ error: `Execution not found: ${req.params.id}` });
    return;
  }

  if (run.status !== "awaiting_approval") {
    res.status(409).json({ error: "Execution is not currently paused at an approval step" });
    return;
  }

  const approval = await approvalStore.findByRunId(run.id, "pending");
  if (!approval || (approval.userId !== undefined && approval.userId !== userId)) {
    res.status(404).json({ error: `Pending approval not found for execution: ${req.params.id}` });
    return;
  }

  res.json({
    run,
    approval,
    pausedAtStepId: approval.stepId,
    pausedAtStepName: approval.stepName,
    runtimeState: run.runtimeState ?? null,
  });
});

/**
 * POST /api/executions/:id/resume
 * Manually resumes a paused execution after its approval decision has already
 * been persisted and the original live worker is gone.
 */
app.post("/api/executions/:id/resume", requireAuth, async (req: AuthenticatedRequest, res) => {
  const run = await runStore.get(req.params.id);
  if (!run || (run.userId !== undefined && run.userId !== req.auth?.sub)) {
    res.status(404).json({ error: `Execution not found: ${req.params.id}` });
    return;
  }

  if (run.status !== "awaiting_approval") {
    res.status(409).json({ error: "Execution is not currently paused at an approval step" });
    return;
  }

  let template;
  try {
    template =
      run.workflowDag &&
      typeof run.workflowDag === "object" &&
      !Array.isArray(run.workflowDag) &&
      Array.isArray((run.workflowDag as Partial<WorkflowTemplate>).steps)
        ? (run.workflowDag as WorkflowTemplate)
        : getTemplate(run.templateId);
  } catch (error) {
    res.status(404).json({ error: String(error) });
    return;
  }

  try {
    const resumed = await workflowEngine.resumeRun(run.id, template, req.auth?.sub);
    res.status(202).json(resumed);
  } catch (error) {
    res.status(409).json({ error: String(error) });
  }
});

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get("/health", async (_req, res) => {
  const { checkPostgresConnection, isPostgresConfigured: isPgConfigured } = await import("./db/postgres");
  const pgConfigured = isPgConfigured();
  const pgConnected = pgConfigured ? await checkPostgresConnection() : false;
  let runs = [] as Awaited<ReturnType<typeof runStore.list>>;
  let runStoreError: string | null = null;

  try {
    runs = await runStore.list();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[health] Run stats unavailable:", message);
    runStoreError = message;
  }

  res.json({
    status: runStoreError ? "degraded" : "ok",
    templates: listTemplates().length,
    runs: {
      total: runs.length,
      running: runs.filter((r) => r.status === "running").length,
      completed: runs.filter((r) => r.status === "completed").length,
      failed: runs.filter((r) => r.status === "failed").length,
      error: runStoreError,
    },
    postgres: {
      configured: pgConfigured,
      connected: pgConnected,
    },
  });
});

app.get("/api/connectors/health", requireAuthOrQaBypass, async (req: AuthenticatedRequest, res) => {
  const userId = req.auth?.sub?.trim();
  if (!userId) {
    res.status(401).json({ error: "Authenticated user required" });
    return;
  }

  const connectors = await listConnectorHealth(userId);
  res.json({
    connectors,
    summary: getConnectorHealthSummary(connectors),
  });
});

if (process.env.NODE_ENV !== "test" && process.env.AUTOFLOW_ENABLE_APPROVAL_RESUME_SWEEPER !== "false") {
  startApprovalResumeCoordinator();
}

if (process.env.NODE_ENV !== "test" && process.env.AUTOFLOW_ENABLE_APPROVAL_NOTIFICATION_SWEEPER !== "false") {
  startApprovalNotificationCoordinator();
}

if (process.env.NODE_ENV !== "test" && process.env.AUTOFLOW_ENABLE_TICKET_NOTIFICATION_SWEEPER !== "false") {
  startTicketNotificationCoordinator();
}

// Sentry error handler must come before other error handlers
Sentry.setupExpressErrorHandler(app);

// Handle JSON parse errors from express.json() middleware
app.use((err: Error, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err instanceof SyntaxError && "body" in err) {
    res.status(400).json({ error: "Request body must be a valid JSON object" });
    return;
  }
  next(err);
});

export default app;
