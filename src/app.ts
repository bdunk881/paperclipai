/**
 * AutoFlow Express application.
 * Separated from the server entry-point so the app can be imported
 * in tests without starting a live TCP listener.
 */

import * as Sentry from "@sentry/node";
import express from "express";
import type { IncomingMessage, ServerResponse } from "http";
import multer from "multer";
import cors from "cors";
import helmet from "helmet";
import passport from "passport";
import {
  getTemplate,
  getTemplatesByCategory,
  listTemplates,
  TEMPLATE_MAP,
  WORKFLOW_TEMPLATES,
} from "./templates";
import { WorkflowTemplate, WorkflowStep } from "./types/workflow";
import { workflowEngine } from "./engine/WorkflowEngine";
import {
  startApprovalResumeCoordinator,
  runApprovalResumeSweep,
} from "./engine/approvalResumeCoordinator";
import { startPromptRoutineCoordinator } from "./promptRoutines/promptRoutineCoordinator";
import { startApprovalNotificationCoordinator } from "./engine/approvalNotificationCoordinator";
import { startTicketNotificationCoordinator } from "./engine/ticketSlaCoordinator";
import { runStore, sanitizeRunTags } from "./engine/runStore";
import { sanitizeRunMetadata, parseRunMetadataOps, RunMetadataError } from "./engine/runMetadata";
import { computeRunUsage, rollUpUsage } from "./engine/runUsage";
import {
  isRealtimeTokenConfigured,
  mintRealtimeToken,
  verifyRealtimeToken,
  InvalidRealtimeTokenError,
  DEFAULT_REALTIME_TOKEN_TTL_SECONDS,
} from "./engine/realtimeToken";
import { handleStreamSse } from "./engine/agentTrace/streamSseHandler";
import { batchStore } from "./engine/batchStore";
import { triggerBatch, MAX_BATCH_INPUTS } from "./engine/batchTrigger";
import { evalStore } from "./engine/evalStore";
import { buildEvalRows, summarizeEval, type ScorableRun } from "./engine/evalScorer";
import { approvalStore } from "./engine/approvalStore";
import { approvalNotificationStore } from "./engine/approvalNotificationStore";
import approvalPolicyRoutes from "./approvals/policyRoutes";
// HEL-214 / PR J: Pro Mode actionable reveal scaffolds.
import approvalRuleDebugRoutes from "./approvals/ruleDebugRoutes";
import missionAssignmentReplayRoutes from "./missions/missionAssignmentReplayRoutes";
import hireTemplateRoutes from "./missions/hireTemplateRoutes";
import llmConfigRoutes from "./llmConfig/llmConfigRoutes";
import tierRoutingRoutes from "./llmConfig/tierRoutingRoutes";
import apiKeyRoutes from "./apiKeys/apiKeyRoutes";
import { createConnectorGrantsRoutes } from "./connections/connectorGrantsRoutes";
import envVarRoutes from "./envVars/envVarRoutes";
import securityRoutes from "./security/securityRoutes";
import mfaRoutes from "./security/mfaRoutes";
import { getMfaService } from "./security/mfaService";
import { SecurityServiceError } from "./security/securityService";
import {
  isSupabaseSessionMintingConfigured,
  mintSupabaseSessionForUser,
  SupabaseUserNotFoundError,
} from "./security/supabaseSessionMinter";
import sentryTestRoutes from "./debug/sentryTestRoute";
import { createHostedFreeRoutes } from "./hostedFreeModels/hostedFreeRoutes";
import mcpRoutes from "./mcp/mcpRoutes";
import memoryRoutes from "./memory/memoryRoutes";
import agentMemoryRoutes from "./agents/agentMemoryRoutes";
import agentRoutes from "./agents/agentRoutes";
import { createAgentPresenceRoutes } from "./agents/agentPresenceRoutes";
import { createAgentTraceRoutes } from "./agents/agentTraceRoutes";
import { createAgentJobDescriptionRoutes } from "./agents/agentJobDescriptionRoutes";
import { createAgentActionsRoutes } from "./agents/agentActionsRoutes";
import knowledgeRoutes from "./knowledge/routes";
import controlPlaneRoutes from "./controlPlane/controlPlaneRoutes";
import companyRoutes from "./companies/companyRoutes";
import hitlRoutes from "./hitl/hitlRoutes";
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
  listClassificationDecisionsForWorkspace,
} from "./engine/classificationLog";
import { requireAuth, requireAuthOrQaBypass, AuthenticatedRequest } from "./auth/authMiddleware";
import { requireAAL2, buildAal2AttestationCookieHeader } from "./middleware/requireAAL2";
import { requireCfAccess } from "./admin/cfAccessAuth";
import { requireEntitlement } from "./middleware/requireEntitlement";
import { requireRole } from "./middleware/requireRole";
import { asyncHandler } from "./middleware/asyncHandler";
import {
  createDurableObjectRateLimiter,
  getIpRateLimitKey,
  getRateLimitKey,
} from "./middleware/rateLimit";
import socialAuthRoutes from "./auth/socialAuthRoutes";
import passwordAuthRoutes from "./auth/passwordAuthRoutes";
import stripeWebhookRoutes from "./billing/stripeWebhook";
import issuingWebhookRoutes from "./billing/credits/issuingWebhook";
import apolloWebhookRoutes from "./integrations/apollo-attio/webhookRoute";
import checkoutRoutes from "./billing/checkoutRoutes";
import creditsCheckoutRoutes from "./billing/credits/checkoutRoutes";
import creditsWalletRoutes from "./billing/credits/walletRoutes";
import {
  buildTeamAssemblyPrompt,
  parseTeamAssemblyResponse,
  teamAssemblyRequestSchema,
} from "./goals/teamAssembly";
import apolloRoutes from "./integrations/apollo/routes";
import hubSpotRoutes, { hubSpotWebhookRouter } from "./integrations/hubspot/routes";
import sentryRoutes, { sentryWebhookRouter } from "./integrations/sentry/routes";
import subscriptionRoutes from "./billing/subscriptionRoutes";
import billingInfoRoutes from "./billing/billingInfoRoutes";
import slackRoutes, { slackWebhookRouter } from "./integrations/slack/routes";
import shopifyRoutes, { shopifyWebhookRouter } from "./integrations/shopify/routes";
import docuSignRoutes, { docuSignWebhookRouter } from "./integrations/docusign/routes";
import linearRoutes, { linearWebhookRouter } from "./integrations/linear/routes";
import teamsRoutes, { teamsWebhookRouter } from "./integrations/teams/routes";
import gmailRoutes, { gmailWebhookRouter } from "./integrations/gmail/routes";
import stripeRoutes, { stripeConnectorWebhookRouter } from "./integrations/stripe/routes";
import posthogRoutes, { posthogWebhookRouter } from "./integrations/posthog/routes";
import intercomRoutes, { intercomWebhookRouter } from "./integrations/intercom/routes";
import {
  createSesNotificationsRoutes,
  type SesNotificationsDeps,
} from "./mailer/sesNotificationsRoutes";
import {
  createCommsInboundIngest,
  createCommsWebhookRoutes,
  normalizeSesEvent,
  type CommsInboundIngest,
} from "./comms/webhooks";
import agentCatalogRoutes from "./integrations/agent-catalog/routes";
import oauthBridgeRoutes from "./integrations/oauthBridgeRoutes";
import integrationRoutes, {
  catalogRouter as integrationCatalogRoutes,
  oauthCallbackRouter as integrationOAuthCallbackRoutes,
  webhookRelayRouter,
} from "./integrations/integrationRoutes";
// HEL-740: Composio broker connect/callback routers (P1b).
import {
  composioConnectRouter,
  composioCallbackRouter,
  composioWebhookRouter,
  composioTriggerRouter,
} from "./integrations/composio/broker";
import googleWorkspaceConnectorRoutes from "./connectors/google-workspace/routes";
import googleWorkspaceWebhookRoutes from "./connectors/google-workspace/webhookRoutes";
import notificationRoutes from "./notifications/routes";
import { createInternalRoutes } from "./internal/routes";
import { requireCfWorker } from "./middleware/requireCfWorker";
import { getPostgresPool, isPostgresPersistenceEnabled } from "./db/postgres";
import {
  createExplicitWorkspaceHeaderResolver,
  createWorkspaceResolver,
  WorkspaceAwareRequest,
} from "./middleware/workspaceResolver";
import { createWorkspaceRoutes } from "./workspaces/workspaceRoutes";
import { createMemberInviteRoutes } from "./workspaces/memberInviteRoutes";
import profileRoutes from "./user/profileRoutes";
import { createMissionRoutes } from "./missions/missionRoutes";
import { createHiringPlanRoutes } from "./missions/hiringPlanRoutes";
import { roleLibraryRoutes } from "./missions/roleLibraryRoutes";
import { createActivityRoutes } from "./activity/activityRoutes";
import {
  createBudgetsRoutes,
  createConnectorConnectionsRoutes,
  createEntitlementsRoutes,
  createOrgGraphRoutes,
  createStepResultsRoutes,
  createWakeEventsRoutes,
} from "./canonical/canonicalReadRoutes";
import { createWorkspaceSnapshotRoutes } from "./canonical/workspaceSnapshotRoutes";
import { createBudgetBreakdownRoute } from "./budget/budgetBreakdownRoute";
import { createBudgetSetRoute } from "./budget/budgetSetRoute";
import { createPromptRoutineRoutes } from "./promptRoutines/promptRoutineRoutes";
import { invalidateWorkspaceCache } from "./cache/readCache";
import { createGlobalSearchRoutes } from "./search/globalSearchRoutes";
import { createWorkflowRoutes } from "./workflows/workflowRoutes";
import { createRoutineRoutes } from "./routines/routineRoutes";
import { createFormRoutes } from "./forms/formRoutes";
import { createResumeRoutes } from "./workflows/resumeRoutes";
import { createFileRoutes } from "./storage/fileRoutes";
import { getStorageAdapter } from "./storage";
import { fileObjectStore } from "./storage/fileObjectStore";
import { auditService } from "./auditing/auditService";
import { createInstructionRoutes } from "./instructions/instructionRoutes";
import { createKnowledgeItemRoutes } from "./knowledge/knowledgeItemRoutes";
import { createEpisodeRoutes } from "./episodes/episodeRoutes";
import { createSkillsRoutes } from "./skills/skillsRoutes";
import { createCuratedKnowledgeRoutes } from "./admin/curatedKnowledgeRoutes";
import {
  createAdminConsoleRoutes,
  createImpersonationVerifyRoute,
  createPublicAgentReplyRoute,
  createSystemNoticeUnsubscribeRoute,
} from "./adminConsole";
import { createReflectionRoutes } from "./knowledge/reflectionRoutes";
import {
  createPortableWorkflowBundle,
  getPortableWorkflowSchemaDescriptor,
  parsePortableWorkflowBundle,
} from "./workflows/portableSchema";
import landingPublicApiRoutes from "./landing/publicApiRoutes";
import publicStatusRoutes from "./landing/publicStatusRoute";
import { requirePersistence } from "./bootstrap";
import { randomUUID } from "crypto";
import { checkRedisConnection, isRedisConfigured } from "./queue/redisClient";
import { getRunQueue, addRunJob, isRunPriority } from "./queue/queues";
import { verifyHmac } from "./webhooks/verifySignature";

import { deleteImportedTemplate, getImportedTemplate, saveImportedTemplate } from "./templates/importedTemplateStore";
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

// HEL-613: forward parsed SES events to the comms wake-event ingest. Defined
// here (away from the route-mounting block) so this async callback isn't read as
// an unwrapped route handler by the HEL-184 asyncHandler guard — the real SES
// route handlers inside createSesNotificationsRoutes() are already wrapped.
function buildSesInboundForwarder(ingest: CommsInboundIngest): SesNotificationsDeps {
  return {
    onInboundEvent: async (event) => {
      const normalized = normalizeSesEvent(event);
      if (normalized) {
        await ingest(normalized);
      }
    },
  };
}

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

type RawBodyRequest = express.Request & { rawBody?: Buffer };

interface WebhookTriggerSecretConfig {
  secret: string;
  userId: string;
}

type WebhookTriggerAuthResult =
  | { ok: true; userId: string; secret: string }
  | { ok: false; status: 401 | 503; error: string };

