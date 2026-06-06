/**
 * connectionService — Composio connect orchestration (HEL-740 / P1b).
 *
 * beginConnect (authenticated): provision the shared managed auth config, mint a
 * connect-state token, `link()` the connected account, persist an INITIATED row,
 * and return the hosted redirect URL.
 *
 * completeConnect (the unauthenticated OAuth callback): recover the workspace
 * context from the state token and flip the row to ACTIVE/INACTIVE.
 *
 * Managed OAuth uses `connectedAccounts.link()` — `initiate()` is deprecated for
 * Composio-managed OAuth (the legacy endpoint it wraps is being retired) and
 * stays only for API-key/bearer/basic imports (P1d).
 */

import { isComposioEnabled, composioUserId } from "./config";
import { getComposioBroker } from "./client";
import { provisionManagedAuthConfig, normalizeToolkitSlug } from "./authConfigProvisioning";
import { createConnectState, consumeConnectState } from "./connectStateStore";
import {
  connectedAccountStore,
  type ComposioConnectionStatus,
  type ComposioConnectedAccountRow,
  type ComposioWorkspaceContext,
} from "./connectedAccountStore";

export interface BeginConnectResult {
  redirectUrl: string | null;
  connectedAccountId: string;
  toolkit: string;
}

export interface CompleteConnectResult {
  status: "success" | "error";
  toolkit: string | null;
  message?: string;
}

/** Map the SDK's wider ConnectedAccountStatus onto our 4-value store union. */
export function normalizeConnectionStatus(raw?: string): ComposioConnectionStatus {
  switch ((raw ?? "").toUpperCase()) {
    case "ACTIVE":
      return "ACTIVE";
    case "EXPIRED":
      return "EXPIRED";
    case "INACTIVE":
    case "FAILED":
    case "REVOKED":
      return "INACTIVE";
    case "INITIALIZING":
    case "INITIATED":
    default:
      return "INITIATED";
  }
}

/**
 * Start a connect handshake for a toolkit. `callbackBaseUrl` is the public origin
 * of THIS backend (e.g. https://dev-api.helloautoflow.com) — Composio redirects
 * the user to `${callbackBaseUrl}/api/composio/callback?state=...` after consent.
 */
export async function beginConnect(
  ctx: ComposioWorkspaceContext,
  toolkit: string,
  opts: { callbackBaseUrl: string; allowMultiple?: boolean },
): Promise<BeginConnectResult> {
  if (!isComposioEnabled()) {
    throw new Error(
      "Composio is not enabled (set COMPOSIO_ENABLED=true and COMPOSIO_API_KEY) — cannot start a connection.",
    );
  }

  const slug = normalizeToolkitSlug(toolkit);
  const authConfigId = await provisionManagedAuthConfig(slug);

  const { state } = createConnectState({
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
    toolkit: slug,
  });
  const base = opts.callbackBaseUrl.replace(/\/+$/, "");
  const callbackUrl = `${base}/api/composio/callback?state=${encodeURIComponent(state)}`;

  const composio = await getComposioBroker();
  const connection = await composio.connectedAccounts.link(composioUserId(ctx.workspaceId), authConfigId, {
    callbackUrl,
    allowMultiple: opts.allowMultiple ?? false,
  });

  await connectedAccountStore.upsert(ctx, {
    toolkit: slug,
    connectedAccountId: connection.id,
    authConfigId,
    status: normalizeConnectionStatus(connection.status),
    createdBy: ctx.userId,
  });

  return {
    redirectUrl: connection.redirectUrl ?? null,
    connectedAccountId: connection.id,
    toolkit: slug,
  };
}

/**
 * Complete the handshake at the OAuth callback. `state` recovers the workspace
 * context; the query's `status` ("success"/"failed") + `connectedAccountId`
 * (ca_) come from Composio's redirect. Returns the dashboard redirect outcome.
 */
