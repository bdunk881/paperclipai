import type { WorkflowStep } from "../../types/workflow";

/**
 * HEL-656: the dynamic connector-action library — the spine of HEL-647.
 *
 * Each connector declares its actions as data (a {@link ConnectorActionDef}),
 * and the engine's `executeAction` dispatches to `invoke` generically by
 * `actionId` instead of a hardcoded `actionRegistry.set("slack.notify", …)`
 * per action. New connectors light up by registering more defs (and, for the
 * builder, by appearing in the connection-gated catalog — HEL-647 PR 4/5).
 *
 * Connection scope is **run-owner**: `invoke` receives the run owner's
 * `userId` (connector credential stores key on it) plus an optional
 * `connectionId` to select among several connections the user holds for the
 * same provider (e.g. multiple Slack teams).
 */
export interface ConnectorActionInvocation {
  /** Run owner — connector credential lookups key on this. */
  userId: string;
  /** Optional specific connection (the user may hold several per provider). */
  connectionId?: string;
  /** Resolved declared inputs for the step (step.inputKeys ← context/config). */
  inputs: Record<string, unknown>;
  /** The run config. */
  config: Record<string, unknown>;
  /** The full workflow step (for step.config access). */
  step: WorkflowStep;
}

export interface ConnectorActionDef {
  /** Owning connector, e.g. "slack", "hubspot". Gates catalog visibility. */
  connectorKey: string;
  /** Stable action id used as `step.action`, e.g. "slack.notify". */
  actionId: string;
  /** Human label for the builder palette. */
  label: string;
  description?: string;
  /** True if the action has an external side effect (send/create/update). */
  isWrite: boolean;
  /**
   * Connector connection provider this action's credential resolves against.
   * Defaults to `connectorKey`; set when the credential provider differs.
   */
  connectionProvider?: string;
  /** Perform the action — or throw / return an honest failure. */
  invoke: (invocation: ConnectorActionInvocation) => Promise<Record<string, unknown>>;
}

// allowlist: in-process connector-action library / runtime registry (not customer data)
const registry = new Map<string, ConnectorActionDef>();

/** Register (or overwrite) a connector action by its `actionId`. */
export function registerConnectorAction(def: ConnectorActionDef): void {
  registry.set(def.actionId, def);
}

/** Resolve a connector action by its `actionId` (i.e. `step.action`). */
export function getConnectorAction(actionId: string): ConnectorActionDef | undefined {
  return registry.get(actionId);
}

/** All registered connector actions (e.g. for the catalog API — HEL-647 PR 4). */
export function listConnectorActions(): ConnectorActionDef[] {
  return Array.from(registry.values());
}