function captureRawJsonBody(req: IncomingMessage, _res: ServerResponse, buf: Buffer): void {
  if (buf.length > 0) {
    (req as IncomingMessage & { rawBody?: Buffer }).rawBody = Buffer.from(buf);
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getWebhookTriggerSecretConfig(templateId: string): WebhookTriggerAuthResult {
  const rawRegistry = process.env.WEBHOOK_TRIGGER_SECRETS;
  if (!rawRegistry?.trim()) {
    return {
      ok: false,
      status: 503,
      error: "Webhook trigger signing secrets are not configured",
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawRegistry);
  } catch {
    return {
      ok: false,
      status: 503,
      error: "Webhook trigger signing secrets are misconfigured",
    };
  }

  if (!isPlainRecord(parsed)) {
    return {
      ok: false,
      status: 503,
      error: "Webhook trigger signing secrets are misconfigured",
    };
  }

  const entry = parsed[templateId];
  if (!isPlainRecord(entry)) {
    return {
      ok: false,
      status: 401,
      error: "Webhook trigger is not authorized for this template",
    };
  }

  const config: Partial<WebhookTriggerSecretConfig> = {
    secret: typeof entry.secret === "string" ? entry.secret.trim() : undefined,
    userId: typeof entry.userId === "string" ? entry.userId.trim() : undefined,
  };
  if (!config.secret || !config.userId) {
    return {
      ok: false,
      status: 503,
      error: "Webhook trigger signing secrets are misconfigured",
    };
  }

  return { ok: true, secret: config.secret, userId: config.userId };
}

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
  ? createHiringPlanRoutes(getPostgresPool(), getRunQueue())
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
const globalSearchRoutes = canonicalReadsArePostgres
  ? createGlobalSearchRoutes(getPostgresPool())
  : express.Router().get("/", (_req, res) =>
      res.json({ query: "", results: [], total: 0 }),
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

// HEL-212 (PR H): Budget v2 dashboard endpoints — spend breakdown
// (GET /api/budget/breakdown) and ceiling upsert (PUT /api/budget).
// Read mount allows all workspace members; the write mount tightens
// to admin/operator so a billing-only seat can't reshape spend caps.
const budgetBreakdownRoute = canonicalReadsArePostgres
  ? createBudgetBreakdownRoute(getPostgresPool())
  : express.Router().get("/breakdown", (_req, res) =>
      res.json({
        scope: "workspace",
        since: null,
        until: null,
        model: null,
        rows: [],
        series: [],
        totals: { byModel: {}, all: 0, tokens: 0, cacheHitRate: null },
      }),
    );
const budgetSetRoute = canonicalReadsArePostgres
  ? createBudgetSetRoute(getPostgresPool())
  : express.Router().put("/", (_req, res) =>
      res.status(501).json({ error: "Budget ceilings require PostgreSQL persistence." }),
    );
const promptRoutineRoutes = canonicalReadsArePostgres
  ? createPromptRoutineRoutes(getPostgresPool())
  : express.Router().all("*", (_req, res) =>
      res.status(501).json({ error: "Prompt routines require PostgreSQL persistence." }),
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

function parsePositiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getAuthenticatedUserId(req: express.Request): string | null {
  const authReq = req as AuthenticatedRequest;
  const userId = authReq.auth?.sub;
  return typeof userId === "string" && userId.trim() ? userId.trim() : null;
}

const generalApiRateLimiter = createDurableObjectRateLimiter({
  scope: "api",
  windowMs: 60 * 1000,
  limit: 100,
  keyGenerator: getRateLimitKey,
});

const webhookRateLimiter = createDurableObjectRateLimiter({
  scope: "webhook",
  windowMs: 60 * 1000,
  limit: 60,
  keyGenerator: getIpRateLimitKey,
});

const llmEndpointRateLimiter = createDurableObjectRateLimiter({
  scope: "llm",
  windowMs: 60 * 60 * 1000,
  limit: 10,
  keyGenerator: getRateLimitKey,
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

const authRouteRateLimiter = createDurableObjectRateLimiter({
  scope: "auth",
  windowMs: authRouteRateLimitWindowMs,
  limit: parsePositiveIntegerEnv("AUTH_ROUTE_RATE_LIMIT_MAX", 20),
  keyGenerator: getIpRateLimitKey,
});

const billingMutationRateLimiter = createDurableObjectRateLimiter({
  scope: "billing-mutation",
  windowMs: 24 * 60 * 60 * 1000,
  limit: 5,
  keyGenerator: getRateLimitKey,
  skip: (req) => !["POST", "PUT", "PATCH", "DELETE"].includes(req.method),
  skipFailedRequests: true,
});

const knowledgeMutationRateLimiter = createDurableObjectRateLimiter({
  scope: "knowledge-mutation",
  windowMs: 60 * 60 * 1000,
  limit: 20,
  keyGenerator: getRateLimitKey,
  skip: (req) => !["POST", "PUT", "PATCH", "DELETE"].includes(req.method),
  skipFailedRequests: true,
});

app.use("/api", generalApiRateLimiter);
app.use("/api/webhooks", webhookRateLimiter);
// ---------------------------------------------------------------------------
// Stripe webhook — must be mounted BEFORE express.json() so the raw body
// is available for signature verification
// ---------------------------------------------------------------------------
app.use("/api/webhooks/stripe", express.raw({ type: "application/json" }), stripeWebhookRoutes);
// Stripe Issuing webhook (HEL-599) — real-time provider-card authorization
// decisions. Separate endpoint + signing secret from the main Stripe webhook;
// raw body before express.json() for signature verification.
app.use("/api/webhooks/stripe/issuing", express.raw({ type: "application/json" }), issuingWebhookRoutes);
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
// Stripe connector webhook — mounted before express.json() for signature verification
app.use("/api/webhooks/stripe/connect", stripeConnectorWebhookRouter);
// PostHog webhook — mounted before express.json() for signature verification
app.use("/api/webhooks/posthog", posthogWebhookRouter);
// HEL-613: inbound comms ingest (provider webhooks → wake_events → triage → run).
// Postgres-gated (wake_events writes need it). Shared by the Telnyx route and
// the SES route's onInboundEvent hook below.
const commsInboundIngest = isPostgresPersistenceEnabled()
  ? createCommsInboundIngest({ pool: getPostgresPool() })
  : null;

// SES notifications (SNS) webhook (HEL-361) — bounce/complaint → suppression list.
// Mounted before express.json(); the router parses its own (text/plain) body.
// HEL-613 additively forwards each parsed event to the comms ingest so a
// bounce/complaint also wakes the owning agent (suppression unchanged).
app.use(
  "/api/webhooks/ses-notifications",
  createSesNotificationsRoutes(
    commsInboundIngest ? buildSesInboundForwarder(commsInboundIngest) : {},
  ),
);
// HEL-613: inbound comms provider webhooks (Telnyx SMS DLR + inbound). Mounted
// before express.json(); each provider route parses its own raw body for
// signature verification.
if (commsInboundIngest) {
  app.use("/api/webhooks/comms", createCommsWebhookRoutes({ ingest: commsInboundIngest }));
}
// Intercom webhook — mounted before express.json() for signature verification
app.use("/api/webhooks/intercom", intercomWebhookRouter);
// Ticket-sync webhook — mounted before express.json() because the route verifies the raw payload
app.use("/api/webhooks/ticket-sync", ticketSyncWebhookRoutes);
// HEL-749: Composio inbound webhook — before express.json() (the SDK verifies the
// raw body); unauthenticated, the HMAC signature is the auth boundary.
app.use("/api/webhooks/composio", composioWebhookRouter);
app.use("/api/connectors/google-workspace", googleWorkspaceWebhookRoutes);

app.use(express.json({ verify: captureRawJsonBody }));
app.use(passport.initialize());

// HEL-676: public form ingress — a form_trigger workflow's hosted form. No auth
// (the workflow UUID is the bearer secret; only form_trigger workflows resolve).
// Mounted after express.json() so submissions parse, before the auth-gated routes.
const formRoutes = isPostgresPersistenceEnabled()
  ? createFormRoutes(getPostgresPool())
  : express.Router();
app.use("/api/forms", formRoutes);

// HEL-774: webhook-resume for paused Wait steps. Public (the token is a
// one-time unguessable bearer minted by the engine; resume always runs in the
// run's own persisted workspace). Mounted before the auth-gated /api/runs
// routes so /api/runs/resume/:token never falls through to /api/runs/:id.
app.use("/api/runs/resume", createResumeRoutes());

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
app.use("/api/billing/checkout", requireAuth, requireAAL2, workspaceResolver, requireRole("billing"), billingMutationRateLimiter, checkoutRoutes);
app.use("/api/billing/subscription", requireAuth, requireAAL2, workspaceResolver, requireRole("billing"), billingMutationRateLimiter, subscriptionRoutes);
// HEL-402: read-only billing info (payment method + next invoice) + a Stripe
// billing-portal session for the "Update card" action. Mounted AFTER the
// specific /checkout + /subscription mounts (which terminate their own paths),
// so this only serves /payment-method, /next-invoice, /portal-session. Reads
// are display-only for billing-role members (no step-up, mirroring the wallet
// read); the Stripe-hosted portal is the security boundary for the card change.
app.use("/api/billing", requireAuth, workspaceResolver, requireRole("billing"), billingInfoRoutes);
// HEL-credits-mvp: hosted-credits pack purchases. Same role + rate-limit
// gates as subscription checkout — billing role required.
app.use("/api/credits/checkout", requireAuth, requireAAL2, workspaceResolver, requireRole("billing"), billingMutationRateLimiter, creditsCheckoutRoutes);
// Wallet balance is readable by any authenticated workspace member —
// it's analogous to the subscription tier read, not a billing action.
app.use("/api/credits/wallet", requireAuth, workspaceResolver, creditsWalletRoutes);
// File storage (HEL-354): signed-URL upload/download/delete. Workspace-scoped;
// any authenticated member manages their own workspace's files.
app.use(
  "/api/files",
  requireAuth,
  workspaceResolver,
  // HEL-606: any authenticated workspace member manages their workspace's
  // files; enumerate all member roles to satisfy the HEL-69 requireRole guard
  // without changing runtime access (requireAuth + workspaceResolver already
  // admit any member). Same no-op pass-through pattern as /api/activity-events.
  requireRole("owner", "admin", "billing", "operator", "developer", "approver", "member"),
  createFileRoutes(),
);
app.use("/api/public/landing", landingPublicApiRoutes);
// Public status feed for status.helloautoflow.com (HEL infra follow-up).
// Sanitized component-level status with 30s in-process cache + CDN cache
// headers — no auth required, no internal identifiers in the response.
app.use("/api/public/status", publicStatusRoutes);
app.use("/api/debug/sentry-test", sentryTestRoutes);

// ---------------------------------------------------------------------------
// LLM Config API — BYOLLM provider credentials
// ---------------------------------------------------------------------------
// HEL-440: AAL2 step-up is applied per-route INSIDE llmConfigRoutes (on the
// create/update/setDefault/delete mutations), NOT at this mount. Gating the
// whole router — the GET list included — meant a passkey user whose 15-min
// AAL2 attestation lapsed got a silent 401 on a routine read (Providers page,
// /hire model selector), recoverable only by a full re-login (HEL-435). The
// list returns masked metadata only, so requireAuth + role is sufficient.
app.use("/api/llm-configs", requireAuth, workspaceResolver, requireRole("admin", "developer"), llmConfigRoutes);
// HEL-117: canonical noun alias (table is `llm_credentials` in migration 025).
// Both paths resolve to the same router until the dashboard fully migrates;
// then `/api/llm-configs` becomes a legacy alias for one release before removal.
app.use("/api/llm-credentials", requireAuth, workspaceResolver, requireRole("admin", "developer"), llmConfigRoutes);

// HEL-todo Phase-2a: tier routing matrix (workspaces.tier_routing JSONB,
// migration 033). GET/PATCH the customer-visible Lite/Standard/Power
// bindings. Vision + embeddings derive from these on the consumer side.
app.use("/api/tier-routing", requireAuth, workspaceResolver, requireRole("admin", "developer"), tierRoutingRoutes);

// HEL-166: platform API keys for programmatic AutoFlow access. Keys are
// workspace-scoped; owner/admin/developer may create, rotate, and revoke.
app.use("/api/api-keys", requireAuth, workspaceResolver, requireRole("admin", "developer"), apiKeyRoutes);

// HEL-205: per-scope connector grants (Connections hub Manage panel).
// Backed by `connector_grants` (migration 060) — RLS-isolated per workspace.
// In-memory mode returns 501 across the surface since persistence is required.
const connectorGrantsRoutes = isPostgresPersistenceEnabled()
  ? createConnectorGrantsRoutes(getPostgresPool())
  : express.Router().all("*", (_req, res) =>
      res.status(501).json({ error: "Connector grants require PostgreSQL persistence." }),
    );
app.use(
  "/api/connector-grants",
  requireAuth,
  workspaceResolver,
  requireRole("admin", "developer"),
  connectorGrantsRoutes,
);

// HEL-206: workspace-scoped encrypted environment variables (Pro surface).
// High-trust: list paths never return plaintext; the only decrypt path is
// the short-lived deref token issued by `/api/env-vars/:id/deref-token`.
// Mirrors the api-keys role gate (admin/developer); follow-up may tighten
// further (owner-only) once the surface is reviewed.
app.use("/api/env-vars", requireAuth, workspaceResolver, requireRole("admin", "developer"), envVarRoutes);

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
app.use("/api/agents/runs", (req, _res, next) => {
  if (!req.headers.authorization) {
    const queryToken = (req.query?.access_token as string | undefined) ?? "";
    if (queryToken) {
      req.headers.authorization = `Bearer ${queryToken}`;
    }
  }
  next();
});

// HEL-218: same access_token → Authorization shim for the three new SSE
// surfaces (routine + ticket + activity streams). EventSource has no
// header API, so the dashboard passes its bearer via ?access_token=…
// and we promote it before the standard auth chain runs.
function promoteSseAccessToken(req: import("express").Request, _res: import("express").Response, next: import("express").NextFunction): void {
  if (!req.headers.authorization) {
    const queryToken = (req.query?.access_token as string | undefined) ?? "";
    if (queryToken) {
      req.headers.authorization = `Bearer ${queryToken}`;
    }
  }
  next();
}
app.use("/api/routines", promoteSseAccessToken);
app.use("/api/tickets", promoteSseAccessToken);
app.use("/api/activity-events", promoteSseAccessToken);
// HEL-241C v2: presence/stream SSE channel. Same shim — EventSource
// can't set the Authorization header so the dashboard passes its
// bearer via ?access_token=…
app.use("/api/workflows", promoteSseAccessToken);
app.use(
  "/api/agents/runs",
  requireAuth,
  workspaceResolver,
  requireRole("admin", "developer"),
  createAgentTraceRoutes(),
);
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
app.use("/api/integrations/posthog", posthogRoutes);
app.use("/api/integrations/intercom", intercomRoutes);
app.use("/api/integrations/agent-catalog", agentCatalogRoutes);

// HEL-740: Composio broker connect/callback (P1b). The callback is UNAUTHENTICATED
// (Composio's redirect carries no session; tenancy is recovered from the single-use
// connect-state token). Connect is authed + role-gated like the other integration writes.
app.use("/api/composio/callback", composioCallbackRouter);
app.use(
  "/api/composio",
  requireAuth,
  workspaceResolver,
  requireRole("admin", "developer"),
  composioConnectRouter,
  composioTriggerRouter,
);

app.use(
  "/api/connectors/google-workspace",
  requireAuth,
  workspaceResolver,
  requireRole("admin", "developer"),
  googleWorkspaceConnectorRoutes,
);
// user-scoped: workspace management creates/lists workspaces and cannot itself be workspace-gated
app.use("/api/workspaces", requireAuth, workspaceRoutes);
// DASH-41: mount profileRoutes (GET/PATCH/PUT /api/user/profile). Previously
// the router was authored + tested but never wired in, so ProfileSettings
// 404'd on every save and fell back to sessionStorage with a misleading
// "backend endpoint pending" toast. Postgres-backed via profileStore.
app.use("/api/user", requireAuth, profileRoutes);
// HEL-203 PR 1: alias mount so the dashboard's v2 Pro/Simple toggle and
// any future per-user UI preference can hit /api/user-profile/preferences
// without an extra router. The handlers live in profileRoutes.ts; this
// is purely a path alias.
app.use("/api/user-profile", requireAuth, profileRoutes);
// llmEndpointRateLimiter is now applied INSIDE missionRoutes on the
// generate-plan POST only (see createMissionRoutes). Mounting it
// here would re-block the cheap GET list endpoint that the dashboard
// polls on Hire + MissionState page loads.
app.use("/api/missions", requireAuth, workspaceResolver, requireRole("admin", "developer"), missionRoutes);
// Static role-library lookup consumed by LibraryRolePicker on Hire/Mission
// surfaces. No workspace data — just the canonical DEFAULT_ROLE_LIBRARY —
// but we still gate behind the same admin/developer role as missions.
app.use("/api/role-library", requireAuth, workspaceResolver, requireRole("admin", "developer"), roleLibraryRoutes);
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
app.use(
  "/api/search",
  requireAuth,
  workspaceResolver,
  requireRole(...ALL_MEMBER_ROLES),
  globalSearchRoutes,
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
// HEL-212 (PR H): Budget v2 — breakdown read + ceiling write. Both
// mount under /api/budget (singular) to avoid colliding with the
// existing /api/budgets read-only list above. Read is open to every
// workspace member; write tightens to admin/operator so non-billing
// roles can't reshape spend caps.
app.use(
  "/api/budget",
  requireAuth,
  workspaceResolver,
  requireRole(...ALL_MEMBER_ROLES),
  budgetBreakdownRoute,
);
app.use(
  "/api/budget",
  requireAuth,
  workspaceResolver,
  requireRole("admin", "operator"),
  budgetSetRoute,
);
app.use(
  "/api/prompt-routines",
  requireAuth,
  workspaceResolver,
  requireRole(...ALL_MEMBER_ROLES),
  promptRoutineRoutes,
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
app.use(
  "/api/workspace",
  requireAuth,
  workspaceResolver,
  requireRole(...ALL_MEMBER_ROLES),
  createWorkspaceSnapshotRoutes(),
);
// HEL-213 PR I: workspace member invites (POST/DELETE invites; POST accept).
// Mounted under /api/workspace/members so the dashboard's existing
// `${API}/workspace/...` base path picks it up without extra config. The
// owner/admin role check lives inside the router for write ops; the mount
// requires the standard workspace-member role chain so any authenticated
// workspace member can hit /accept on a token.
const memberInviteRoutes = isPostgresPersistenceEnabled()
  ? createMemberInviteRoutes(getPostgresPool())
  : express.Router().all("*", (_req, res) => {
      res.status(501).json({ error: "Member invites require PostgreSQL persistence." });
    });
app.use(
  "/api/workspace/members",
  requireAuth,
  workspaceResolver,
  requireRole(...ALL_MEMBER_ROLES),
  memberInviteRoutes,
);
// HEL-167: user security settings. The actions are user-scoped, but they
// write workspace audit events, so every authenticated workspace member gets
// the same RLS-scoped workspace context as the read-only canonical surfaces.
app.use(
  "/api/security",
  requireAuth,
  workspaceResolver,
  requireRole(...ALL_MEMBER_ROLES),
  securityRoutes,
);
// HEL-282: magic-link verification is clicked from an email (top-level GET,
// no bearer token), so it MUST be registered as a PUBLIC route BEFORE the
// requireAuth-gated /api/mfa mount below — the token itself binds the user.
// On success it mints the AAL2 attestation cookie and 302-redirects back to
// the dashboard; otherwise it redirects with ?mfa=link_invalid.
app.get(
  "/api/mfa/magic-link/verify",
  asyncHandler(async (req, res) => {
    const dashboard = (
      process.env.DASHBOARD_APP_URL ??
      process.env.APP_BASE_URL ??
      "http://localhost:5173"
    ).replace(/\/$/, "");
    const token = typeof req.query.token === "string" ? req.query.token : "";
    if (!token) {
      res.redirect(302, `${dashboard}/?mfa=link_invalid`);
      return;
    }
    try {
      const result = await getMfaService().consumeMagicLinkToken(token);
      if (!result) {
        res.redirect(302, `${dashboard}/?mfa=link_invalid`);
        return;
      }
      res.setHeader(
        "Set-Cookie",
        buildAal2AttestationCookieHeader(result.attestation.token, result.attestation.maxAgeSeconds),
      );
      res.redirect(302, `${dashboard}/?mfa=verified`);
    } catch (error) {
      console.warn(
        "[app] magic-link verify failed",
        error instanceof Error ? error.message : error,
      );
      res.redirect(302, `${dashboard}/?mfa=link_invalid`);
    }
  }),
);
// Passwordless passkey (WebAuthn) first-factor login. PUBLIC — the caller has
// no session yet, so these MUST be registered BEFORE the requireAuth-gated
// /api/mfa mount below. The signed assertion proves possession of a registered
// discoverable credential, which we resolve to a user and exchange for a real
// Supabase session. A passkey is phish-resistant, so verify also sets the AAL2
// attestation cookie — the user lands fully stepped-up.
app.post(
  "/api/mfa/webauthn/login/options",
  asyncHandler(async (_req, res) => {
    try {
      const { loginId, options } = await getMfaService().beginWebauthnLogin();
      res.json({ loginId, options });
    } catch (error) {
      if (error instanceof SecurityServiceError) {
        res.status(error.statusCode).json({ error: error.message, code: error.code });
        return;
      }
      throw error;
    }
  }),
);
app.post(
  "/api/mfa/webauthn/login/verify",
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as {
      loginId?: unknown;
      credentialId?: unknown;
      response?: unknown;
    };
    const loginId = typeof body.loginId === "string" ? body.loginId : "";
    const credentialId = typeof body.credentialId === "string" ? body.credentialId : "";
    if (!loginId || !credentialId || !body.response || typeof body.response !== "object") {
      res.status(400).json({ error: "loginId, credentialId and response are required", code: "invalid_payload" });
      return;
    }
    // Verifying the assertion alone is cheap, but minting a session needs the
    // service-role + anon keys. Fail fast with a clear 503 if either is absent
    // rather than verifying the passkey and then dead-ending.
    if (!isSupabaseSessionMintingConfigured()) {
      res.status(503).json({
        error: "Passwordless passkey login is not available in this environment.",
        code: "passwordless_login_unavailable",
      });
      return;
    }
    try {
      const { userId, attestation } = await getMfaService().finishWebauthnLogin(
        loginId,
        body.response,
        credentialId,
      );
      const session = await mintSupabaseSessionForUser(userId);
      res.setHeader(
        "Set-Cookie",
        buildAal2AttestationCookieHeader(attestation.token, attestation.maxAgeSeconds),
      );
      res.json({
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        expiresAt: session.expiresAt,
        user: session.user,
      });
    } catch (error) {
      if (error instanceof SecurityServiceError) {
        res.status(error.statusCode).json({ error: error.message, code: error.code });
        return;
      }
      // HEL-394: the passkey verified, but it resolves to a Supabase user that
      // no longer exists — an orphaned credential. This is permanent, so don't
      // tell the user to "try again". Best-effort prune the dead credential so
      // the browser stops offering it, capture for visibility, and explain.
      if (error instanceof SupabaseUserNotFoundError) {
        try {
          await getMfaService().pruneOrphanedWebauthnCredential(error.userId, credentialId);
        } catch (pruneErr) {
          console.warn(
            "[app] failed to prune orphaned passkey credential",
            pruneErr instanceof Error ? pruneErr.message : pruneErr,
          );
        }
        Sentry.captureException(error, {
          level: "warning",
          tags: { endpoint: "/api/mfa/webauthn/login/verify", code: "passkey_account_unlinked" },
          fingerprint: ["passkey_account_unlinked"],
        });
        res.status(401).json({
          error:
            "This passkey is no longer linked to an account. Sign in another way and re-register it.",
          code: "passkey_account_unlinked",
        });
        return;
      }
      // Unknown server-side minting failure (bad keys, Supabase down, etc.).
      // Keep the generic 502, but capture it (HEL-394) — previously this path
      // only console.warn'd, leaving 5xx spikes invisible in Sentry.
      console.warn(
        "[app] passwordless passkey login failed",
        error instanceof Error ? error.message : error,
      );
      Sentry.captureException(error, {
        level: "error",
        tags: { endpoint: "/api/mfa/webauthn/login/verify", code: "login_failed" },
        fingerprint: ["passkey_login_mint_failed"],
      });
      res.status(502).json({ error: "Could not complete passkey sign-in. Try again.", code: "login_failed" });
    }
  }),
);
// HEL-mfa: MFA enrollment + step-up. User-scoped (no workspace requirement)
// because a brand-new user must be able to enroll a passkey before they've
// joined or created a workspace. Audit log writes resolve a workspace from
// the optional `x-workspace-id` header when one is available.
app.use("/api/mfa", requireAuth, mfaRoutes);
// HEL-27 canonical workflows router is mounted further below, AFTER the
// pre-existing /api/workflows/schema + /api/workflows/generate specific
// handlers, so those don't get intercepted by the :workflowId param.
// HEL-87: three-layer memory.
app.use("/api/instructions", requireAuth, workspaceResolver, requireRole("admin", "developer", "operator"), instructionRoutes);
app.use("/api/knowledge-items", requireAuth, workspaceResolver, requireRole("admin", "developer", "operator"), knowledgeItemRoutes);
app.use("/api/episodes", requireAuth, workspaceResolver, requireRole("admin", "developer", "operator"), episodeRoutes);
// HEL-219: skills picker (loaded skills) + admin triage of the
// scanner's manifest. Read-only for v1.
app.use("/api/skills", requireAuth, workspaceResolver, requireRole("admin", "developer", "operator"), createSkillsRoutes());
// HEL-93: AutoFlow staff admin — curated global knowledge tier. No workspace
// scope (cross-workspace by design); requireStaff gates access via the
// AUTOFLOW_STAFF_USER_IDS env-var allowlist.
const curatedKnowledgeRoutes = isPostgresPersistenceEnabled()
  ? createCuratedKnowledgeRoutes(getPostgresPool())
  : express.Router().all("*", (_req, res) =>
      res.status(501).json({ error: "Curated knowledge requires PostgreSQL persistence." }),
    );
// HEL-mfa: belt + suspenders for staff endpoints.
//   1. requireCfAccess — Cloudflare Access JWT (FIDO2 key at the edge).
//      No-op when CF_ACCESS_AUD_TAG/CF_ACCESS_TEAM_DOMAIN are unset, so
//      local dev + in-memory tests still work. Production must set both.
//   2. requireAuth — Supabase JWT for user identity.
//   3. requireAAL2 — fresh second-factor verification.
//   4. curatedKnowledgeRoutes self-applies requireStaff (passkey-only AAL2).
app.use(
  "/api/admin/curated-knowledge",
  requireCfAccess,
  requireAuth,
  requireAAL2,
  curatedKnowledgeRoutes,
);

// Cross-tenant platform-admin console (admin.helloautoflow.com). Gated by
// requirePlatformAdmin (checks user_profiles.is_platform_admin or the
// AUTOFLOW_STAFF_USER_IDS allowlist) and routed under /api/admin-console/*.
// HEL-mfa TODO: stack requireCfAccess + requireAAL2 here too once
// requirePlatformAdmin's flow has been smoke-tested with the AAL2 cookie
// in a staging soak. Platform-admin is higher-privilege than
// curated-knowledge so the hardening is wanted; just deferring to a
// follow-up that can verify the impersonation issue/verify flow still
// works under step-up.
// HEL infra dashboard PR #8: public async-reply receiver mounted BEFORE
// the auth-gated admin-console router so external webhook receivers can
// POST replies without an AutoFlow session. HMAC verification against the
// original webhook's secret replaces auth.
if (isPostgresPersistenceEnabled()) {
  app.use(
    "/api/admin-console/infra/agent-asks",
    createPublicAgentReplyRoute(getPostgresPool()),
  );
}

const adminConsoleRoutes = isPostgresPersistenceEnabled()
  ? createAdminConsoleRoutes(getPostgresPool())
  : express.Router().all("*", (_req, res) =>
      res.status(501).json({ error: "Admin console requires PostgreSQL persistence." }),
    );
app.use("/api/admin-console", requireAuth, adminConsoleRoutes);

// Public impersonation verify — called by the customer dashboard with the
// token from ?impersonate=<jwt>. Intentionally OUTSIDE the admin gate.
app.use("/api/impersonation", createImpersonationVerifyRoute());
// HEL-366: public token-gated system-notice unsubscribe — mounted OUTSIDE the
// admin gate (recipients have no AutoFlow session; the HMAC token is the auth).
app.use("/api/system-notices", createSystemNoticeUnsubscribeRoute());
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
// HEL-204 PR A: dashboard v2 renamed Tickets → Assignments. Mount the
// same router under the new path so the Linear-feel New Assignment modal
// can POST to /api/mission-assignments. Old /api/tickets stays alive for
// existing integrations + the ticket-detail surfaces.
app.use(
  "/api/mission-assignments",
  requireAuth,
  workspaceResolver,
  requireRole("admin", "operator"),
  ticketRoutes,
);
app.use("/api/ticket-sync", requireAuth, workspaceResolver, requireRole("admin", "operator"), ticketSyncRoutes);
app.use("/api/notifications", requireAuth, workspaceResolver, requireRole("admin", "operator"), notificationRoutes);
app.use("/api/approval-policies", requireAuth, workspaceResolver, requireRole("admin", "approver", "operator"), approvalPolicyRoutes);
// HEL-214 / PR J: Pro Mode actionable reveal scaffolds. Each route is a
// placeholder shape (echoes / static results); the real implementations are
// follow-ups so the dashboard UI can ship today.
app.use("/api/approval-rules", requireAuth, workspaceResolver, requireRole("admin", "approver", "operator"), approvalRuleDebugRoutes);
app.use("/api/mission-assignments", requireAuth, workspaceResolver, requireRole("admin", "developer"), missionAssignmentReplayRoutes);
app.use("/api/hire", requireAuth, workspaceResolver, requireRole("admin", "developer"), hireTemplateRoutes);

// HEL-310: internal API surface — reachable only by the Cloudflare Worker
// (cf-worker/) via the requireCfWorker JWT middleware. No user-facing auth
// applied here; the worker authenticates itself with a short-lived HS256
// token signed by CF_WORKER_SHARED_SECRET.
app.use("/api/internal", requireCfWorker, createInternalRoutes(() => getPostgresPool()));

// (HEL-118 canonical-reads mounts live in the earlier block alongside their
// requireRole(...ALL_MEMBER_ROLES) gates; do not re-mount here.)

// ---------------------------------------------------------------------------
// Auth API — identity and social callback endpoints
// ---------------------------------------------------------------------------

app.use("/api/auth/social", authRouteRateLimiter, socialAuthRoutes);
app.use("/api/auth", authRouteRateLimiter, passwordAuthRoutes);

/** Returns the authenticated user's claims extracted from the auth token. */
app.get("/api/me", requireAuth, (req: AuthenticatedRequest, res) => {
  res.json({ user: req.auth });
});

// ---------------------------------------------------------------------------
// Templates API — used by the dashboard UI
// ---------------------------------------------------------------------------

/** List all templates (optionally filtered by category) */
app.get("/api/templates", requireAuth, workspaceResolver, requireRole(...ALL_MEMBER_ROLES), asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
  const { category } = req.query;
  let templates: WorkflowTemplate[];

  if (category && typeof category === "string") {
    templates = await getTemplatesByCategory(category as WorkflowTemplate["category"], req.workspaceId);
  } else {
    templates = await listTemplates(req.workspaceId);
  }

  // Distinguish seeded (built-in library) templates from user-imported/created
  // ones. The dashboard puts seeded templates on the Library tab only; the
  // Mine tab shows the user-owned set.
  const seededIds = new Set(WORKFLOW_TEMPLATES.map((t) => t.id));

  res.json({
    templates: templates.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      category: t.category,
      version: t.version,
      stepCount: t.steps.length,
      configFieldCount: t.configFields.length,
      seeded: seededIds.has(t.id),
    })),
    total: templates.length,
  });
}));

/** Create or update a user-managed template */
app.post("/api/templates", requireAuth, workspaceResolver, requireRole("admin", "developer"), asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
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

  const importedTemplate = getImportedTemplate(nextId, req.workspaceId);
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

  await saveImportedTemplate(template, req.auth?.sub, req.workspaceId);
  res.status(importedTemplate ? 200 : 201).json(template);
}));