export async function completeConnect(
  state: string | undefined,
  query: { status?: string; connectedAccountId?: string },
): Promise<CompleteConnectResult> {
  const entry = state ? consumeConnectState(state) : null;
  if (!entry) {
    return { status: "error", toolkit: null, message: "Invalid or expired connection state." };
  }

  const succeeded = (query.status ?? "").toLowerCase() === "success";
  const caId = query.connectedAccountId?.trim();

  if (!succeeded) {
    if (caId) {
      await connectedAccountStore.markStatus(
        { workspaceId: entry.workspaceId, userId: entry.userId },
        caId,
        "INACTIVE",
      );
    }
    return { status: "error", toolkit: entry.toolkit, message: "Authorization was not completed." };
  }

  if (!caId) {
    return { status: "error", toolkit: entry.toolkit, message: "Missing connected account id." };
  }

  // markStatus only succeeds for a ca_ owned by this workspace (created INITIATED
  // at beginConnect), so a foreign/forged ca_ cannot be activated.
  const marked = await connectedAccountStore.markStatus(
    { workspaceId: entry.workspaceId, userId: entry.userId },
    caId,
    "ACTIVE",
  );
  if (!marked) {
    return { status: "error", toolkit: entry.toolkit, message: "Connection not found for this workspace." };
  }

  return { status: "success", toolkit: entry.toolkit };
}

export interface ConnectionView {
  connectedAccountId: string;
  toolkit: string;
  status: ComposioConnectionStatus;
  authConfigId: string;
  createdAt: string;
  updatedAt: string;
}

function toView(row: ComposioConnectedAccountRow): ConnectionView {
  return {
    connectedAccountId: row.connectedAccountId,
    toolkit: row.toolkit,
    status: row.status,
    authConfigId: row.authConfigId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * List a workspace's connections. Best-effort reconciles live status from
 * Composio (`connectedAccounts.list`) so drift (completed OAuth, expiry,
 * out-of-band revocation) is reflected; falls back to local rows when the
 * broker is disabled or the call fails.
 */
export async function listConnections(ctx: ComposioWorkspaceContext): Promise<ConnectionView[]> {
  const local = await connectedAccountStore.listByWorkspace(ctx);
  if (!isComposioEnabled() || local.length === 0) {
    return local.map(toView);
  }

  try {
    const composio = await getComposioBroker();
    const live = await composio.connectedAccounts.list({ userIds: [composioUserId(ctx.workspaceId)] });
    const liveStatusById = new Map<string, string>();
    for (const item of live?.items ?? []) {
      if (item?.id) liveStatusById.set(item.id, item.status);
    }
    for (const row of local) {
      const liveStatus = liveStatusById.get(row.connectedAccountId);
      if (!liveStatus) continue;
      const normalized = normalizeConnectionStatus(liveStatus);
      if (normalized !== row.status) {
        await connectedAccountStore.markStatus(ctx, row.connectedAccountId, normalized);
        row.status = normalized;
      }
    }
  } catch {
    // Best-effort reconciliation — return the local view on any failure.
  }

  return local.map(toView);
}

/**
 * Disconnect a connected account: best-effort revoke at Composio, then remove the
 * local record. Returns false if the ca_ isn't owned by this workspace (→ 404).
 *
 * Revoke is best-effort: removing our row disconnects the toolkit from this
 * workspace regardless, and a lingering Composio account is unusable without the
 * local row (it can be GC'd). We do not block the disconnect on a remote failure.
 */
export async function disconnectAccount(
  ctx: ComposioWorkspaceContext,
  connectedAccountId: string,
): Promise<boolean> {
  const row = await connectedAccountStore.getByConnectedAccountId(ctx, connectedAccountId);
  if (!row) {
    return false;
  }

  if (isComposioEnabled()) {
    try {
      const composio = await getComposioBroker();
      await composio.connectedAccounts.delete(connectedAccountId);
    } catch {
      // Best-effort revoke — see the doc comment above.
    }
  }

  await connectedAccountStore.deleteByConnectedAccountId(ctx, connectedAccountId);
  return true;
}
