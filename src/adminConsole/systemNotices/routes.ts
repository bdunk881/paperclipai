/**
 * System status notice routes (HEL-366).
 *
 *   POST /api/admin-console/system-notices         — platform-admin blast
 *   GET|POST /api/system-notices/unsubscribe       — public token-gated opt-out
 *
 * The admin route is gated by the admin-console stack (requirePlatformAdmin +
 * requireAAL2), rate-limited (`system_notice_send`), and requires an explicit
 * confirm to prevent an accidental mass send. The unsubscribe route is mounted
 * OUTSIDE the admin gate (recipients have no AutoFlow session) and is protected
 * by an HMAC token over the email.
 */

import { Router, type Request } from "express";
import type { Pool } from "pg";
import { asyncHandler } from "../../middleware/asyncHandler";
import { buildSystemMailer } from "../../mailer/sesMailer";
import { recordAdminAction } from "../auditLog";
import { consumeRateLimit } from "../rateLimit";
import { extractAuditContext, type PlatformAdminRequest } from "../types";
import { systemNoticeOptOutStore } from "./optOutStore";
import {
  buildUnsubscribeUrl,
  coerceNoticeKind,
  resolveOwnerRecipients,
  sendSystemNotice,
  verifyUnsubscribeToken,
  type SystemNoticeContent,
} from "./systemNotices";

function pickString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function requestBaseUrl(req: Request): string | null {
  const override = pickString(process.env.SYSTEM_NOTICE_BASE_URL);
  if (override) return override;
  const host = req.get("host");
  return host ? `${req.protocol}://${host}` : null;
}

/** Platform-admin blast — mounted under /api/admin-console/system-notices. */
export function createSystemNoticesRoutes(_pool: Pool): Router {
  const router = Router();

  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const r = req as PlatformAdminRequest;
      const client = r.platformAdminDb!;
      const adminId = r.platformAdmin.userId;
      const body = (req.body ?? {}) as Record<string, unknown>;

      const title = pickString(body.title);
      const message = pickString(body.message);
      const confirm = pickString(body.confirm);
      if (!title) return res.status(400).json({ error: "title_required" });
      if (!message) return res.status(400).json({ error: "message_required" });
      if (confirm !== "SEND") {
        return res.status(400).json({
          error: "confirm_required",
          hint: "Type SEND into the confirm field to send to all targeted owners.",
        });
      }

      const workspaceIds = Array.isArray(body.workspaceIds)
        ? body.workspaceIds.filter(
            (x): x is string => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x),
          )
        : undefined;

      try {
        consumeRateLimit(adminId, "system_notice_send");
      } catch {
        return res.status(429).json({ error: "rate_limited", bucket: "system_notice_send" });
      }

      const notice: SystemNoticeContent = {
        kind: coerceNoticeKind(body.kind),
        title,
        message,
        windowStart: pickString(body.windowStart),
        windowEnd: pickString(body.windowEnd),
        impact: pickString(body.impact),
        statusPageUrl: pickString(body.statusPageUrl),
      };

      const recipients = await resolveOwnerRecipients(client, { workspaceIds });
      const base = requestBaseUrl(req);
      const result = await sendSystemNotice(notice, recipients, {
        mailer: buildSystemMailer(),
        isOptedOut: (email) => systemNoticeOptOutStore.isOptedOut(email),
        buildUnsubscribeUrl: (email) => buildUnsubscribeUrl(base, email),
      });

      await recordAdminAction(client, {
        adminUserId: adminId,
        action: "send_system_notice",
        reason: `${notice.kind}: ${title}`,
        payload: { kind: notice.kind, filtered: Boolean(workspaceIds), ...result },
        context: extractAuditContext(req),
      });

      res.json(result);
    }),
  );

  return router;
}

/**
 * Public one-click unsubscribe — mounted OUTSIDE the admin gate at
 * /api/system-notices. Token-gated (HMAC over the email). GET supports the
 * clickable email link; POST supports RFC 8058 List-Unsubscribe-Post. Both read
 * the email + token from the query string so body-parser mount order is
 * irrelevant.
 */
export function createSystemNoticeUnsubscribeRoute(): Router {
  const router = Router();
  const handler = asyncHandler(async (req: Request, res) => {
    const email = pickString(req.query.email);
    const token = pickString(req.query.token);
    if (!email || !token || !verifyUnsubscribeToken(email, token)) {
      return res
        .status(400)
        .type("html")
        .send("<p>Invalid or expired unsubscribe link.</p>");
    }
    await systemNoticeOptOutStore.optOut(email, "unsubscribe-link");
    return res
      .status(200)
      .type("html")
      .send(
        "<p>You've been unsubscribed from AutoFlow maintenance &amp; incident notices. " +
          "You'll still receive billing and security email.</p>",
      );
  });
  router.get("/unsubscribe", handler);
  router.post("/unsubscribe", handler);
  return router;
}