/** Returns the current portable workflow schema contract */
app.get("/api/workflows/schema", (_req, res) => {
  res.json(getPortableWorkflowSchemaDescriptor());
});

/** Get a single template with full definition */
app.get("/api/templates/:id", requireAuth, workspaceResolver, requireRole(...ALL_MEMBER_ROLES), asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
  try {
    const template = await getTemplate(req.params.id, req.workspaceId);
    res.json(template);
  } catch {
    res.status(404).json({ error: `Template not found: ${req.params.id}` });
  }
}));

/** Export a template in the portable AutoFlow workflow format */
app.get("/api/templates/:id/export", requireAuth, workspaceResolver, requireRole(...ALL_MEMBER_ROLES), asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
  try {
    const template = await getTemplate(req.params.id, req.workspaceId);
    res.json(createPortableWorkflowBundle(template));
  } catch {
    res.status(404).json({ error: `Template not found: ${req.params.id}` });
  }
}));

/** Import a portable workflow template into the in-memory registry */
app.delete("/api/templates/:id", requireAuth, workspaceResolver, requireRole("admin", "developer"), asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
  const id = req.params.id;
  if (!id) {
    res.status(400).json({ error: "Template id is required" });
    return;
  }
  const removed = await deleteImportedTemplate(id, req.workspaceId);
  if (!removed) {
    res.status(404).json({ error: "Template not found" });
    return;
  }
  res.status(204).end();
}));

