/**
 * Public-facing async reply receiver for Ask-an-Agent (HEL infra PR #8).
 *
 * Mounted OUTSIDE requireAuth / requirePlatformAdmin — the receiver
 * is an external service (Slack workflow, n8n flow, custom agent) that
 * doesn't have an AutoFlow session. Auth is replaced by HMAC signature
 * verification against the *original* webhook's stored secret.
 *
 *   POST /api/admin-console/infra/agent-asks/:askId/reply
 *
 * Body shape (the receiver controls this, but we recommend):
 *   { "body": "the agent's reply text", "metadata": { ... } }
 *
 * Required headers (re-using the outbound signing convention):
 *   X-AutoFlow-Timestamp: <unix-seconds>
 *   X-AutoFlow-Signature: sha256=<hex>
 *
 * Where the signature covers `${timestamp}.${rawBody}` and was generated
 * with the SAME secret AutoFlow used when it POSTed the ask to the
 * webhook. If the webhook was configured without a secret, the reply
 * endpoint refuses inbound replies for it (no secret → no way to
 * verify, no rows inserted).
 */

import { Router, raw, type Request } from "express";
import type { Pool } from "pg";
import { asyncHandler } from "../../middleware/asyncHandler";
import {
  getAskById,
  insertReply,
  loadDeliveryMaterial,
  type ReplyRow,
} from "./store";
import { verifySignature } from "./signer";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 64 * 1024;

interface ReplyResponseShape {
  ok: true;
  id: string;
  received_at: string;
}

interface ReplyErrorShape {
  ok: false;
  error: string;
}

function jsonError(
  res: import("express").Response,
  status: number,
  error: string,
): import("express").Response<ReplyErrorShape> {
  return res.status(status).json({ ok: false, error });
}

export function createAgentReplyRoute(pool: Pool): Router {
  const router = Router();

  // Use raw body parser so HMAC verification sees the EXACT bytes the
  // sender signed. Express's default JSON parser would re-serialize after
  // parsing and the recomputed signature would never match.
  router.post(
    "/agent-asks/:askId/reply",
    raw({ type: "application/json", limit: MAX_BODY_BYTES }),
    asyncHandler(async (req: Request, res) => {
      const askId = String(req.params.askId ?? "").trim();
      if (!UUID_RE.test(askId)) return jsonError(res, 400, "invalid_ask_id");

      const rawBuf = (req.body as Buffer | undefined) ?? Buffer.alloc(0);
      if (!Buffer.isBuffer(rawBuf) || rawBuf.length === 0) {
        return jsonError(res, 400, "empty_body");
      }
      const rawBody = rawBuf.toString("utf8");

      const ask = await getAskById(pool, askId);
      if (!ask) return jsonError(res, 404, "ask_not_found");

      const material = await loadDeliveryMaterial(pool, ask.agent_webhook_id);
      if (!material) return jsonError(res, 404, "webhook_disabled_or_deleted");

      if (!material.hmacSecret) {
        // No secret = no way to authenticate the reply. Refuse rather than
        // accept an unauthenticated POST that could spoof any user's view.
        return jsonError(res, 401, "reply_requires_hmac_secret_on_webhook");
      }

      const timestamp = req.header("X-AutoFlow-Timestamp") ?? undefined;
      const signature = req.header("X-AutoFlow-Signature") ?? undefined;
      const verify = verifySignature({
        secret: material.hmacSecret,
        rawBody,
        timestamp,
        signature,
      });
      if (!verify.ok) {
        return jsonError(res, 401, `signature_${verify.reason}`);
      }

      let parsed: { body?: unknown; metadata?: unknown };
      try {
        parsed = JSON.parse(rawBody) as { body?: unknown; metadata?: unknown };
      } catch {
        return jsonError(res, 400, "invalid_json");
      }

      const body =
        typeof parsed.body === "string" && parsed.body.trim().length > 0
          ? parsed.body
          : null;
      if (!body) return jsonError(res, 400, "body_field_required");

      const metadata =
        parsed.metadata && typeof parsed.metadata === "object"
          ? (parsed.metadata as Record<string, unknown>)
          : {};

      const row: ReplyRow = await insertReply(pool, {
        askId,
        body,
        metadata,
      });

      const response: ReplyResponseShape = {
        ok: true,
        id: row.id,
        received_at: row.received_at,
      };
      return res.status(201).json(response);
    }),
  );

  return router;
}
