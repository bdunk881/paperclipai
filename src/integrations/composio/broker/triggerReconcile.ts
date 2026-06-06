/**
 * Trigger reconcile (HEL-769 / P4-e).
 *
 * Best-effort drift detection: compares the workspace's local ENABLED trigger
 * instances against Composio's active set and marks any that are no longer active
 * remotely (disabled or deleted out-of-band, or dropped when a connected account
 * expired) as ERROR, so the dashboard surfaces them for re-subscribe.
 *
 * Run it after a connected account is re-authed (the EXPIRED → ACTIVE flow) and/or
 * periodically. The query is scoped to exactly the workspace's trigger ids
 * (`triggerIds` filter), so it never sees another tenant's triggers and pagination
 * stays bounded. Never throws — a broker hiccup is a no-op.
 */

import { isComposioEnabled } from "./config";
import { getComposioBroker } from "./client";
import { triggerInstanceStore } from "./triggerInstanceStore";
import type { ComposioWorkspaceContext } from "./connectedAccountStore";

export interface ReconcileResult {
  /** ENABLED local instances checked. */
  checked: number;
  /** triggerIds that were active locally but not remotely → marked ERROR. */
  drifted: string[];
}

export async function reconcileWorkspaceTriggers(
  ctx: ComposioWorkspaceContext,
): Promise<ReconcileResult> {
  if (!isComposioEnabled()) return { checked: 0, drifted: [] };

  const local = (await triggerInstanceStore.listByWorkspace(ctx)).filter(
    (t) => t.status === "ENABLED",
  );
  if (local.length === 0) return { checked: 0, drifted: [] };

  const localIds = local.map((t) => t.triggerId);

  let activeIds: Set<string>;
  try {
    const composio = await getComposioBroker();
    activeIds = new Set<string>();
    let cursor: string | undefined;
    do {
      const res = await composio.triggers.listActive({
        triggerIds: localIds,
        showDisabled: false,
        ...(cursor ? { cursor } : {}),
      });
      for (const item of res.items ?? []) activeIds.add(item.id);
      cursor = res.nextCursor ?? undefined;
    } while (cursor);
  } catch {
    // Best-effort — a broker failure must not mass-mark drift.
    return { checked: local.length, drifted: [] };
  }

  const drifted: string[] = [];
  for (const inst of local) {
    if (!activeIds.has(inst.triggerId)) {
      await triggerInstanceStore.markStatus(ctx, inst.triggerId, "ERROR");
      drifted.push(inst.triggerId);
    }
  }
  return { checked: local.length, drifted };
}