app.post("/api/templates/import", requireAuth, workspaceResolver, requireRole("admin", "developer"), asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
  let bundle;
  try {
    bundle = parsePortableWorkflowBundle(req.body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid portable workflow payload";
    res.status(400).json({ error: message });
    return;
  }

  try {
    await getTemplate(bundle.template.id, req.workspaceId);
    res.status(409).json({ error: `Template already exists: ${bundle.template.id}` });
    return;
  } catch {
    // Template id is available; continue with import.
  }

  await saveImportedTemplate(bundle.template, req.auth?.sub, req.workspaceId);
  res.status(201).json({
    imported: true,
    template: bundle.template,
    schemaVersion: bundle.schemaVersion,
  });
}));

/** Get sample data for a template (for dashboard preview) */
app.get("/api/templates/:id/sample", requireAuth, workspaceResolver, requireRole(...ALL_MEMBER_ROLES), asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
  try {
    const template = await getTemplate(req.params.id, req.workspaceId);
    res.json({
      sampleInput: template.sampleInput,
      expectedOutput: template.expectedOutput,
    });
  } catch {
    res.status(404).json({ error: `Template not found: ${req.params.id}` });
  }
}));

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
  requireRole("admin", "developer", "operator"),
  llmEndpointRateLimiter,
  requireEntitlement("runsPerMonth", {
    getCurrent: (req) => runStore.countByWorkspaceCurrentMonth(req.workspace!.id),
    delta: 1,
  }),
  asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
  const { templateId, input, config, priority, tags, metadata } = req.body as {
    templateId?: string;
    input?: Record<string, unknown>;
    config?: Record<string, unknown>;
    priority?: unknown;
    tags?: unknown;
    metadata?: unknown;
  };

  if (!templateId) {
    res.status(400).json({ error: "templateId is required" });
    return;
  }

  // HEL-700: optional run priority (critical/high/normal/low). Invalid values
  // are ignored (treated as the default `normal`) rather than rejected.
  const runPriority = isRunPriority(priority) ? priority : undefined;
  // HEL-704: optional run tags (≤10) for grouping/filtering. Sanitized; a bad
  // value degrades to no tags rather than failing the run.
  const runTags = sanitizeRunTags(tags);
  // HEL-705: optional initial run metadata (≤256KB). A bad shape/size is a 400.
  let runMetadata: Record<string, unknown>;
  try {
    runMetadata = sanitizeRunMetadata(metadata);
  } catch (err) {
    res.status(400).json({
      error: err instanceof RunMetadataError ? err.message : "invalid metadata",
    });
    return;
  }

  let template: WorkflowTemplate;
  try {
    template = await getTemplate(templateId, req.workspaceId);
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
        // HEL-700: persist priority so resume/retry/crash-resume preserve it.
        ...(runPriority ? { priority: runPriority } : {}),
      },
      tags: runTags,
      metadata: runMetadata,
      ...(userId !== undefined ? { userId } : {}),
    });
    const idempotencyKey = `${run.id}:0:${run.workflowVersionId ?? template.id}`;
    try {
      await addRunJob(
        runQueue,
        "run",
        {
          runId: run.id,
          templateId: template.id,
          workflowVersionId: run.workflowVersionId,
          workspaceId: req.workspaceId ?? "",
          stepIndex: 0,
          idempotencyKey,
          priority: runPriority,
        },
        { jobId: run.id, removeOnComplete: 100 },
      );
    } catch (enqueueErr) {
      const message =
        enqueueErr instanceof Error ? enqueueErr.message : String(enqueueErr);
      await runStore.update(run.id, {
        status: "failed",
        completedAt: new Date().toISOString(),
        error: `Run enqueue failed: ${message}`,
      });
      res.status(503).json({ error: `Failed to enqueue run: ${message}` });
      return;
    }
    res.status(202).json({ runId: run.id });
    return;
  }

  // Legacy in-process path (used when Redis is not configured).
  const run = await workflowEngine.startRun(template, resolvedInput, resolvedConfig, userId);
  res.status(202).json(run);
}));

