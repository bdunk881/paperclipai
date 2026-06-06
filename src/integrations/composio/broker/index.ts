/**
 * Composio backend broker (HEL-720 / HEL-721).
 *
 * One shared AutoFlow-owned Composio project; tenancy by `userId = workspaceId`.
 * This is the replacement for the legacy per-user `src/integrations/composio`
 * connector (removed in PR-B). Everything is gated behind `isComposioEnabled()`.
 */
export {
  isComposioEnabled,
  composioApiKeyOrThrow,
  composioApiBaseUrl,
  composioUserId,
  workspaceIdFromComposioUserId,
  warnIfComposioUnconfigured,
  resetComposioConfigWarningForTests,
} from "./config";

export {
  getComposioBroker,
  resetComposioBrokerForTests,
  type ComposioBrokerClient,
} from "./client";

export {
  connectedAccountStore,
  type ConnectedAccountStore,
  type ComposioConnectedAccountRow,
  type ComposioConnectionStatus,
  type ComposioWorkspaceContext,
  type UpsertConnectedAccountInput,
} from "./connectedAccountStore";

export {
  authConfigCacheStore,
  type AuthConfigCacheStore,
  type ComposioAuthConfigCacheRow,
} from "./authConfigCacheStore";

export {
  provisionManagedAuthConfig,
  normalizeToolkitSlug,
  resetAuthConfigProvisioningForTests,
} from "./authConfigProvisioning";

export {
  beginConnect,
  completeConnect,
  listConnections,
  disconnectAccount,
  normalizeConnectionStatus,
  type BeginConnectResult,
  type CompleteConnectResult,
  type ConnectionView,
} from "./connectionService";

export {
  createConnectState,
  consumeConnectState,
  clearConnectStateForTests,
  type ComposioConnectStateEntry,
} from "./connectStateStore";

export { composioConnectRouter, composioCallbackRouter } from "./oauthRoutes";

export { composioWebhookRouter } from "./webhookRoutes";
export {
  handleComposioWebhook,
  type ComposioWebhookHeaders,
  type ComposioWebhookOutcome,
} from "./webhookService";

export {
  loadCatalog,
  queryToolkitCatalog,
  isConnectableViaManagedAuth,
  isToolkitCatalogAvailable,
  resetToolkitCatalogForTests,
  type ToolkitCatalogEntry,
  type ToolkitCatalogQuery,
  type ToolkitCatalogPage,
  type ToolkitCategory,
} from "./toolkitCatalog";

export {
  executeComposioTool,
  resolveActiveConnectedAccount,
  listComposioToolsForToolkit,
  type ExecuteComposioToolInput,
  type ComposioToolResult,
} from "./toolExecution";

export {
  triggerInstanceStore,
  type TriggerInstanceStore,
  type ComposioTriggerInstanceRow,
  type ComposioTriggerStatus,
  type CreateTriggerInstanceInput,
} from "./triggerInstanceStore";

export {
  enableTrigger,
  disableTrigger,
  enableExistingTrigger,
  deleteTrigger,
  getTriggerType,
  listTriggerTypes,
  type EnableTriggerInput,
  type ComposioTriggerTypeInfo,
  type ComposioTriggerTypeSummary,
} from "./triggerSubscriptionService";
