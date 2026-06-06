/**
 * triggerSubscriptionService — subscribe a workspace's connected account to a
 * Composio TRIGGER and persist the binding (HEL-765 / P4-a).
 *
 * The subscribe half of P4 (dual-source triggers): create/enable/disable/delete a
 * Composio trigger instance against a workspace's connected account, and persist
 * the `ti_ → agent` binding in triggerInstanceStore (P4-0) so the receive path
 * (P4-b) can route an incoming event to the right agent. Type discovery
 * (getTriggerType / listTriggerTypes) feeds the dashboard picker (P4-d).
 *
 * Tenancy seam (HEL-720): the Composio userId is ALWAYS composioUserId(workspaceId)
 * (`ws_<id>`), and the connected account is resolved via the RLS-scoped
 * connectedAccountStore. Gate on isComposioEnabled() before calling.
 */

import { isComposioEnabled, composioUserId } from "./config";
import { getComposioBroker } from "./client";
import { resolveActiveConnectedAccount } from "./toolExecution";
import { triggerInstanceStore, type ComposioTriggerInstanceRow } from "./triggerInstanceStore";
import type { ComposioWorkspaceContext } from "./connectedAccountStore";

export interface EnableTriggerInput {
  /** AutoFlow workspace — the tenancy key. */
  workspaceId: string;
  /** AutoFlow actor (audit/RLS context; NOT the Composio userId). */
  userId: string;
  /** The agent this trigger should wake when it fires. */
  agentId: string;
  /** Toolkit slug (the app), e.g. "github". */
  toolkit: string;
  /** Trigger type slug, e.g. "GITHUB_COMMIT_EVENT". */
  slug: string;
  /** Trigger-specific config matching the type's `config` schema (getTriggerType). */
  triggerConfig?: Record<string, unknown>;
  /** Optional explicit connected_account_id (ca_…); defaults to the toolkit's active one. */
  connectionId?: string;
}

/** A trigger type's full definition (drives the dashboard config form, P4-d). */
export interface ComposioTriggerTypeInfo {
  slug: string;
  name: string;
  description: string;
  toolkit: { slug: string; name: string; logo: string };
  /** JSON-schema-ish object for the trigger's CONFIG fields (what the user sets up). */
  config: Record<string, unknown>;
  /** JSON-schema-ish object describing the event PAYLOAD a fired trigger delivers. */
  payload: Record<string, unknown>;
  instructions?: string;
}

/** A trigger type list entry (for the picker). */
export interface ComposioTriggerTypeSummary {
  slug: string;
  name: string;
  description: string;
  toolkit: { slug: string; name: string; logo: string };
}

function enabledOrThrow(): void {
  if (!isComposioEnabled()) {
    throw new Error(
      "Composio is not enabled (set COMPOSIO_ENABLED=true and COMPOSIO_API_KEY) — trigger subscriptions are unavailable.",
    );
  }
}

/**
 * Subscribe to a Composio trigger for the workspace's active connection and
 * persist the binding to `agentId`. Idempotent at the store level (re-subscribing
 * the same ti_ updates the binding).
 */
export async function enableTrigger(input: EnableTriggerInput): Promise<ComposioTriggerInstanceRow> {
  enabledOrThrow();
  const ctx: ComposioWorkspaceContext = { workspaceId: input.workspaceId, userId: input.userId };
  const account = await resolveActiveConnectedAccount(ctx, input.toolkit, input.connectionId);

  const composio = await getComposioBroker();
  const created = await composio.triggers.create(composioUserId(input.workspaceId), input.slug, {
    connectedAccountId: account.connectedAccountId,
    ...(input.triggerConfig ? { triggerConfig: input.triggerConfig } : {}),
  });
  if (!created?.triggerId) {
    throw new Error(`Composio did not return a triggerId when subscribing to ${input.slug}.`);
  }

  return triggerInstanceStore.create(ctx, {
    agentId: input.agentId,
    toolkit: input.toolkit,
    triggerSlug: input.slug,
    triggerId: created.triggerId,
    connectedAccountId: account.connectedAccountId,
    triggerConfig: input.triggerConfig ?? {},
    createdBy: input.userId,
    status: "ENABLED",
  });
}

/** Pause a trigger remotely + locally. Returns false if the local row is missing/foreign. */
export async function disableTrigger(
  ctx: ComposioWorkspaceContext,
  triggerId: string,
): Promise<boolean> {
  enabledOrThrow();
  const composio = await getComposioBroker();
  await composio.triggers.disable(triggerId);
  return triggerInstanceStore.markStatus(ctx, triggerId, "DISABLED");
}

/** Re-enable a previously disabled trigger. Returns false if missing/foreign. */
export async function enableExistingTrigger(
  ctx: ComposioWorkspaceContext,
  triggerId: string,
): Promise<boolean> {
  enabledOrThrow();
  const composio = await getComposioBroker();
  await composio.triggers.enable(triggerId);
  return triggerInstanceStore.markStatus(ctx, triggerId, "ENABLED");
}

/**
 * Delete a trigger subscription remotely + locally. The remote delete is
 * best-effort (a 404 / already-gone shouldn't strand the local row): the local
 * delete is the source of truth for our routing.
 */
export async function deleteTrigger(
  ctx: ComposioWorkspaceContext,
  triggerId: string,
): Promise<boolean> {
  enabledOrThrow();
  const composio = await getComposioBroker();
  try {
    await composio.triggers.delete(triggerId);
  } catch {
    // ignore — drop the local row regardless (see doc comment)
  }
  return triggerInstanceStore.deleteByTriggerId(ctx, triggerId);
}

/** Fetch a trigger type's full definition (config + payload schemas) for the UI. */
export async function getTriggerType(slug: string): Promise<ComposioTriggerTypeInfo> {
  enabledOrThrow();
  const composio = await getComposioBroker();
  const t = await composio.triggers.getType(slug);
  return {
    slug: t.slug,
    name: t.name,
    description: t.description,
    toolkit: t.toolkit,
    config: t.config,
    payload: t.payload,
    ...(t.instructions ? { instructions: t.instructions } : {}),
  };
}

/** List a toolkit's available trigger types (for the picker). Empty when disabled. */
export async function listTriggerTypes(toolkit: string): Promise<ComposioTriggerTypeSummary[]> {
  if (!isComposioEnabled()) return [];
  const composio = await getComposioBroker();
  const res = await composio.triggers.listTypes({ toolkits: [toolkit] });
  const items = Array.isArray(res?.items) ? res.items : [];
  return items.map((i) => ({
    slug: i.slug,
    name: i.name,
    description: i.description,
    toolkit: i.toolkit,
  }));
}