/** List all runs, optionally filtered by templateId or status */
app.get("/api/runs", requireAuthOrQaBypass, workspaceResolver, asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
  const { templateId, status } = req.query;
  // HEL-704: optional tag filter — `?tags=a,b` or repeated `?tags=a&tags=b`.
  // AND-containment (a run must carry every requested tag).
  const tagsParam = req.query.tags;
  const requestedTags = sanitizeRunTags(
    typeof tagsParam === "string"
      ? tagsParam.split(",")
      : Array.isArray(tagsParam)
        ? tagsParam
        : [],
  );
  const runs = await runStore.list(
    typeof templateId === "string" ? templateId : undefined,
    req.auth?.sub,
    typeof status === "string" ? status : undefined,
    req.workspace?.id, // HEL-484: scope the list to the active workspace
    requestedTags.length > 0 ? requestedTags : undefined,
  );
  res.json({ runs, total: runs.length });
}));

/**
 * HEL-707: workspace usage / cost roll-up over the run history — total cost
 * (cents), token totals, run count, and a per-tag spend breakdown. Scoped to
 * the active workspace; optional `?tags=a,b` (AND-containment) and `?from=`/
 * `?to=` ISO date window. Reads the persisted step costLogs (no new storage).
 */
app.get(
  "/api/usage",
  requireAuthOrQaBypass,
  workspaceResolver,
  asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
    const tagsParam = req.query.tags;
    const tags = sanitizeRunTags(
      typeof tagsParam === "string" ? tagsParam.split(",") : Array.isArray(tagsParam) ? tagsParam : [],
    );
    const runs = await runStore.list(
      undefined,
      undefined,
      undefined,
      req.workspace?.id,
      tags.length > 0 ? tags : undefined,
    );

    const from = typeof req.query.from === "string" ? Date.parse(req.query.from) : NaN;
    const to = typeof req.query.to === "string" ? Date.parse(req.query.to) : NaN;
    const windowed = runs.filter((run) => {
      const startedAt = Date.parse(run.startedAt);
      if (!Number.isFinite(startedAt)) return true;
      if (Number.isFinite(from) && startedAt < from) return false;
      if (Number.isFinite(to) && startedAt > to) return false;
      return true;
    });

    res.json(rollUpUsage(windowed));
  }),
);

/**
 * List the caller's in-flight runs across the active workspace.
 *
 * Drives the dashboard's bottom-right RunTray. "In flight" = any non-
 * terminal status (queued / pending / running / awaiting_approval /
 * cancelling). Capped to 50 rows so the tray never floods.
 */
app.get(
  "/api/runs/in-flight",
  requireAuthOrQaBypass,
  workspaceResolver,
  asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
    const runs = await runStore.listInFlight(req.auth?.sub, req.workspace?.id);
    res.json({ runs, total: runs.length });
  }),
);

// ---------------------------------------------------------------------------
// Batch triggering (HEL-702) — fan a workflow out over N inputs.
//
// Registered BEFORE GET /api/runs/:id so "/api/runs/batch[/...]" never falls
// through to the :id route (same hazard the resume routes guard against).
// ---------------------------------------------------------------------------

/**
 * Fan a workflow out over N inputs as one durable batch.
 * Body: { templateId, inputs: object[], config?, dryRun? }
 * Returns { batchId, runIds, total } (202); each run executes async via the
 * worker. `dryRun: true` no-ops side-effecting steps in every run (HEL-786).
 */
app.post(
  "/api/runs/batch",
  requireAuthOrQaBypass,
  workspaceResolver,
  requireRole("admin", "developer", "operator"),
  llmEndpointRateLimiter,
  requireEntitlement("runsPerMonth", {
    // v1: confirm the workspace has run-quota headroom for at least one more
    // run. Exact N-run debit is a follow-up (see HEL-702 plan).
    getCurrent: (req) => runStore.countByWorkspaceCurrentMonth(req.workspace!.id),
  }),
  asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
    const { templateId, inputs, config, dryRun } = req.body as {
      templateId?: string;
      inputs?: unknown[];
      config?: Record<string, unknown>;
      dryRun?: boolean;
    };

    const workspaceId = req.workspace?.id;
    if (!workspaceId) {
      res.status(401).json({ error: "Authenticated workspace required" });
      return;
    }
    if (!templateId) {
      res.status(400).json({ error: "templateId is required" });
      return;
    }
    if (!Array.isArray(inputs) || inputs.length === 0) {
      res.status(400).json({ error: "inputs must be a non-empty array" });
      return;
    }
    if (inputs.length > MAX_BATCH_INPUTS) {
      res.status(400).json({ error: `inputs exceeds the per-batch cap of ${MAX_BATCH_INPUTS}` });
      return;
    }

    let template: WorkflowTemplate;
    try {
      template = await getTemplate(templateId, workspaceId);
    } catch {
      res.status(404).json({ error: `Template not found: ${templateId}` });
      return;
    }

    const result = await triggerBatch({
      template,
      inputs,
      runQueue: getRunQueue(),
      workspaceId,
      ...(req.auth?.sub !== undefined ? { userId: req.auth.sub } : {}),
      ...(config !== undefined ? { config } : {}),
      ...(dryRun !== undefined ? { dryRun } : {}),
    });

    if (!result.ok) {
      res.status(400).json({ error: result.reason });
      return;
    }
    res.status(202).json({ batchId: result.batchId, runIds: result.runIds, total: result.total });
  }),
);

/** List batches in the active workspace, newest first. */
app.get(
  "/api/runs/batch",
  requireAuthOrQaBypass,
  workspaceResolver,
  asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
    const workspaceId = req.workspace?.id;
    if (!workspaceId) {
      res.json({ batches: [], total: 0 });
      return;
    }
    const batches = await batchStore.list(workspaceId);
    res.json({
      batches: batches.map((b) => ({
        id: b.id,
        name: b.name,
        templateId: b.externalTemplateId,
        total: b.total,
        dryRun: b.dryRun,
        createdAt: b.createdAt,
      })),
      total: batches.length,
    });
  }),
);

/**
 * Batch handle: the batch plus aggregate run status. `done` is true once every
 * run is terminal — the signal an eval (HEL-776) polls before scoring outputs.
 */
app.get(
  "/api/runs/batch/:batchId",
  requireAuthOrQaBypass,
  workspaceResolver,
  asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
    const batch = await batchStore.get(req.params.batchId, req.workspace?.id);
    if (!batch) {
      res.status(404).json({ error: `Batch not found: ${req.params.batchId}` });
      return;
    }
    const runs = await runStore.listByIds(batch.runIds, req.workspace?.id);
    const statusCounts: Record<string, number> = {};
    for (const run of runs) {
      statusCounts[run.status] = (statusCounts[run.status] ?? 0) + 1;
    }
    const TERMINAL = new Set(["completed", "failed", "escalated", "canceled"]);
    const done = runs.length === batch.total && runs.every((r) => TERMINAL.has(r.status));
    res.json({
      id: batch.id,
      name: batch.name,
      templateId: batch.externalTemplateId,
      total: batch.total,
      dryRun: batch.dryRun,
      createdAt: batch.createdAt,
      statusCounts,
      done,
      runs: runs.map((r) => ({
        id: r.id,
        status: r.status,
        error: r.error,
        completedAt: r.completedAt,
      })),
    });
  }),
);

// ---------------------------------------------------------------------------
// Evals (HEL-776) — run a workflow over a dataset and measure output vs expected.
//
// An eval is ALWAYS a dry run (HEL-786): fanning a workflow over a dataset must
// never fire real webhooks / writes / emails. It builds on batch triggering
// (HEL-702): the dataset's inputs fan out as one dry-run batch, and the eval row
// stores the per-row expected outputs parallel to the batch's run ids. Scoring
// is computed on read by the pure scorer (src/engine/evalScorer.ts).
// ---------------------------------------------------------------------------

/**
 * Start an eval over a dataset.
 * Body: { templateId, dataset: [{ input, expected? }], name?, config? }
 * Fans the dataset out as a dry-run batch and returns { evalId, batchId, total,
 * runIds } (202). A row's `expected` defaults to the template's expectedOutput.
 */
app.post(
  "/api/evals",
  requireAuthOrQaBypass,
  workspaceResolver,
  requireRole("admin", "developer", "operator"),
  llmEndpointRateLimiter,
  requireEntitlement("runsPerMonth", {
    getCurrent: (req) => runStore.countByWorkspaceCurrentMonth(req.workspace!.id),
  }),
  asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
    const { templateId, dataset, name, config } = req.body as {
      templateId?: string;
      dataset?: Array<{ input?: unknown; expected?: unknown }>;
      name?: string;
      config?: Record<string, unknown>;
    };

    const workspaceId = req.workspace?.id;
    if (!workspaceId) {
      res.status(401).json({ error: "Authenticated workspace required" });
      return;
    }
    if (!templateId) {
      res.status(400).json({ error: "templateId is required" });
      return;
    }
    if (!Array.isArray(dataset) || dataset.length === 0) {
      res.status(400).json({ error: "dataset must be a non-empty array of { input, expected } rows" });
      return;
    }
    if (dataset.length > MAX_BATCH_INPUTS) {
      res.status(400).json({ error: `dataset exceeds the per-eval cap of ${MAX_BATCH_INPUTS}` });
      return;
    }

    let template: WorkflowTemplate;
    try {
      template = await getTemplate(templateId, workspaceId);
    } catch {
      res.status(404).json({ error: `Template not found: ${templateId}` });
      return;
    }

    const inputs = dataset.map((row) =>
      row && typeof row.input === "object" && row.input !== null ? row.input : {},
    );
    // A row's expected defaults to the template's expectedOutput when omitted.
    const expected = dataset.map((row) =>
      row && typeof row.expected === "object" && row.expected !== null
        ? row.expected
        : template.expectedOutput,
    );

    // An eval is ALWAYS a dry run — the safety contract from HEL-776.
    const result = await triggerBatch({
      template,
      inputs,
      runQueue: getRunQueue(),
      workspaceId,
      dryRun: true,
      ...(req.auth?.sub !== undefined ? { userId: req.auth.sub } : {}),
      ...(config !== undefined ? { config } : {}),
    });

    if (!result.ok) {
      res.status(400).json({ error: result.reason });
      return;
    }

    const evalId = randomUUID();
    await evalStore.create({
      id: evalId,
      workspaceId,
      batchId: result.batchId,
      externalTemplateId: template.id,
      name: typeof name === "string" && name.trim() ? name.trim() : `Eval: ${template.name}`,
      expected,
      ...(req.auth?.sub !== undefined ? { createdByUserId: req.auth.sub } : {}),
      createdAt: new Date().toISOString(),
    });

    res.status(202).json({
      evalId,
      batchId: result.batchId,
      total: result.total,
      runIds: result.runIds,
    });
  }),
);

