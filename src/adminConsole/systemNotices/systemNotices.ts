/**
 * System status notices (HEL-366) — admin-triggered maintenance / incident
 * email blast to workspace owners.
 *
 * Pieces (kept together so the mailer-line tickets don't serialize on
 * systemTemplates.ts; the mailer registry supports distributed registration):
 *   - `system-status-notice` template (self-registers on import).
 *   - HMAC unsubscribe token + URL builder for the one-click unsubscribe link.
 *   - `resolveOwnerRecipients` — workspace owners (Postgres) → emails (Supabase
 *     admin), deduped by email.
 *   - `sendSystemNotice` — per-recipient delivery (each its own send, so
 *     recipients aren't visible to each other), skipping category opt-outs;
 *     hard bounce/complaint suppression is enforced by the mailer itself.
 */

import { createHmac, timingSafeEqual } from "crypto";
import type { PoolClient } from "pg";
import { registerTemplate, RenderedEmail } from "../../mailer/templates";
import { Mailer } from "../../mailer/types";
import {
  getSupabaseAdminClient,
  isSupabaseAdminConfigured,
} from "../supabaseAdminClient";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

export type SystemNoticeKind = "maintenance" | "incident" | "resolution";

const KIND_LABELS: Record<SystemNoticeKind, string> = {
  maintenance: "Scheduled maintenance",
  incident: "Service incident",
  resolution: "Resolved",
};

export function coerceNoticeKind(value: unknown): SystemNoticeKind {
  const k = str(value);
  return k === "incident" || k === "resolution" ? k : "maintenance";
}

/** system-status-notice (HEL-366). Plain semantic HTML for cross-client rendering. */
export function renderSystemStatusNotice(data: Record<string, unknown>): RenderedEmail {
  const kind = coerceNoticeKind(data.kind);
  const header = KIND_LABELS[kind];
  const title = str(data.title) ?? header;
  const message = str(data.message) ?? "";
  const windowStart = str(data.windowStart);
  const windowEnd = str(data.windowEnd);
  const impact = str(data.impact);
  const statusPageUrl = str(data.statusPageUrl);
  const unsubscribeUrl = str(data.unsubscribeUrl);

  const window =
    windowStart && windowEnd ? `${windowStart} – ${windowEnd}` : windowStart || windowEnd || null;
  const subject = `[AutoFlow · ${header}] ${title}`;

  const textLines = [`${header}: ${title}`, "", message, ""];
  if (window) textLines.push(`When: ${window}`);
  if (impact) textLines.push(`Expected impact: ${impact}`);
  if (window || impact) textLines.push("");
  if (statusPageUrl) textLines.push(`Status page: ${statusPageUrl}`);
  if (unsubscribeUrl) {
    textLines.push("");
    textLines.push(
      `Unsubscribe from maintenance notices (you'll still get billing & security email): ${unsubscribeUrl}`,
    );
  }

  const htmlParts = [
    `<p><strong>${escapeHtml(header)}</strong></p>`,
    `<h2>${escapeHtml(title)}</h2>`,
    `<p>${escapeHtml(message)}</p>`,
  ];
  if (window) htmlParts.push(`<p><strong>When:</strong> ${escapeHtml(window)}</p>`);
  if (impact) htmlParts.push(`<p><strong>Expected impact:</strong> ${escapeHtml(impact)}</p>`);
  if (statusPageUrl) {
    htmlParts.push(`<p><a href="${escapeHtml(statusPageUrl)}">View status page</a></p>`);
  }
  if (unsubscribeUrl) {
    htmlParts.push(
      `<p style="font-size:12px;color:#888888;">You're receiving this AutoFlow system notice as a workspace owner. ` +
        `<a href="${escapeHtml(unsubscribeUrl)}">Unsubscribe from maintenance notices</a> — you'll still get billing & security email.</p>`,
    );
  }

  return { subject, html: htmlParts.join(""), text: textLines.join("\n") };
}

registerTemplate("system-status-notice", renderSystemStatusNotice);

// ---------------------------------------------------------------------------
// Unsubscribe token (HMAC) + URL
// ---------------------------------------------------------------------------

function unsubscribeSecret(): string {
  return (
    process.env.SYSTEM_NOTICE_SECRET ||
    process.env.APP_JWT_SECRET ||
    "dev-system-notice-secret"
  ).trim();
}

export function unsubscribeToken(email: string): string {
  return createHmac("sha256", unsubscribeSecret())
    .update(email.trim().toLowerCase())
    .digest("hex");
}

