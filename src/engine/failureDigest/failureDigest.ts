/**
 * Workflow failure digest (HEL-365).
 *
 * A daily background job emails each workspace's owner a digest of the workflow
 * runs that failed in the period (name, error, when, run link). Workspaces with
 * zero failures are never emailed (the query only returns workspaces that have
 * failures). A workspace can opt out via a notification_preferences row
 * (channel='email', kind='workflow_failures', enabled=false).
 *
 * The cycle (`runFailureDigestCycle`) takes injected deps so it is unit-testable
 * without a DB / Supabase / live mailer; `startWorkflowFailureDigestJob` wires
 * the real implementations (mirrors creditExpirationJob).
 */

import type { Pool } from "pg";
import {
  getPostgresPool,
  inMemoryAllowed,
  isPostgresPersistenceEnabled,
} from "../../db/postgres";
import { Mailer } from "../../mailer/types";
import { buildSystemMailer } from "../../mailer/sesMailer";
import { registerTemplate, RenderedEmail } from "../../mailer/templates";
import {
  getSupabaseAdminClient,
  isSupabaseAdminConfigured,
} from "../../adminConsole/supabaseAdminClient";
import { safeLogJobRun } from "../../adminConsole/infra/jobHistoryStore";

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PERIOD_MS = 24 * 60 * 60 * 1000;

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

export interface FailedRun {
  runId: string;
  workflowName: string;
  error: string | null;
  failedAt: string | null;
  url?: string | null;
}

/** workflow-failure-digest (HEL-365). Plain semantic HTML for cross-client rendering. */
export function renderWorkflowFailureDigest(data: Record<string, unknown>): RenderedEmail {
  const failures = Array.isArray(data.failures) ? (data.failures as FailedRun[]) : [];
  const count = failures.length;
  const periodLabel = str(data.periodLabel) ?? "the last 24 hours";

  const noun = count === 1 ? "workflow run" : "workflow runs";
  const subject = `${count} failed ${noun} in your AutoFlow workspace`;

  const textLines = [
    `${count} ${noun} failed in your AutoFlow workspace in ${periodLabel}.`,
    "",
  ];
  for (const f of failures) {
    const name = str(f.workflowName) ?? "Workflow";
    textLines.push(`• ${name}`);
    if (str(f.error)) textLines.push(`  Error: ${str(f.error)}`);
    if (str(f.failedAt)) textLines.push(`  Failed at: ${str(f.failedAt)}`);
    if (str(f.url)) textLines.push(`  ${str(f.url)}`);
    textLines.push("");
  }
  textLines.push("You're receiving this because you own this workspace.");

  const items = failures.map((f) => {
    const name = escapeHtml(str(f.workflowName) ?? "Workflow");
    const parts = [`<strong>${name}</strong>`];
    if (str(f.error)) parts.push(`<br/><span>${escapeHtml(str(f.error) as string)}</span>`);
    if (str(f.failedAt)) parts.push(`<br/><span>Failed at: ${escapeHtml(str(f.failedAt) as string)}</span>`);
    if (str(f.url)) parts.push(`<br/><a href="${escapeHtml(str(f.url) as string)}">View run</a>`);
    return `<li style="margin-bottom:12px;">${parts.join("")}</li>`;
  });
  const html =
    `<p>${count} ${noun} failed in your AutoFlow workspace in ${escapeHtml(periodLabel)}.</p>` +
    `<ul>${items.join("")}</ul>` +
    `<p style="font-size:12px;color:#888888;">You're receiving this because you own this workspace.</p>`;

  return { subject, html, text: textLines.join("\n") };
}

registerTemplate("workflow-failure-digest", renderWorkflowFailureDigest);

// ---------------------------------------------------------------------------
// Cycle (pure — injected deps)
// ---------------------------------------------------------------------------