/** List evals in the active workspace, newest first. */
app.get(
  "/api/evals",
  requireAuthOrQaBypass,
  workspaceResolver,
  asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
    const workspaceId = req.workspace?.id;
    if (!workspaceId) {
      res.json({ evals: [], total: 0 });
      return;
    }
    const evals = await evalStore.list(workspaceId);
    res.json({
      evals: evals.map((e) => ({
        id: e.id,
        name: e.name,
        templateId: e.externalTemplateId,
        batchId: e.batchId,
        total: e.expected.length,
        createdAt: e.createdAt,
      })),
      total: evals.length,
    });
  }),
);

/**
 * Eval results: per-row pass/fail vs expected + an aggregate score. `done` is
 * true once every run is terminal — poll until then, the scores firm up as runs
 * complete.
 */
app.get(
  "/api/evals/:evalId",
  requireAuthOrQaBypass,
  workspaceResolver,
  asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
    const workspaceId = req.workspace?.id;
    const evalRun = await evalStore.get(req.params.evalId, workspaceId);
    if (!evalRun) {
      res.status(404).json({ error: `Eval not found: ${req.params.evalId}` });
      return;
    }
    const batch = await batchStore.get(evalRun.batchId, workspaceId);
    const runIds = batch?.runIds ?? [];
    const runs = await runStore.listByIds(runIds, workspaceId);
    const runsById = new Map<string, ScorableRun>(
      runs.map((r) => [
        r.id,
        {
          status: r.status,
          ...(r.output !== undefined ? { output: r.output } : {}),
          ...(r.error !== undefined ? { error: r.error } : {}),
        },
      ]),
    );
    const rows = buildEvalRows(runIds, evalRun.expected, runsById);
    const summary = summarizeEval(rows);
    const TERMINAL = new Set(["completed", "failed", "escalated", "canceled"]);
    const done = runs.length === runIds.length && runs.every((r) => TERMINAL.has(r.status));
    res.json({
      id: evalRun.id,
      name: evalRun.name,
      templateId: evalRun.externalTemplateId,
      batchId: evalRun.batchId,
      dryRun: true,
      total: runIds.length,
      done,
      summary,
      rows,
      createdAt: evalRun.createdAt,
    });
  }),
);

/** Get a single run by ID */
app.get("/api/runs/:id", requireAuthOrQaBypass, workspaceResolver, asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
  const run = await runStore.get(req.params.id, req.workspace?.id); // HEL-484: workspace-scoped
  const userId = req.auth?.sub;
  if (!run || (run.userId !== undefined && run.userId !== userId)) {
    res.status(404).json({ error: `Run not found: ${req.params.id}` });
    return;
  }
  res.json(run);
}));

/**
 * HEL-704: add tags to an existing run (post-trigger / "from inside a run").
 * Unions with the run's current tags, sanitized + capped; workspace-scoped.
 */
app.post(
  "/api/runs/:id/tags",
  requireAuthOrQaBypass,
  workspaceResolver,
  requireRole("admin", "developer", "operator"),
  asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
    const { tags } = req.body as { tags?: unknown };
    const updated = await runStore.addTags(req.params.id, tags, req.workspace?.id);
    if (!updated) {
      res.status(404).json({ error: `Run not found: ${req.params.id}` });
      return;
    }
    res.json({ id: updated.id, tags: updated.tags ?? [] });
  }),
);

/**
 * HEL-705: mutate a run's metadata. Body is `{ ops: [...] }` (set / append /
 * increment / remove / replace) or `{ metadata: {...} }` (whole-object
 * replace). Workspace-scoped; 256KB-capped (over-cap / malformed ⇒ 400).
 */
app.post(
  "/api/runs/:id/metadata",
  requireAuthOrQaBypass,
  workspaceResolver,
  requireRole("admin", "developer", "operator"),
  asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
    let updated;
    try {
      const ops = parseRunMetadataOps(req.body);
      updated = await runStore.applyMetadata(req.params.id, ops, req.workspace?.id);
    } catch (err) {
      if (err instanceof RunMetadataError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
    if (!updated) {
      res.status(404).json({ error: `Run not found: ${req.params.id}` });
      return;
    }
    res.json({ id: updated.id, metadata: updated.metadata ?? {} });
  }),
);

/**
 * HEL-707: per-run usage — estimated LLM cost (cents), token totals, wall-clock
 * duration, and step count, rolled up from the run's persisted step costLogs.
 */
app.get(
  "/api/runs/:id/usage",
  requireAuthOrQaBypass,
  workspaceResolver,
  asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
    const run = await runStore.get(req.params.id, req.workspace?.id); // workspace-scoped
    const userId = req.auth?.sub;
    if (!run || (run.userId !== undefined && run.userId !== userId)) {
      res.status(404).json({ error: `Run not found: ${req.params.id}` });
      return;
    }
    res.json(computeRunUsage(run));
  }),
);

/**
 * HEL-708: mint a scoped, short-TTL, read-only realtime token for a run so a
 * browser can subscribe to its live stream without a full session.
 * Authenticated + workspace-scoped; verified on the public stream endpoint.
 */
app.post(
  "/api/runs/:id/realtime-token",
  requireAuthOrQaBypass,
  workspaceResolver,
  asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
    if (!isRealtimeTokenConfigured()) {
      res.status(503).json({ error: "Realtime tokens are not configured (set REALTIME_TOKEN_SECRET)" });
      return;
    }
    const workspaceId = req.workspace?.id;
    if (!workspaceId) {
      res.status(400).json({ error: "workspace is required" });
      return;
    }
    const run = await runStore.get(req.params.id, workspaceId);
    const userId = req.auth?.sub;
    if (!run || (run.userId !== undefined && run.userId !== userId)) {
      res.status(404).json({ error: `Run not found: ${req.params.id}` });
      return;
    }
    const { token, payload } = mintRealtimeToken({ workspaceId, runId: run.id });
    res.json({ token, runId: run.id, expiresAt: new Date(payload.exp * 1000).toISOString() });
  }),
);

/**
 * HEL-708: public realtime stream for a single run, gated by a scoped token
 * (NOT a session). Verify the token, confirm it matches the path run id, then
 * stream that run's lifecycle/activity events + a current-status snapshot. No
 * requireAuth — the token IS the credential.
 */
app.get(
  "/api/realtime/runs/:id/stream",
  asyncHandler(async (req, res) => {
    if (!isRealtimeTokenConfigured()) {
      res.status(503).json({ error: "Realtime tokens are not configured" });
      return;
    }
    const runId = req.params.id;
    let payload;
    try {
      payload = verifyRealtimeToken(typeof req.query.token === "string" ? req.query.token : "");
    } catch (err) {
      const reason = err instanceof InvalidRealtimeTokenError ? err.reason : "invalid";
      res.status(401).json({ error: `realtime token ${reason}` });
      return;
    }
    if (payload.run_id !== runId) {
      res.status(403).json({ error: "token does not grant access to this run" });
      return;
    }
    await handleStreamSse(req, res, {
      workspaceId: payload.workspace_id,
      filter: (envelope) => {
        const e = envelope.event as { runId?: string };
        return typeof e.runId === "string" && e.runId === runId;
      },
      snapshot: async () => {
        const run = await runStore.get(runId, payload.workspace_id);
        return run
          ? { id: run.id, status: run.status, tags: run.tags ?? [], metadata: run.metadata ?? {} }
          : null;
      },
    });
  }),
);

/**
 * Cancel a run.
 *
 * HEL-108 originally only accepted 'queued'/'pending' runs (removed the
 * BullMQ job and flipped status straight to 'canceled').
 *
 * HEL-175 extends this to 'running' runs as well, but rather than killing
 * the worker mid-step it flips the status to 'cancelling'. The worker
 * checks `runs.status` at the next safe checkpoint (e.g. before invoking
 * `runAgentTurn()`) and transitions 'cancelling' → 'canceled' on the way
 * out. The HTTP response is 202 Accepted for in-flight cancellations so
 * the dashboard knows the cancel was registered but execution may take a
 * moment to wind down.
 *
 * Status that allows cancellation: queued | pending | running.
 * Anything else (completed, failed, canceled, etc.) returns 409.
 */
app.delete("/api/runs/:id/cancel", requireAuthOrQaBypass, workspaceResolver, requireRole("admin", "developer", "operator"), asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
  const runId = req.params.id;
  const run = await runStore.get(runId);
  const userId = req.auth?.sub;

  if (!run || (run.userId !== undefined && run.userId !== userId)) {
    res.status(404).json({ error: `Run not found: ${runId}` });
    return;
  }

  const cancellable = new Set(["queued", "pending", "running"]);
  if (!cancellable.has(run.status)) {
    res.status(409).json({ error: `Run cannot be canceled: status is '${run.status}'` });
    return;
  }

  const isInFlight = run.status === "running";

  const runQueue = getRunQueue();
  if (runQueue) {
    try {
      const job = await runQueue.getJob(runId);
      if (job) {
        // If the job hasn't actually picked up yet, remove it outright —
        // safer than letting it start and then race the cancellation flag.
        // BullMQ's `getState()` would let us be more precise; `.remove()`
        // on an in-flight job is a no-op so this is safe either way.
        await job.remove();
      }
    } catch {
      // Job may already be gone or in-flight; continue to update DB status.
    }
  }

  if (isInFlight) {
    // HEL-175: cooperative cancellation. The worker's checkpoint
    // (executeAgentPrompt et al.) reads `runs.status` and bails before
    // the next external call.
    const updated = await runStore.update(runId, { status: "cancelling" });
    res.status(202).json(updated);
    return;
  }

  // Queued/pending: never started → flip straight to canceled.
  const canceled = await runStore.update(runId, {
    status: "canceled",
    completedAt: new Date().toISOString(),
  });
  res.json(canceled);
}));

/**
 * Re-enqueue a failed run from the DLQ.
 * Resets status to "queued" and re-adds the job to the main runs queue.
 * Returns 409 if the run is not in the "failed" state.
 */
app.post("/api/runs/:id/retry", requireAuthOrQaBypass, workspaceResolver, requireRole("admin", "developer", "operator"), asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
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

  await addRunJob(
    runQueue,
    "run",
    {
      runId,
      templateId: run.templateId,
      workflowVersionId: run.workflowVersionId,
      workspaceId: run.workspaceId ?? "",
      stepIndex: 0,
      idempotencyKey: `${runId}:retry:${Date.now()}`,
      priority: run.runtimeState?.priority,
    },
    { jobId: runId }
  );

  const updated = await runStore.update(runId, {
    status: "queued",
    completedAt: undefined,
    error: undefined,
  });
  res.json(updated);
}));

/**
 * Re-run a finished run using the CURRENT (latest) workflow version.
 * Creates a fresh run record and enqueues it. Use /retry to replay with the
 * original version instead.
 */
app.post("/api/runs/:id/replay-with-latest", requireAuthOrQaBypass, workspaceResolver, requireRole("admin", "developer", "operator"), asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
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
      latestDag = await getTemplate(run.templateId, run.workspaceId);
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
      // HEL-700: inherit the source run's priority.
      ...(run.runtimeState?.priority ? { priority: run.runtimeState.priority } : {}),
    },
    ...(userId !== undefined ? { userId } : {}),
  });

  const runQueue = getRunQueue();
  if (runQueue) {
    const idempotencyKey = `${newRun.id}:0:replay-latest:${Date.now()}`;
    try {
      await addRunJob(
        runQueue,
        "run",
        {
          runId: newRun.id,
          templateId: run.templateId,
          workflowVersionId: newRun.workflowVersionId,
          workspaceId: run.workspaceId ?? "",
          stepIndex: 0,
          idempotencyKey,
          priority: newRun.runtimeState?.priority,
        },
        { jobId: newRun.id, removeOnComplete: 100 },
      );
    } catch (enqueueErr) {
      const message =
        enqueueErr instanceof Error ? enqueueErr.message : String(enqueueErr);
      await runStore.update(newRun.id, {
        status: "failed",
        completedAt: new Date().toISOString(),
        error: `Replay enqueue failed: ${message}`,
      });
      res.status(503).json({ error: `Failed to enqueue replay: ${message}` });
      return;
    }
    res.status(202).json({ runId: newRun.id });
    return;
  }

  res.status(202).json(newRun);
}));

/**
 * POST /api/runs/from-node (HEL-693)
 *
 * Body: { templateId, fromStepId, sourceRunId }
 *
 * Run the current (saved) workflow from `fromStepId`, reusing the cached outputs
 * of the upstream steps from `sourceRunId` (matched by step id) so unchanged
 * upstream nodes aren't re-executed — the editor's "run from here". Returns 202
 * { runId }. Registered before /api/runs/:id... routes don't collide (this is an
 * exact path).
 */
