/**
 * Ask-an-Agent webhook routes (HEL infra PR #2).
 *
 * Mounted at /api/admin-console/agent-webhooks.
 *   GET  /                         list webhooks (no secrets in response)
 *   POST /                         create webhook (validates URL + DNS)
 *   PATCH /:id                     update name / url / secret / headers / disabled state
 *   DELETE /:id                    hard-delete (rejects if asks exist via FK)
 *   POST /:id/test                 fire a synthetic ask to verify the receiver
 *   GET  /:id/recent-asks          last 25 ask rows for this webhook
 *   POST /asks                     fire a real ask (called by AskAgentButton)
 *
 * Create / update / disable / delete / test all compose requireAAL2 via
 * the parent router (createAgentWebhookRoutes mounts requireAAL2 on every
 * mutation route). Ask itself does NOT require AAL2 — it's send-only,
 * read-equivalent in terms of local state.
 */

import { Router } from "express";
import type { Pool } from "pg";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAAL2 } from "../../middleware/requireAAL2";
import { recordAdminAction } from "../auditLog";
import { consumeRateLimit } from "../rateLimit";
import { extractAuditContext, type PlatformAdminRequest } from "../types";
import {
  assertSafeWebhookUrl,
  deliver,
  WebhookPrivateHostError,
  WebhookSchemeError,
} from "./deliverer";
import {
  completeAsk,
  createAgentWebhook,
  deleteAgentWebhook,
  getAgentWebhook,
  insertAsk,
  listAgentWebhooks,
  listRecentAsksForWebhook,
  loadDeliveryMaterial,
  markWebhookUsed,
  updateAgentWebhook,
} from "./store";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function callbackUrlFor(askId: string): string {
  const base = (process.env.API_PUBLIC_URL ?? "").replace(/\/$/, "");
  if (!base) return "";
  return `${base}/api/admin-console/infra/agent-asks/${askId}/reply`;
}

function buildPayload(args: {
  askId: string;
  adminUserId: string;
  adminEmail: string | null;
  kind: string;
  source: string;
  subjectRef: Record<string, unknown>;
  payload: Record<string, unknown>;
  adminQuestion: string;
}): Record<string, unknown> {
  return {
    id: args.askId,
    kind: args.kind,
    source: args.source,
    subject_ref: args.subjectRef,
    payload: args.payload,
    admin_question: args.adminQuestion,
    admin: { id: args.adminUserId, email: args.adminEmail },
    occurred_at: new Date().toISOString(),
    callback_url: callbackUrlFor(args.askId),
  };
}

interface ValidatedCreateBody {
  name: string;
  url: string;
  hmacSecret?: string | null;
  customHeaders?: Record<string, string> | null;
}

function validateCreateBody(body: unknown): ValidatedCreateBody | { error: string } {
  if (!body || typeof body !== "object") return { error: "invalid_body" };
  const b = body as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  const url = typeof b.url === "string" ? b.url.trim() : "";
  if (!name) return { error: "name_required" };
  if (!url) return { error: "url_required" };
  const hmacSecret =
    typeof b.hmacSecret === "string" && b.hmacSecret.length > 0 ? b.hmacSecret : null;
  let customHeaders: Record<string, string> | null = null;
  if (b.customHeaders && typeof b.customHeaders === "object") {
    customHeaders = {};
    for (const [k, v] of Object.entries(b.customHeaders as Record<string, unknown>)) {
      if (typeof k !== "string" || typeof v !== "string") {
        return { error: "custom_headers_must_be_string_map" };
      }
      customHeaders[k] = v;
    }
    if (Object.keys(customHeaders).length === 0) customHeaders = null;
  }
  return { name, url, hmacSecret, customHeaders };
}