export interface FailureDigestDeps {
  /** Failed runs in the period, grouped by workspace (only workspaces WITH failures). */
  fetchFailuresByWorkspace: (sinceIso: string) => Promise<Map<string, FailedRun[]>>;
  /** The digest recipient for a workspace (owner email), or null if unknown. */
  resolveRecipientEmail: (workspaceId: string) => Promise<string | null>;
  /** True when the workspace opted out of the failure digest. */
  isOptedOut: (workspaceId: string) => Promise<boolean>;
  mailer: Mailer;
  /** Build a run-detail URL (null → omit the link). */
  buildRunUrl?: (runId: string) => string | null;
  periodMs?: number;
  periodLabel?: string;
}

export interface FailureDigestResult {
  workspacesWithFailures: number;
  notified: number;
  skippedOptedOut: number;
  skippedNoRecipient: number;
  suppressed: number;
  failed: number;
}

export async function runFailureDigestCycle(deps: FailureDigestDeps): Promise<FailureDigestResult> {
  const periodMs = deps.periodMs ?? DEFAULT_PERIOD_MS;
  const sinceIso = new Date(Date.now() - periodMs).toISOString();
  const periodLabel = deps.periodLabel ?? "the last 24 hours";

  const byWorkspace = await deps.fetchFailuresByWorkspace(sinceIso);

  let notified = 0;
  let skippedOptedOut = 0;
  let skippedNoRecipient = 0;
  let suppressed = 0;
  let failed = 0;
  let workspacesWithFailures = 0;

  for (const [workspaceId, failures] of byWorkspace) {
    // Never send an empty digest (acceptance: zero failures → no email).
    if (!failures || failures.length === 0) continue;
    workspacesWithFailures += 1;

    if (await deps.isOptedOut(workspaceId)) {
      skippedOptedOut += 1;
      continue;
    }
    const email = await deps.resolveRecipientEmail(workspaceId);
    if (!email) {
      skippedNoRecipient += 1;
      continue;
    }

    const withUrls = failures.map((f) => ({
      ...f,
      url: deps.buildRunUrl ? deps.buildRunUrl(f.runId) : f.url ?? null,
    }));

    try {
      const result = await deps.mailer.sendTemplate({
        template: "workflow-failure-digest",
        to: email,
        workspaceId,
        data: { failures: withUrls, periodLabel },
      });
      if (result.suppressed) suppressed += 1;
      else notified += 1;
    } catch (err) {
      console.error(
        `[failure-digest] send failed for workspace ${workspaceId}: ${(err as Error).message}`,
      );
      failed += 1;
    }
  }

  return {
    workspacesWithFailures,
    notified,
    skippedOptedOut,
    skippedNoRecipient,
    suppressed,
    failed,
  };
}

// ---------------------------------------------------------------------------
// Real deps (Postgres + Supabase)
// ---------------------------------------------------------------------------

function persistenceAvailable(): boolean {
  if (isPostgresPersistenceEnabled()) return true;
  if (inMemoryAllowed()) return false;
  throw new Error("failureDigest requires DATABASE_URL outside development/test.");
}

/** Failed runs since `sinceIso`, grouped by workspace (service-role; all tenants). */
export async function fetchFailuresByWorkspace(
  pool: Pool,
  sinceIso: string,
): Promise<Map<string, FailedRun[]>> {
  const result = await pool.query<{
    id: string;
    workspace_id: string | null;
    template_name: string | null;
    error: string | null;
    failure_reason: string | null;
    failed_at: string | null;
  }>(
    `SELECT r.id,
            r.workspace_id::text AS workspace_id,
            w.name AS template_name,
            r.error,
            r.failure_reason,
            r.failed_at::text AS failed_at
       FROM runs r
       JOIN workflow_versions v ON v.id = r.workflow_version_id
       JOIN workflows w ON w.id = v.workflow_id
      WHERE r.status = 'failed'
        AND r.workspace_id IS NOT NULL
        AND COALESCE(r.failed_at, r.ended_at, r.started_at) >= $1::timestamptz
      ORDER BY r.workspace_id, COALESCE(r.failed_at, r.ended_at, r.started_at) DESC`,
    [sinceIso],
  );

  const byWorkspace = new Map<string, FailedRun[]>();
  for (const row of result.rows) {
    const workspaceId = row.workspace_id;
    if (!workspaceId) continue;
    const list = byWorkspace.get(workspaceId) ?? [];
    list.push({
      runId: String(row.id),
      workflowName: row.template_name ?? "Workflow",
      error: row.error ?? row.failure_reason ?? null,
      failedAt: row.failed_at ?? null,
    });
    byWorkspace.set(workspaceId, list);
  }
  return byWorkspace;
}

