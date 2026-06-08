/**
 * Composio tool EXECUTION surface (HEL-752 / P3-0).
 *
 * connectionService handles the OAuth lifecycle (begin/complete/list/disconnect);
 * this is the layer the workflow engine (P3a) and agent runtime (P3b/P3c) call to
 * actually RUN a Composio tool against a workspace's connected account, plus a
 * userless tool-definition lister the runtime uses to build agent tools.
 *
 * Tenancy seam (HEL-720): the Composio `userId` is ALWAYS derived from a verified
 * workspaceId via composioUserId() (the `ws_<id>` id), never the AutoFlow actor;
 * the connected account is resolved through connectedAccountStore, which is
 * RLS-scoped to the workspace. Gate on isComposioEnabled() before calling
 * executeComposioTool — getComposioBroker() throws when the key is absent.
 */

import * as Sentry from "@sentry/node";
import { isComposioEnabled, composioUserId } from "./config";
import { getComposioBroker } from "./client";
import {
  connectedAccountStore,
  type ComposioWorkspaceContext,
  type ComposioConnectedAccountRow,
} from "./connectedAccountStore";

export interface ExecuteComposioToolInput {
  /** AutoFlow workspace — the tenancy key (→ composioUserId + connected-account scope). */
  workspaceId: string;
  /** AutoFlow actor that triggered the call (audit/RLS context; NOT the Composio userId). */
  userId: string;
  /** Toolkit slug (the app), e.g. "github" — used to resolve the connected account. */
  toolkit: string;
  /** Tool slug, e.g. "GITHUB_CREATE_ISSUE". */
  slug: string;
  /** Tool arguments matching the tool's input schema. */
  arguments: Record<string, unknown>;
  /** Optional explicit connected_account_id (ca_…); defaults to the active one for the toolkit. */
  connectionId?: string;
}

export interface ComposioToolResult {
  successful: boolean;
  data: Record<string, unknown> | null;
  error: string | null;
  /** The connected account the tool ran against (for audit/trace). */
  connectedAccountId: string;
}

/**
 * Resolve which connected account a toolkit execution should run against:
 * an explicit `connectionId` (must be ACTIVE and owned by the workspace) if
 * given, else the workspace's active connection for the toolkit. Throws a clear,
 * actionable error when there is none.
 */
export async function resolveActiveConnectedAccount(
  ctx: ComposioWorkspaceContext,
  toolkit: string,
  connectionId?: string,
): Promise<ComposioConnectedAccountRow> {
  if (connectionId) {
    const row = await connectedAccountStore.getByConnectedAccountId(ctx, connectionId);
    if (!row) {
      throw new Error(`Connected account ${connectionId} not found for this workspace.`);
    }
    if (row.status !== "ACTIVE") {
      throw new Error(`Connected account ${connectionId} is ${row.status}, not ACTIVE.`);
    }
    return row;
  }

  const rows = await connectedAccountStore.listByToolkit(ctx, toolkit);
  const active = rows.find((r) => r.status === "ACTIVE");
  if (!active) {
    throw new Error(
      `No active ${toolkit} connection for this workspace — connect ${toolkit} before running its tools.`,
    );
  }
  return active;
}

// HEL-770 (P6a): rate-limit retry + observability hardening for tool execution.
const MAX_RATE_LIMIT_RETRIES = 2;

function rateLimitBaseDelayMs(): number {
  const n = Number(process.env.COMPOSIO_RATELIMIT_BASE_DELAY_MS);
  return Number.isFinite(n) && n >= 0 ? n : 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const RATE_LIMIT_RE = /rate.?limit|too many requests|\b429\b/i;

/** A THROWN rate-limit (429): the request was rejected, not executed → safe to retry. */
function isRateLimitError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { status?: unknown; statusCode?: unknown; code?: unknown; message?: unknown };
  if (e.status === 429 || e.statusCode === 429 || e.code === 429) return true;
  return typeof e.message === "string" && RATE_LIMIT_RE.test(e.message);
}

/** A rate-limit surfaced as a non-throwing result (`successful:false`, rate-limit error text). */
function isRateLimitedResult(error: string | null): boolean {
  return Boolean(error) && RATE_LIMIT_RE.test(error as string);
}