export function createAgentWebhookRoutes(pool: Pool): Router {
  const router = Router();

  // List
  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const r = req as PlatformAdminRequest;
      const client = r.platformAdminDb!;
      const webhooks = await listAgentWebhooks(client);
      res.json({ webhooks });
    }),
  );

  // Create — requires AAL2
  router.post(
    "/",
    requireAAL2,
    asyncHandler(async (req, res) => {
      const validated = validateCreateBody(req.body);
      if ("error" in validated) return res.status(400).json({ error: validated.error });
      try {
        await assertSafeWebhookUrl(validated.url);
      } catch (err) {
        if (err instanceof WebhookSchemeError)
          return res.status(400).json({ error: "url_must_be_https" });
        if (err instanceof WebhookPrivateHostError)
          return res.status(400).json({ error: "url_resolves_to_private_host" });
        throw err;
      }

      const r = req as PlatformAdminRequest;
      const client = r.platformAdminDb!;
      const adminId = r.platformAdmin.userId;

      await recordAdminAction(client, {
        adminUserId: adminId,
        action: "create_agent_webhook",
        reason: typeof req.body?.reason === "string" ? req.body.reason : "",
        payload: { name: validated.name, url: validated.url },
        context: extractAuditContext(req),
      });

      const webhook = await createAgentWebhook(client, {
        name: validated.name,
        url: validated.url,
        hmacSecret: validated.hmacSecret,
        customHeaders: validated.customHeaders,
        createdBy: adminId,
      });
      res.status(201).json({ webhook });
    }),
  );

  // Update
  router.patch(
    "/:id",
    requireAAL2,
    asyncHandler(async (req, res) => {
      const id = req.params.id;
      if (!UUID_RE.test(id)) return res.status(400).json({ error: "invalid_id" });
      const body = (req.body ?? {}) as Record<string, unknown>;

      // Validate URL change if requested
      if (typeof body.url === "string") {
        try {
          await assertSafeWebhookUrl(body.url);
        } catch (err) {
          if (err instanceof WebhookSchemeError)
            return res.status(400).json({ error: "url_must_be_https" });
          if (err instanceof WebhookPrivateHostError)
            return res.status(400).json({ error: "url_resolves_to_private_host" });
          throw err;
        }
      }

      const r = req as PlatformAdminRequest;
      const client = r.platformAdminDb!;
      const adminId = r.platformAdmin.userId;

      const action =
        body.disabledAt === null
          ? "update_agent_webhook"
          : body.disabledAt !== undefined
            ? "disable_agent_webhook"
            : "update_agent_webhook";

      await recordAdminAction(client, {
        adminUserId: adminId,
        action,
        reason: typeof body.reason === "string" ? body.reason : "",
        payload: { id, fields: Object.keys(body).filter((k) => k !== "reason") },
        context: extractAuditContext(req),
      });

      const updated = await updateAgentWebhook(client, {
        id,
        name: typeof body.name === "string" ? body.name : undefined,
        url: typeof body.url === "string" ? body.url : undefined,
        hmacSecret:
          body.hmacSecret === null
            ? null
            : typeof body.hmacSecret === "string"
              ? body.hmacSecret
              : undefined,
        customHeaders:
          body.customHeaders === null
            ? null
            : body.customHeaders && typeof body.customHeaders === "object"
              ? (body.customHeaders as Record<string, string>)
              : undefined,
        disabledAt:
          body.disabledAt === null
            ? null
            : typeof body.disabledAt === "string"
              ? new Date(body.disabledAt)
              : undefined,
      });
      if (!updated) return res.status(404).json({ error: "not_found" });
      res.json({ webhook: updated });
    }),
  );

  // Delete (hard delete — FK constraint protects when asks exist)
  router.delete(
    "/:id",
    requireAAL2,
    asyncHandler(async (req, res) => {
      const id = req.params.id;
      if (!UUID_RE.test(id)) return res.status(400).json({ error: "invalid_id" });

      const r = req as PlatformAdminRequest;
      const client = r.platformAdminDb!;

      await recordAdminAction(client, {
        adminUserId: r.platformAdmin.userId,
        action: "delete_agent_webhook",
        reason: typeof req.body?.reason === "string" ? req.body.reason : "",
        payload: { id },
        context: extractAuditContext(req),
      });

      try {
        const ok = await deleteAgentWebhook(client, id);
        if (!ok) return res.status(404).json({ error: "not_found" });
        res.status(204).end();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("foreign key")) {
          return res
            .status(409)
            .json({ error: "webhook_has_ask_history", hint: "disable instead of delete" });
        }
        throw err;
      }
    }),
  );

  // Recent asks
  router.get(
    "/:id/recent-asks",
    asyncHandler(async (req, res) => {
      const id = req.params.id;
      if (!UUID_RE.test(id)) return res.status(400).json({ error: "invalid_id" });
      const r = req as PlatformAdminRequest;
      const client = r.platformAdminDb!;
      const asks = await listRecentAsksForWebhook(client, id, 25);
      res.json({ asks });
    }),
  );

  // Test fire (synthetic payload)
  router.post(
    "/:id/test",
    requireAAL2,
    asyncHandler(async (req, res) => {
      const id = req.params.id;
      if (!UUID_RE.test(id)) return res.status(400).json({ error: "invalid_id" });

      const r = req as PlatformAdminRequest;
      const client = r.platformAdminDb!;
      const adminId = r.platformAdmin.userId;

      try {
        consumeRateLimit(adminId, "test_agent_webhook");
      } catch (err) {
        return res.status(429).json({ error: "rate_limited", bucket: "test_agent_webhook" });
      }

      await recordAdminAction(client, {
        adminUserId: adminId,
        action: "test_agent_webhook",
        reason: "test fire from settings",
        payload: { id },
        context: extractAuditContext(req),
      });

      const material = await loadDeliveryMaterial(client, id);
      if (!material) return res.status(404).json({ error: "webhook_not_found_or_disabled" });

      const ask = await insertAsk(client, {
        webhookId: id,
        adminUserId: adminId,
        kind: "test",
        source: "admin.settings.agent-webhooks",
        subjectRef: {},
        payload: { hello: "from autoflow admin" },
        adminQuestion: "This is a test fire from the agent-webhook settings page.",
      });

      const result = await deliver({
        webhookId: id,
        url: material.webhook.url,
        hmacSecret: material.hmacSecret,
        customHeaders: material.customHeaders,
        body: buildPayload({
          askId: ask.id,
          adminUserId: adminId,
          adminEmail: null,
          kind: "test",
          source: "admin.settings.agent-webhooks",
          subjectRef: {},
          payload: { hello: "from autoflow admin" },
          adminQuestion: "This is a test fire from the agent-webhook settings page.",
        }),
      });

      await Promise.all([
        completeAsk(client, {
          id: ask.id,
          status: result.status,
          httpStatus: result.httpStatus,
          responseExcerpt: result.responseExcerpt,
        }),
        markWebhookUsed(client, id),
      ]);

      res.status(result.status === "sent" ? 200 : 502).json({
        status: result.status,
        http_status: result.httpStatus,
        excerpt: result.responseExcerpt,
        error: result.error,
      });
    }),
  );

  // POST /asks — real ask from anywhere in the Infra UI
  router.post(
    "/asks",
    asyncHandler(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const webhookId = typeof body.webhookId === "string" ? body.webhookId : "";
      const kind = typeof body.kind === "string" ? body.kind : "";
      const source = typeof body.source === "string" ? body.source : "";
      const adminQuestion = typeof body.adminQuestion === "string" ? body.adminQuestion : "";
      if (!UUID_RE.test(webhookId)) return res.status(400).json({ error: "invalid_webhook_id" });
      if (!kind || !source) return res.status(400).json({ error: "kind_and_source_required" });
      if (!adminQuestion.trim()) return res.status(400).json({ error: "admin_question_required" });

      const subjectRef =
        body.subjectRef && typeof body.subjectRef === "object"
          ? (body.subjectRef as Record<string, unknown>)
          : {};
      const payload =
        body.payload && typeof body.payload === "object"
          ? (body.payload as Record<string, unknown>)
          : {};

      const r = req as PlatformAdminRequest;
      const client = r.platformAdminDb!;
      const adminId = r.platformAdmin.userId;

      try {
        consumeRateLimit(adminId, "ask_agent");
      } catch (err) {
        return res.status(429).json({ error: "rate_limited", bucket: "ask_agent" });
      }

      await recordAdminAction(client, {
        adminUserId: adminId,
        action: "ask_agent",
        reason: adminQuestion.slice(0, 200),
        payload: { webhookId, kind, source, subject_ref: subjectRef },
        context: extractAuditContext(req),
      });

      const material = await loadDeliveryMaterial(client, webhookId);
      if (!material) return res.status(404).json({ error: "webhook_not_found_or_disabled" });

      const ask = await insertAsk(client, {
        webhookId,
        adminUserId: adminId,
        kind,
        source,
        subjectRef,
        payload,
        adminQuestion,
      });

      const result = await deliver({
        webhookId,
        url: material.webhook.url,
        hmacSecret: material.hmacSecret,
        customHeaders: material.customHeaders,
        body: buildPayload({
          askId: ask.id,
          adminUserId: adminId,
          adminEmail: null,
          kind,
          source,
          subjectRef,
          payload,
          adminQuestion,
        }),
      });

      await Promise.all([
        completeAsk(client, {
          id: ask.id,
          status: result.status,
          httpStatus: result.httpStatus,
          responseExcerpt: result.responseExcerpt,
        }),
        markWebhookUsed(client, webhookId),
      ]);

      res.status(result.status === "sent" ? 200 : 502).json({
        ask_id: ask.id,
        status: result.status,
        http_status: result.httpStatus,
        excerpt: result.responseExcerpt,
        error: result.error,
      });
    }),
  );

  // Silence the unused-pool warning; we accept Pool for parity with other
  // createXxxRoutes signatures even though this module uses
  // r.platformAdminDb (a PoolClient inside the requirePlatformAdmin txn).
  void pool;
  return router;
}