/** Workspace owner's email via owner_user_id → Supabase admin. */
export async function resolveWorkspaceOwnerEmail(
  pool: Pool,
  workspaceId: string,
): Promise<string | null> {
  const res = await pool.query<{ owner_user_id: string | null }>(
    "SELECT owner_user_id::text AS owner_user_id FROM workspaces WHERE id = $1",
    [workspaceId],
  );
  const ownerId = res.rows[0]?.owner_user_id;
  if (!ownerId || !isSupabaseAdminConfigured()) return null;
  try {
    const got = await getSupabaseAdminClient().auth.admin.getUserById(ownerId);
    return got.data.user?.email ?? null;
  } catch {
    return null;
  }
}

/** True when the workspace set notification_preferences(email, workflow_failures) disabled. */
export async function isFailureDigestOptedOut(pool: Pool, workspaceId: string): Promise<boolean> {
  const res = await pool.query<{ enabled: boolean }>(
    `SELECT enabled FROM notification_preferences
      WHERE workspace_id = $1 AND channel = 'email' AND kind = 'workflow_failures'`,
    [workspaceId],
  );
  const row = res.rows[0];
  return row ? row.enabled === false : false;
}

function dashboardRunUrl(runId: string): string | null {
  const base = (process.env.DASHBOARD_APP_URL ?? "").trim().replace(/\/$/, "");
  return base ? `${base}/runs/${runId}` : null;
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

interface SchedulerHandle {
  stop: () => void;
}

export function startWorkflowFailureDigestJob(opts?: {
  intervalMs?: number;
  periodMs?: number;
  logger?: Pick<typeof console, "log" | "warn" | "error">;
}): SchedulerHandle {
  const intervalMs = opts?.intervalMs ?? DEFAULT_INTERVAL_MS;
  const periodMs = opts?.periodMs ?? DEFAULT_PERIOD_MS;
  const logger = opts?.logger ?? console;

  if (!isPostgresPersistenceEnabled()) {
    logger.log("[failureDigest] DATABASE_URL not configured — failure digest disabled");
    return { stop: () => undefined };
  }

  const tick = (): void => {
    if (!persistenceAvailable()) return;
    const pool = getPostgresPool();
    const startedAt = new Date();
    runFailureDigestCycle({
      fetchFailuresByWorkspace: (sinceIso) => fetchFailuresByWorkspace(pool, sinceIso),
      resolveRecipientEmail: (workspaceId) => resolveWorkspaceOwnerEmail(pool, workspaceId),
      isOptedOut: (workspaceId) => isFailureDigestOptedOut(pool, workspaceId),
      mailer: buildSystemMailer(),
      buildRunUrl: dashboardRunUrl,
      periodMs,
    })
      .then((result) => {
        if (result.notified > 0 || result.failed > 0) {
          logger.log(
            `[failureDigest] notified ${result.notified} workspace(s) ` +
              `(${result.workspacesWithFailures} had failures, ${result.skippedOptedOut} opted out, ` +
              `${result.skippedNoRecipient} no recipient, ${result.suppressed} suppressed, ${result.failed} failed)`,
          );
        }
        void safeLogJobRun({
          jobName: "workflow_failure_digest",
          startedAt,
          endedAt: new Date(),
          outcome: "success",
          payload: { ...result },
        });
      })
      .catch((err) => {
        logger.error(
          `[failureDigest] cycle failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        void safeLogJobRun({
          jobName: "workflow_failure_digest",
          startedAt,
          endedAt: new Date(),
          outcome: "failure",
          message: err instanceof Error ? err.message : String(err),
        });
      });
  };

  tick();
  const handle = setInterval(tick, intervalMs);
  if (typeof handle.unref === "function") handle.unref();
  logger.log(`[failureDigest] started, interval=${intervalMs}ms`);

  return { stop: () => clearInterval(handle) };
}