app.post(
  "/api/runs/from-node",
  requireAuthOrQaBypass,
  workspaceResolver,
  requireRole("admin", "developer", "operator"),
  llmEndpointRateLimiter,
  requireEntitlement("runsPerMonth", {
    getCurrent: (req) => runStore.countByWorkspaceCurrentMonth(req.workspace!.id),
  }),
  asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
    const { templateId, fromStepId, sourceRunId } = req.body as {
      templateId?: string;
      fromStepId?: string;
      sourceRunId?: string;
    };
    const workspaceId = req.workspace?.id;
    if (!workspaceId) {
      res.status(401).json({ error: "Authenticated workspace required" });
      return;
    }
    if (!templateId || !fromStepId || !sourceRunId) {
      res.status(400).json({ error: "templateId, fromStepId, and sourceRunId are required" });
      return;
    }

    // Tenancy: the source run must belong to this workspace + caller.
    const source = await runStore.get(sourceRunId, workspaceId);
    if (!source || (source.userId !== undefined && source.userId !== req.auth?.sub)) {
      res.status(404).json({ error: `Source run not found: ${sourceRunId}` });
      return;
    }

    let template: WorkflowTemplate;
    try {
      template = await getTemplate(templateId, workspaceId);
    } catch {
      res.status(404).json({ error: `Template not found: ${templateId}` });
      return;
    }

    const fromStepIndex = template.steps.findIndex((s) => s.id === fromStepId);

    // Route through the queue when Redis is available (worker retry/DLQ/resume);
    // skipExecution leaves the run `queued` for the worker — mirrors replay.
    const runQueue = getRunQueue();
    let run;
    try {
      run = await workflowEngine.runFromNode({
        template,
        fromStepId,
        sourceRunId,
        ...(req.auth?.sub !== undefined ? { userId: req.auth.sub } : {}),
        skipExecution: Boolean(runQueue),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(/not found/i.test(message) ? 404 : 400).json({ error: message });
      return;
    }

    if (runQueue) {
      const idempotencyKey = `${run.id}:${fromStepIndex}:from-node`;
      try {
        await addRunJob(
          runQueue,
          "run",
          {
            runId: run.id,
            templateId: run.templateId,
            workflowVersionId: run.workflowVersionId,
            workspaceId: run.workspaceId ?? "",
            stepIndex: fromStepIndex,
            idempotencyKey,
            priority: run.runtimeState?.priority,
          },
          { jobId: run.id, removeOnComplete: 100 },
        );
      } catch (enqueueErr) {
        const message = enqueueErr instanceof Error ? enqueueErr.message : String(enqueueErr);
        await runStore.update(run.id, {
          status: "failed",
          completedAt: new Date().toISOString(),
          error: `Run-from-node enqueue failed: ${message}`,
        });
        res.status(503).json({ error: `Failed to enqueue run: ${message}` });
        return;
      }
    }

    res.status(202).json({ runId: run.id });
  }),
);

/**
 * POST /api/runs/:runId/replay-from-step (HEL-176)
 *
 * Body: { stepIndex: number }
 *
 * Creates a new run that resumes execution from `stepIndex`, cloning the
 * outputs of steps 0..stepIndex-1 so already-successful work (LLM calls,
 * side effects) isn't redone. The original run is left intact.
 *
 * Returns 200 with the new run on success, 400 on validation failure,
 * 404 when the run is unknown / cross-workspace, 503 if Postgres isn't
 * configured (matches the rest of the runs API).
 *
 * Emits a `run.replayed_from_step` activity event so the operator
 * dashboard can show the lineage.
 */
app.post(
  "/api/runs/:runId/replay-from-step",
  requireAuthOrQaBypass,
  workspaceResolver,
  asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
    const runId = req.params["runId"];
    const userId = req.auth?.sub;
    const { stepIndex } = (req.body ?? {}) as { stepIndex?: unknown };

    if (typeof stepIndex !== "number" || !Number.isFinite(stepIndex)) {
      res.status(400).json({ error: "stepIndex (number) is required" });
      return;
    }

    const run = await runStore.get(runId);
    if (!run || (run.userId !== undefined && run.userId !== userId)) {
      res.status(404).json({ error: `Run not found: ${runId}` });
      return;
    }

    // Cross-workspace guard: if a workspace is bound to the request,
    // it must match the original run's workspace. Mirrors the
    // workspace-resolver pattern used by the other run routes.
    if (
      req.workspaceId &&
      run.workspaceId &&
      req.workspaceId !== run.workspaceId
    ) {
      res.status(404).json({ error: `Run not found: ${runId}` });
      return;
    }

    // HEL-176 Codex P2: only allow replay for terminal failure states.
    // Replaying a `running` / `queued` run can race with the original's
    // remaining steps; replaying a `completed` run duplicates
    // side-effecting work (the whole reason this feature exists is to
    // recover from a failure, not fork from a successful run).
    if (run.status !== "failed" && run.status !== "escalated") {
      res.status(409).json({
        error: `Cannot replay run in status '${run.status}'; only 'failed' or 'escalated' runs are replayable`,
      });
      return;
    }

    // HEL-176 Codex P1: route through the BullMQ queue when Redis is
    // available so the replay benefits from worker retry/DLQ/cancellation
    // and survives API restarts — mirrors the POST /api/runs path.
    const runQueue = getRunQueue();
    let newRun;
    try {
      newRun = await workflowEngine.replayFromStep(runId, stepIndex, userId, {
        skipExecution: Boolean(runQueue),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/not found/i.test(message)) {
        res.status(404).json({ error: message });
        return;
      }
      res.status(400).json({ error: message });
      return;
    }

    if (runQueue) {
      const idempotencyKey = `${newRun.id}:${stepIndex}:replay-from-step`;
      try {
        await addRunJob(
          runQueue,
          "run",
          {
            runId: newRun.id,
            templateId: newRun.templateId,
            workflowVersionId: newRun.workflowVersionId,
            workspaceId: newRun.workspaceId ?? "",
            stepIndex,
            idempotencyKey,
            priority: newRun.runtimeState?.priority,
          },
          { jobId: newRun.id, removeOnComplete: 100 },
        );
      } catch (enqueueErr) {
        // HEL-176 Codex P2: if runQueue.add throws (transient Redis
        // outage etc.), the new run is already `queued` but no job
        // exists to execute it. Mark it failed so it doesn't sit
        // forever pretending to be active, and surface a 503.
        const message =
          enqueueErr instanceof Error ? enqueueErr.message : String(enqueueErr);
        await runStore
          .update(newRun.id, {
            status: "failed",
            completedAt: new Date().toISOString(),
            error: `Replay enqueue failed: ${message}`,
          })
          .catch((rollbackErr) => {
            console.error(
              "[runs] replay-from-step orphan rollback failed:",
              (rollbackErr as Error).message,
            );
          });
        res.status(503).json({
          error: "Run queue unavailable — replay was rolled back",
          detail: message,
        });
        return;
      }
    }

    // HEL-176: best-effort activity event so the operator dashboard
    // shows the replay lineage. Mirrors the worker.ts pattern of
    // fire-and-forget activity inserts that never block the response.
    if (isPostgresPersistenceEnabled() && newRun.workspaceId) {
      const pool = getPostgresPool();
      pool
        .query(
          `INSERT INTO activity_events (workspace_id, kind, actor, subject, payload, occurred_at)
           VALUES ($1::uuid, 'run.replayed_from_step', $2::jsonb, $3::jsonb, $4::jsonb, now())`,
          [
            newRun.workspaceId,
            JSON.stringify({ type: "user", id: userId ?? "unknown" }),
            JSON.stringify({ type: "execution", id: newRun.id, label: newRun.templateName }),
            JSON.stringify({
              originalRunId: runId,
              newRunId: newRun.id,
              fromStepIndex: stepIndex,
            }),
          ],
        )
        .catch((dbErr: Error) => {
          console.error("[runs] replay-from-step activity_events insert failed:", dbErr.message);
        });
    }

    res.status(200).json({ run: newRun });
  }),
);

// HEL-481: removed the legacy inline `GET /api/observability` handler. It had
// weaker auth (only requireAuth, no role/workspace gate) and read the global
// in-memory run store. The canonical, workspace-scoped observability reads live
// on observabilityRoutes (mounted above at /api/observability):
// GET /api/observability/events, /events/stream, /throughput.

// ---------------------------------------------------------------------------
// Routing analytics API — recent classifier decisions for dashboarding
// ---------------------------------------------------------------------------

