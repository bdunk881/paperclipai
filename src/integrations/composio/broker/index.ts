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

export {
  loadCatalog,
  queryToolkitCatalog,
  isToolkitCatalogAvailable,
  resetToolkitCatalogForTests,
  type ToolkitCatalogEntry,
  type ToolkitCatalogQuery,
  type ToolkitCatalogPage,
  type ToolkitCategory,
} from "./toolkitCatalog";
