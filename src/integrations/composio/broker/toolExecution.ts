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

/**
 * Execute a Composio tool against the workspace's connected account.
 * Maps the SDK's `{ data, successful, error }` response onto our result shape and
 * surfaces the connected account that ran it.
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
  const response = await composio.tools.execute(input.slug, {
    // The tenancy seam: the Composio userId is the `ws_<id>`, never the AutoFlow actor.
    userId: composioUserId(input.workspaceId),
    connectedAccountId: account.connectedAccountId,
    arguments: input.arguments,
  });

  return {
    successful: Boolean(response.successful),
    data: (response.data as Record<string, unknown> | null) ?? null,
    error: response.error ?? null,
    connectedAccountId: account.connectedAccountId,
  };
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
