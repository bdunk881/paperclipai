/**
 * Managed Telnyx SMS transport for the comms gateway (HEL-614).
 *
 * Telnyx is AutoFlow's cost-efficient managed SMS provider (~5× cheaper than
 * Twilio — see the comms-stack strategy). This is the *managed* path: it sends
 * from AutoFlow's own Telnyx account via env credentials, for `kind:'customer'`
 * / `kind:'system'` SMS that the gateway owns. Per-workspace **BYOC**
 * Twilio/Telnyx stays in the notification system (`src/notifications/delivery.ts`)
 * and is unaffected.
 *
 * No SDK dependency — raw `fetch`, mirroring the SendGrid/Twilio senders.
 * Failures throw {@link TransportError} so the durable worker (HEL-612) can
 * classify retryable (5xx / network) vs permanent (4xx / config).
 */

import { CommsTransport, TransportError, TransportMessage, TransportResult } from "../types";

function normalizeEnv(name: string): string | undefined {
  const raw = process.env[name];
  if (typeof raw !== "string") {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * True when the managed Telnyx transport has enough configuration to send:
 * `TELNYX_API_KEY` plus a sender (`TELNYX_SMS_FROM` or
 * `TELNYX_MESSAGING_PROFILE_ID`).
 */
export function isTelnyxConfigured(): boolean {
  return Boolean(
    normalizeEnv("TELNYX_API_KEY") &&
      (normalizeEnv("TELNYX_SMS_FROM") || normalizeEnv("TELNYX_MESSAGING_PROFILE_ID")),
  );
}

interface TelnyxMessageResponse {
  data?: { id?: string };
}

export class TelnyxSmsTransport implements CommsTransport {
  readonly id = "telnyx";
  readonly channel = "sms" as const;

  async send(message: TransportMessage): Promise<TransportResult> {
    const apiKey = normalizeEnv("TELNYX_API_KEY");
    const from = normalizeEnv("TELNYX_SMS_FROM");
    const messagingProfileId = normalizeEnv("TELNYX_MESSAGING_PROFILE_ID");
    const baseUrl = normalizeEnv("TELNYX_API_BASE_URL") ?? "https://api.telnyx.com";

    // Config errors are permanent — retrying won't fix a missing key.
    if (!apiKey) {
      throw new TransportError("TELNYX_API_KEY is not configured", { retryable: false });
    }
    if (!from && !messagingProfileId) {
      throw new TransportError(
        "TELNYX_SMS_FROM or TELNYX_MESSAGING_PROFILE_ID must be configured",
        { retryable: false },
      );
    }
    const text = message.text ?? "";
    if (!text.trim()) {
      throw new TransportError("Telnyx SMS requires non-empty text", { retryable: false });
    }

    const payload: Record<string, unknown> = { to: message.to, text };
    if (from) {
      payload.from = from;
    }
    if (messagingProfileId) {
      payload.messaging_profile_id = messagingProfileId;
    }

    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/v2/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      // status drives retry classification (5xx retryable, 4xx not).
      throw new TransportError(
        `Telnyx SMS send failed (${response.status}): ${body.slice(0, 300)}`,
        { status: response.status },
      );
    }

    const json = (await response.json().catch(() => ({}))) as TelnyxMessageResponse;
    return { providerMessageId: json.data?.id };
  }
}