export function verifyUnsubscribeToken(email: string, token: string): boolean {
  const expected = unsubscribeToken(email);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(String(token ?? ""), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Public one-click unsubscribe URL on the API, or null when no base is known. */
export function buildUnsubscribeUrl(baseUrl: string | null | undefined, email: string): string | null {
  const base = (baseUrl ?? "").trim().replace(/\/$/, "");
  if (!base) return null;
  const q = new URLSearchParams({ email, token: unsubscribeToken(email) });
  return `${base}/api/system-notices/unsubscribe?${q.toString()}`;
}

// ---------------------------------------------------------------------------
// Recipient resolution — workspace owners → emails
// ---------------------------------------------------------------------------

export interface SystemNoticeRecipient {
  email: string;
  workspaceId: string | null;
  userId: string;
}

/**
 * All workspace owners (or a filtered subset by workspace id), deduped by email.
 * Owner ids come from Postgres; emails from Supabase admin. Returns [] when the
 * Supabase admin client isn't configured (no email source).
 */
export async function resolveOwnerRecipients(
  client: PoolClient,
  opts: { workspaceIds?: string[] } = {},
): Promise<SystemNoticeRecipient[]> {
  const ids = opts.workspaceIds && opts.workspaceIds.length > 0 ? opts.workspaceIds : null;
  const res = await client.query<{ owner_user_id: string; workspace_id: string }>(
    `SELECT DISTINCT owner_user_id, id AS workspace_id
       FROM workspaces
      WHERE owner_user_id IS NOT NULL
        AND ($1::uuid[] IS NULL OR id = ANY($1))`,
    [ids],
  );

  if (!isSupabaseAdminConfigured()) return [];
  const supa = getSupabaseAdminClient();

  const byEmail = new Map<string, SystemNoticeRecipient>();
  for (const row of res.rows) {
    const userId = String(row.owner_user_id);
    const workspaceId = row.workspace_id ? String(row.workspace_id) : null;
    let email: string | null = null;
    try {
      const got = await supa.auth.admin.getUserById(userId);
      email = got.data.user?.email ?? null;
    } catch {
      // Best-effort — skip owners we can't resolve an email for.
    }
    if (!email) continue;
    const key = email.toLowerCase();
    if (!byEmail.has(key)) byEmail.set(key, { email, workspaceId, userId });
  }
  return Array.from(byEmail.values());
}

// ---------------------------------------------------------------------------
// Blast
// ---------------------------------------------------------------------------

export interface SystemNoticeContent {
  kind: SystemNoticeKind;
  title: string;
  message: string;
  windowStart?: string | null;
  windowEnd?: string | null;
  impact?: string | null;
  statusPageUrl?: string | null;
}

export interface SystemNoticeSendResult {
  targeted: number;
  sent: number;
  suppressed: number;
  optedOut: number;
  failed: number;
}

export interface SystemNoticeSendDeps {
  mailer: Mailer;
  /** Category opt-out check (the status-notice opt-out list). */
  isOptedOut: (email: string) => Promise<boolean>;
  /** Build the per-recipient unsubscribe URL (null → omit the link). */
  buildUnsubscribeUrl?: (email: string) => string | null;
}

/**
 * Per-recipient delivery (each its own send, so recipients aren't visible to one
 * another). Skips category opt-outs before sending; hard bounce/complaint
 * suppression is enforced inside the mailer (counted as `suppressed`). Never
 * throws — a single bad recipient is counted as `failed` and the blast continues.
 */
export async function sendSystemNotice(
  notice: SystemNoticeContent,
  recipients: SystemNoticeRecipient[],
  deps: SystemNoticeSendDeps,
): Promise<SystemNoticeSendResult> {
  let sent = 0;
  let suppressed = 0;
  let optedOut = 0;
  let failed = 0;

  for (const recipient of recipients) {
    if (await deps.isOptedOut(recipient.email)) {
      optedOut += 1;
      continue;
    }
    const unsubscribeUrl = deps.buildUnsubscribeUrl
      ? deps.buildUnsubscribeUrl(recipient.email)
      : null;
    try {
      const result = await deps.mailer.sendTemplate({
        template: "system-status-notice",
        to: recipient.email,
        workspaceId: recipient.workspaceId,
        data: {
          kind: notice.kind,
          title: notice.title,
          message: notice.message,
          windowStart: notice.windowStart ?? undefined,
          windowEnd: notice.windowEnd ?? undefined,
          impact: notice.impact ?? undefined,
          statusPageUrl: notice.statusPageUrl ?? undefined,
          unsubscribeUrl: unsubscribeUrl ?? undefined,
        },
      });
      if (result.suppressed) suppressed += 1;
      else sent += 1;
    } catch (err) {
      console.error(`[system-notice] send failed for ${recipient.email}: ${(err as Error).message}`);
      failed += 1;
    }
  }

  return { targeted: recipients.length, sent, suppressed, optedOut, failed };
}