app.get(
  "/api/analytics/routing-decisions",
  requireAuth,
  workspaceResolver,
  requireRole("admin"),
  (req: WorkspaceAwareRequest, res) => {
    const workspaceId = req.workspace?.id;
    if (!workspaceId) {
      res.status(500).json({ error: "Server misconfiguration: workspace context missing." });
      return;
    }

    const decisions = listClassificationDecisionsForWorkspace(workspaceId);
    res.json({
      decisions,
      total: decisions.length,
      capacity: getClassificationDecisionLogCapacity(),
    });
  },
);

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
app.post("/api/runs/file", requireAuthOrQaBypass, workspaceResolver, requireRole("admin", "developer", "operator"), upload.single("file"), asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
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
    template = await getTemplate(templateId, req.workspaceId);
  } catch {
    res.status(404).json({ error: `Template not found: ${templateId}` });
    return;
  }

  // Resolve an OpenAI key from the user's default LLM config (for vision/Whisper)
  const userId = req.auth?.sub;
  let openaiApiKey: string | undefined;
  if (userId) {
    const defaultConfig = await llmConfigStore.getDecryptedDefaultAsync(userId);
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

  // HEL-355: persist the uploaded bytes to object storage + record a
  // file_objects row, then thread the fileId into the run. Best-effort — a
  // storage hiccup (or a QA-bypass user without a user_profiles row) must not
  // break run creation; the run still receives the parsed `content`.
  let fileId: string | undefined;
  if (req.workspaceId && userId) {
    try {
      const put = await getStorageAdapter().putObject({
        workspaceId: req.workspaceId,
        collection: "run-input",
        filename: req.file.originalname,
        body: req.file.buffer,
        contentType: req.file.mimetype,
        contentLength: req.file.size,
      });
      const row = await fileObjectStore.insert(
        { workspaceId: req.workspaceId, userId },
        {
          uploadedBy: userId,
          collection: "run-input",
          storageKey: put.storageKey,
          provider: put.provider,
          bucket: put.bucket,
          filename: req.file.originalname,
          mimeType: req.file.mimetype,
          byteSize: req.file.size,
        },
      );
      fileId = row.id;
    } catch (err) {
      console.error(
        "[runs/file] storage persistence failed; continuing without fileId:",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  const input: Record<string, unknown> = {
    content: parsed.content,
    mimeType: parsed.mimeType,
    filename: parsed.filename,
  };
  if (req.workspaceId) {
    input.workspaceId = req.workspaceId;
  }
  if (fileId) {
    input.fileId = fileId;
  }

  const run = await workflowEngine.startRun(template, input, undefined, userId);

  // HEL-355: record the persisted file in the run's audit trail (best-effort).
  if (fileId && req.workspaceId && userId) {
    try {
      await auditService.recordAction(
        { workspaceId: req.workspaceId, userId, actorUserId: userId },
        {
          category: "execution",
          action: "run_file_persisted",
          target: { type: "file_object", id: fileId },
          metadata: { runId: run.id, collection: "run-input", byteSize: req.file.size },
        },
      );
    } catch (err) {
      console.error(
        "[runs/file] audit recordAction failed:",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  res.status(202).json(run);
}));

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
app.post("/api/workflows/generate", requireAuth, workspaceResolver, requireRole("admin", "developer"), llmEndpointRateLimiter, asyncHandler<WorkspaceAwareRequest>(async (req, res) => {
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
      ? await llmConfigStore.getDecryptedAsync(llmConfigId, userId)
      : await llmConfigStore.getDecryptedDefaultAsync(userId);

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
    // Error hygiene (HEL-437): don't echo the raw model response to the
    // client — it can carry prompt fragments or injected content and is
    // unbounded. Log a truncated server-side preview for debugging instead.
    console.error(
      `[workflows/generate] structured-output extraction failed: ${msg}; raw preview: ${rawText.slice(0, 500)}`,
    );
    res.status(422).json({ error: `LLM returned invalid JSON: ${msg}` });
    return;
  }

  res.json({ steps });
}));

// HEL-27: mount the canonical workflows router AFTER the specific
// /api/workflows/schema + /api/workflows/generate handlers above so those
// continue to win on path match. The router only defines GET/, GET/:id,
// POST/, POST/:id/versions — none of which conflict with /schema or
// /generate (those are top-level paths handled before this point).
app.use("/api/workflows", requireAuth, workspaceResolver, requireRole("admin", "developer"), canonicalWorkflowRoutes);

// ---------------------------------------------------------------------------
// POST /api/goals/team-assembly
// ---------------------------------------------------------------------------

app.post("/api/goals/team-assembly", requireAuth, workspaceResolver, requireRole("admin", "developer"), llmEndpointRateLimiter, asyncHandler<AuthenticatedRequest>(async (req, res) => {
  const parsedRequest = teamAssemblyRequestSchema.safeParse(req.body);
  if (!parsedRequest.success) {
    const issue = parsedRequest.error.issues[0];
    const path = issue?.path?.[0];
    // zod v4 reports missing fields as `invalid_type` with code, not
    // a literal "Required" message. Re-shape into a path-aware string
    // for the API consumer.
    const isMissing =
      issue?.code === "invalid_type" &&
      typeof issue.message === "string" &&
      (/expected\s+\S+,\s+received\s+undefined/i.test(issue.message) ||
        issue.message === "Required");
    const message =
      isMissing && typeof path === "string"
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

  const resolved = await llmConfigStore.getDecryptedDefaultAsync(userId);
  if (!resolved) {
    res.status(422).json({
      error: "No LLM provider configured. Go to Settings > LLM Providers to connect one.",
    });
    return;
  }

  const provider = getProvider({
    provider: resolved.config.provider,
    model: resolved.config.model,
    apiKey: resolved.apiKey,
    responseFormat: { type: "json_object" },
    maxOutputTokens: 8192,
  });

  let rawText: string;
  try {
    rawText = (
      await provider(
        buildTeamAssemblyPrompt({
          ...parsedRequest.data,
          roleLibrary: parsedRequest.data.roleLibrary ?? [],
        }),
      )
    ).text;
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
}));

// ---------------------------------------------------------------------------
// Webhook trigger — activates a workflow from an external event
// ---------------------------------------------------------------------------

/**
 * POST /api/webhooks/:templateId
 * Trigger a workflow run from an inbound webhook.
 * The entire request body is forwarded as the run input.
 *
 * HEL-265: authenticate enabled webhook triggers with a per-template HMAC
 * secret. `WEBHOOK_TRIGGER_SECRETS` is a JSON object keyed by template id:
 *   { "tpl-support-bot": { "secret": "...", "userId": "..." } }
 * The run owner is resolved from this registry, never from caller-provided
 * identity headers.
 */
app.post("/api/webhooks/:templateId", asyncHandler(async (req, res) => {
  if (process.env.WEBHOOK_TRIGGERS_ENABLED !== "true") {
    res.status(503).json({
      error:
        "Webhook triggers are disabled in this environment pending signed-payload support",
    });
    return;
  }

  const { templateId } = req.params;

  let template: WorkflowTemplate;
  try {
    // Webhook trigger is authenticated by the per-template secret below, not a
    // workspace session — resolve the template id globally.
    template = await getTemplate(templateId);
  } catch {
    res.status(404).json({ error: `Template not found: ${templateId}` });
    return;
  }

  const auth = getWebhookTriggerSecretConfig(templateId);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }

  try {
    verifyHmac({
      secret: auth.secret,
      rawBody: (req as RawBodyRequest).rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}), "utf8"),
      signatureHeader: req.header("X-AutoFlow-Signature"),
      prefix: "sha256=",
    });
  } catch {
    res.status(401).json({ error: "Invalid webhook signature" });
    return;
  }

  const input = req.body as Record<string, unknown>;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    res.status(400).json({ error: "Webhook body must be a JSON object" });
    return;
  }

  const run = await workflowEngine.startRun(
    template,
    input,
    undefined,
    auth.userId
  );
  res.status(202).json({ runId: run.id, status: run.status });
}));

// ---------------------------------------------------------------------------
// Approvals API — HITL pause-and-wait approval requests
// ---------------------------------------------------------------------------

/**
 * GET /api/approvals
 * Query params: status=pending|approved|rejected|timed_out
 * Returns all approval requests, optionally filtered by status.
 */
app.get("/api/approvals", requireAuth, asyncHandler<AuthenticatedRequest>(async (req, res) => {
  const userId = req.auth?.sub;
  const { status } = req.query;
  const validStatuses = ["pending", "approved", "rejected", "request_changes", "timed_out"];
  const filter =
    typeof status === "string" && validStatuses.includes(status)
      ? (status as "pending" | "approved" | "rejected" | "request_changes" | "timed_out")
      : undefined;
  const approvals = (await approvalStore.list(filter)).filter((approval) => approval.assignee === userId);
  res.json({ approvals, total: approvals.length });
}));

/**
 * GET /api/approvals/notifications
 * Returns in-app approval notifications for the authenticated approver.
 */
app.get("/api/approvals/notifications", requireAuth, asyncHandler<AuthenticatedRequest>(async (req, res) => {
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
}));

/**
 * GET /api/approvals/:id
 * Returns a single approval request by ID.
 */
app.get("/api/approvals/:id", requireAuth, asyncHandler<AuthenticatedRequest>(async (req, res) => {
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
}));

/**
 * GET /api/approvals/:id/notifications
 * Returns the durable notification outbox rows created for an approval request.
 */
app.get("/api/approvals/:id/notifications", requireAuth, asyncHandler<AuthenticatedRequest>(async (req, res) => {
  const approval = await approvalStore.get(req.params.id);
  const userId = req.auth?.sub;
  if (!approval || (approval.userId !== undefined && approval.userId !== userId)) {
    res.status(404).json({ error: `Approval request not found: ${req.params.id}` });
    return;
  }

  const notifications = await approvalNotificationStore.listByApprovalRequest(req.params.id);
  res.json({ notifications, total: notifications.length });
}));

/**
 * POST /api/approvals/:id/resolve
 * Body: { decision: "approved" | "rejected" | "request_changes", comment?: string }
 * Resolves the approval request, resuming or terminating the paused run.
 */
app.post("/api/approvals/:id/resolve", requireAuth, workspaceResolver, requireRole("admin", "approver", "operator"), asyncHandler<AuthenticatedRequest>(async (req, res) => {
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
  // HEL-697: the approval step now parks the run (awaiting_approval) and
  // releases its worker slot instead of blocking on waitForDecision, so a
  // resolved approval must be driven back to running. Kick the resume sweep
  // immediately for low latency; the periodic approvalResumeCoordinator sweep
  // is the durable backstop (and the only resumer if this best-effort call
  // fails). The sweep is advisory-locked + status-guarded, so this can't
  // double-resume.
  void runApprovalResumeSweep().catch((err) => {
    console.error("[approvals] resume sweep after resolve failed:", (err as Error).message);
  });
  const workspaceId = (req as WorkspaceAwareRequest).workspace?.id;
  if (workspaceId) {
    void invalidateWorkspaceCache(workspaceId, ["approvals", "home"]);
  }
  res.json({ success: true });
}));

/**
 * GET /api/executions/:id/state
 * Returns the persisted paused execution state for an awaiting-approval run.
 */
app.get("/api/executions/:id/state", requireAuth, asyncHandler(async (req, res) => {
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
}));

/**
 * POST /api/executions/:id/resume
 * Manually resumes a paused execution after its approval decision has already
 * been persisted and the original live worker is gone.
 */
app.post("/api/executions/:id/resume", requireAuth, workspaceResolver, requireRole("admin", "developer", "operator"), asyncHandler<AuthenticatedRequest>(async (req, res) => {
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
        : await getTemplate(run.templateId, run.workspaceId);
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
}));

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get("/health", asyncHandler(async (_req, res) => {
  const { checkPostgresConnection, isPostgresConfigured: isPgConfigured } = await import("./db/postgres");
  const pgConfigured = isPgConfigured();
  const pgConnected = pgConfigured ? await checkPostgresConnection() : false;
  const redisConfigured = isRedisConfigured();
  const redisConnected = redisConfigured ? await checkRedisConnection() : false;
  let runs = [] as Awaited<ReturnType<typeof runStore.list>>;
  let runStoreError: string | null = null;

  try {
    runs = await runStore.list();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[health] Run stats unavailable:", message);
    runStoreError = message;
  }

  const degraded =
    Boolean(runStoreError) || (redisConfigured && !redisConnected) || (pgConfigured && !pgConnected);

  res.json({
    status: degraded ? "degraded" : "ok",
    templates: (await listTemplates()).length,
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
    redis: {
      configured: redisConfigured,
      connected: redisConnected,
    },
  });
}));

app.get("/api/connectors/health", requireAuthOrQaBypass, asyncHandler<AuthenticatedRequest>(async (req, res) => {
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
}));

if (process.env.NODE_ENV !== "test" && process.env.AUTOFLOW_ENABLE_APPROVAL_RESUME_SWEEPER !== "false") {
  startApprovalResumeCoordinator();
}

if (process.env.NODE_ENV !== "test" && process.env.AUTOFLOW_ENABLE_APPROVAL_NOTIFICATION_SWEEPER !== "false") {
  startApprovalNotificationCoordinator();
}

// HEL-502: the ticket-SLA notification senders (inbox/email/agent_wake) are all
// no-ops and setTicketNotificationSender is never wired, so running this sweeper
// only churns durable rows to `sent` with zero actual delivery — masking the
// gap. Gate it OPT-IN (default off) until real transports exist; until then
// pending SLA notifications stay visible (as `pending`) via the ticket
// notifications API rather than being falsely marked delivered. Flip
// AUTOFLOW_ENABLE_TICKET_NOTIFICATION_SWEEPER=true once a real sender is wired.
if (process.env.NODE_ENV !== "test" && process.env.AUTOFLOW_ENABLE_TICKET_NOTIFICATION_SWEEPER === "true") {
  startTicketNotificationCoordinator();
}

if (process.env.NODE_ENV !== "test" && process.env.AUTOFLOW_ENABLE_PROMPT_ROUTINE_SCHEDULER !== "false") {
  startPromptRoutineCoordinator();
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

// HEL-183: global typed-error middleware for `Tier1ConnectorError` (and any
// subclass, e.g. each connector's per-package `ConnectorError`). Lets
// route handlers wrap with `asyncHandler(...)` and `throw new
// ConnectorError(...)` directly — no per-route try/catch + `handleError`
// boilerplate. The middleware preserves the original `statusCode` and
// `type` fields on the response body.
//
// IMPORTANT: must run AFTER Sentry's error handler so Sentry still
// captures the error (Sentry's handler calls next(err), so the chain
// reaches here).
app.use(
  (
    err: Error & { statusCode?: number; type?: string },
    _req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    // Tier1ConnectorError + every per-connector subclass extends Error
    // with `statusCode` + `type`. Check structurally rather than
    // importing the class to avoid circular-import risk from src/app.ts.
    const status = typeof err.statusCode === "number" ? err.statusCode : null;
    const type = typeof err.type === "string" ? err.type : null;
    if (status !== null && type !== null) {
      res.status(status).json({ error: err.message, type });
      return;
    }
    next(err);
  },
);

// HEL-183 / Codex P1 on #927: final JSON 500 fallback for any error that
// reaches the end of the chain WITHOUT typed `statusCode + type` fields.
// Without this, an unhandled `Error("something")` from an asyncHandler-
// wrapped route would fall through to Express's default error handler,
// which returns an HTML response — a behavior regression vs the prior
// `handleError(res, error)` pattern that always emitted JSON.
//
// Production-leak guard: only the error class name is exposed in the
// response. The full message goes to Sentry (captured earlier in the
// chain via setupExpressErrorHandler) and to stderr.
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    console.error(
      "[app] Unhandled async error reached final middleware:",
      err instanceof Error ? err.stack ?? err.message : err,
    );
    const safeMessage =
      process.env.NODE_ENV === "production"
        ? "Internal server error"
        : err instanceof Error
          ? err.message
          : String(err);
    res.status(500).json({ error: safeMessage, type: "internal" });
  },
);

export default app;
