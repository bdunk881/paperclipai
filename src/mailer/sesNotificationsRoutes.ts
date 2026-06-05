/**
 * SES notifications webhook (HEL-361): `POST /api/webhooks/ses-notifications`.
 *
 * AWS SNS delivers SES bounce/complaint/delivery events here. We verify the SNS
 * signature, auto-confirm the subscription on topic setup, and on a hard bounce
 * or a complaint add the recipient to the suppression list — workspace-scoped
 * when the original send tagged a `workspace_id`, else global.
 *
 * Mounted BEFORE the global `express.json()` (SNS posts `text/plain`), so this
 * router parses its own body. Deps are injectable for tests.
 */

import express, { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import { suppressionStore } from "./suppressionStore";
import { SuppressionReason } from "./types";
import { SnsMessage, isSnsUrl, verifySnsMessage } from "./snsSignature";

interface SesRecipient {
  emailAddress?: string;
}

interface SesEvent {
  notificationType?: string;
  eventType?: string;
  mail?: { messageId?: string; tags?: Record<string, string[]> };
  bounce?: { bounceType?: string; bouncedRecipients?: SesRecipient[] };
  complaint?: { complainedRecipients?: SesRecipient[] };
}

export type SuppressFn = (input: {
  workspaceId: string | null;
  email: string;
  reason: SuppressionReason;
  source?: string | null;
}) => Promise<unknown>;

export interface SesNotificationsDeps {
  /** Override SNS signature verification (test injection point). */
  verify?: (message: SnsMessage) => Promise<boolean>;
  /** Override fetch for subscription confirmation (test injection point). */
  fetchFn?: typeof fetch;
  /** Override the suppression sink (test injection point). */
  suppress?: SuppressFn;
  /**
   * HEL-613: additive sink for the parsed SES event. Wired in app.ts to the
   * comms wake-event ingest so a bounce/complaint also wakes the owning agent.
   * Best-effort — a failure here never affects suppression or the SNS ack. This
   * route still owns suppression (HEL-361); the ingest only publishes a wake.
   */
  onInboundEvent?: (event: SesEvent) => Promise<void>;
}

function workspaceIdFromEvent(event: SesEvent): string | null {
  const tag = event.mail?.tags?.workspace_id;
  return Array.isArray(tag) && tag.length > 0 ? tag[0] : null;
}

function parseSesEvent(raw: unknown): SesEvent | null {
  if (typeof raw !== "string") {
    return null;
  }
  try {
    return JSON.parse(raw) as SesEvent;
  } catch {
    return null;
  }
}

async function handleSesEvent(event: SesEvent, suppress: SuppressFn): Promise<void> {
  const type = event.notificationType ?? event.eventType;
  const workspaceId = workspaceIdFromEvent(event);
  const source = event.mail?.messageId ?? null;

  // Only PERMANENT (hard) bounces are suppressed — transient bounces may recover.
  if (type === "Bounce" && event.bounce?.bounceType === "Permanent") {
    for (const recipient of event.bounce.bouncedRecipients ?? []) {
      if (recipient.emailAddress) {
        await suppress({ workspaceId, email: recipient.emailAddress, reason: "bounce", source });
      }
    }
    return;
  }
  if (type === "Complaint") {
    for (const recipient of event.complaint?.complainedRecipients ?? []) {
      if (recipient.emailAddress) {
        await suppress({ workspaceId, email: recipient.emailAddress, reason: "complaint", source });
      }
    }
  }
  // Delivery / transient bounce → no suppression.
}

export function createSesNotificationsRoutes(deps: SesNotificationsDeps = {}): Router {
  const verify = deps.verify ?? verifySnsMessage;
  const fetchFn = deps.fetchFn ?? fetch;
  const suppress = deps.suppress ?? ((input) => suppressionStore.suppress(input));
  const onInboundEvent = deps.onInboundEvent;

  const router = Router();
  router.post(
    "/",
    express.json({ type: () => true, limit: "1mb" }),
    asyncHandler(async (req, res) => {
      const message = req.body as SnsMessage;
      if (!message || typeof message !== "object" || typeof message.Type !== "string") {
        res.status(400).json({ error: "invalid SNS message" });
        return;
      }

      const verified = await verify(message);
      if (!verified) {
        res.status(403).json({ error: "invalid SNS signature" });
        return;
      }

      if (message.Type === "SubscriptionConfirmation") {
        // Confirm by visiting the SubscribeURL — but only if it's a real SNS URL.
        if (typeof message.SubscribeURL === "string" && isSnsUrl(message.SubscribeURL)) {
          try {
            await fetchFn(message.SubscribeURL);
          } catch {
            // Best-effort; SNS retries confirmation on failure.
          }
        }
        res.json({ confirmed: true });
        return;
      }

      if (message.Type === "Notification") {
        const event = parseSesEvent(message.Message);
        if (event) {
          await handleSesEvent(event, suppress);
          // HEL-613: forward the same event to the comms wake-event ingest
          // (additive; suppression above is unaffected). Best-effort.
          if (onInboundEvent) {
            await onInboundEvent(event).catch(() => {
              /* wake publish is best-effort; never breaks the SNS ack */
            });
          }
        }
        res.json({ ok: true });
        return;
      }

      res.json({ ok: true });
    }),
  );

  return router;
}