/** Best-effort observability — a structured log line + Sentry breadcrumb. Never throws. */
function recordToolExecution(
  input: ExecuteComposioToolInput,
  connectedAccountId: string,
  successful: boolean,
  latencyMs: number,
  error: string | null,
  attempts: number,
): void {
  try {
    const line =
      `[composio] execute toolkit=${input.toolkit} slug=${input.slug} ` +
      `ws=${input.workspaceId} ca=${connectedAccountId} ok=${successful} ms=${latencyMs}` +
      (attempts > 0 ? ` retries=${attempts}` : "") +
      (error ? ` error=${error}` : "");
    if (successful) console.log(line);
    else console.warn(line);
    Sentry.addBreadcrumb({
      category: "composio.tool",
      level: successful ? "info" : "warning",
      message: `composio.execute ${input.toolkit}.${input.slug}`,
      data: {
        toolkit: input.toolkit,
        slug: input.slug,
        workspaceId: input.workspaceId,
        connectedAccountId,
        successful,
        latencyMs,
        attempts,
        ...(error ? { error } : {}),
      },
    });
  } catch {
    // Observability must never break the tool call.
  }
}

/**
 * Execute a Composio tool against the workspace's connected account.
 * Maps the SDK's `{ data, successful, error }` response onto our result shape and
 * surfaces the connected account that ran it.
 *
 * HEL-770: emits a structured observability record (log + Sentry breadcrumb) per
 * execution, and retries ONLY on a rate-limit (429) — a rate-limited request was
 * rejected, not executed, so retry-with-backoff is safe even for write tools.
 * Other failures (5xx / network) are NOT auto-retried (the action may already
 * have run; retrying a non-idempotent write could double-execute) — they surface.
 */
export async function executeComposioTool(input: ExecuteComposioToolInput): Promise<ComposioToolResult> {
  if (!isComposioEnabled()) {
    throw new Error(
      "Composio is not enabled (set COMPOSIO_ENABLED=true and COMPOSIO_API_KEY) — cannot execute a tool.",
    );
  }

  const ctx: ComposioWorkspaceContext = { workspaceId: input.workspaceId, userId: input.userId };
  const account = await resolveActiveConnectedAccount(ctx, input.toolkit, input.connectionId);

  const composio = await getComposioBroker();
  const startedAt = Date.now();

  for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt += 1) {
    try {
      const response = await composio.tools.execute(input.slug, {
        // The tenancy seam: the Composio userId is the `ws_<id>`, never the AutoFlow actor.
        userId: composioUserId(input.workspaceId),
        connectedAccountId: account.connectedAccountId,
        arguments: input.arguments,
      });

      // Rate-limit that came back as a result (not a throw) — retry while budget remains.
      if (!response.successful && isRateLimitedResult(response.error ?? null) && attempt < MAX_RATE_LIMIT_RETRIES) {
        await sleep(rateLimitBaseDelayMs() * (attempt + 1));
        continue;
      }

      const result: ComposioToolResult = {
        successful: Boolean(response.successful),
        data: (response.data as Record<string, unknown> | null) ?? null,
        error: response.error ?? null,
        connectedAccountId: account.connectedAccountId,
      };
      recordToolExecution(input, account.connectedAccountId, result.successful, Date.now() - startedAt, result.error, attempt);
      return result;
    } catch (err) {
      // Only a 429 is safe to retry (rejected, not executed). Everything else surfaces.
      if (isRateLimitError(err) && attempt < MAX_RATE_LIMIT_RETRIES) {
        await sleep(rateLimitBaseDelayMs() * (attempt + 1));
        continue;
      }
      recordToolExecution(
        input,
        account.connectedAccountId,
        false,
        Date.now() - startedAt,
        err instanceof Error ? err.message : String(err),
        attempt,
      );
      throw err;
    }
  }

  // Unreachable: the final iteration always returns (success / non-retryable result)
  // or throws (non-retryable error). Satisfies control-flow analysis.
  throw new Error("executeComposioTool: exhausted rate-limit retries without resolving");
}

/**
 * Fetch raw Composio tool definitions for a toolkit (no user context needed) — the
 * agent runtime (P3b) maps these into native AgentTools. Returns an empty list
 * when the broker is disabled so callers degrade to "no Composio tools" rather
 * than throwing mid-run.
 */
export async function listComposioToolsForToolkit(opts: {
  toolkit: string;
  limit?: number;
}): Promise<unknown[]> {
  if (!isComposioEnabled()) {
    return [];
  }
  const composio = await getComposioBroker();
  const tools = await composio.tools.getRawComposioTools({
    toolkits: [opts.toolkit],
    ...(opts.limit ? { limit: opts.limit } : {}),
  });
  return Array.isArray(tools) ? tools : [];
}
