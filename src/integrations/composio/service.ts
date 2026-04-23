import { composioCredentialStore } from "./credentialStore";
import { ComposioClient } from "./composioClient";
import { logComposio } from "./logger";
import {
  ComposioActiveTrigger,
  ComposioConnectedAccount,
  ComposioConnectionHealth,
  ComposioCredentialPublic,
  ComposioToolExecutionResult,
  ConnectorError,
} from "./types";

export class ComposioConnectorService {
  async connectApiKey(params: { userId: string; apiKey: string }): Promise<ComposioCredentialPublic> {
    const client = new ComposioClient(params.apiKey);
    const viewer = await client.viewer();

    const credential = composioCredentialStore.saveApiKey({
      userId: params.userId,
      apiKey: params.apiKey,
      metadata: { availableTools: String(viewer.availableTools) },
    });

    logComposio({
      event: "connect",
      level: "info",
      connector: "composio",
      userId: params.userId,
      message: "Composio API-key connection completed",
      metadata: { authMethod: "api_key", availableTools: viewer.availableTools },
    });

    return credential;
  }

  async listConnections(userId: string): Promise<ComposioCredentialPublic[]> {
    return composioCredentialStore.getPublicByUserAsync(userId);
  }

  async testConnection(userId: string): Promise<{ availableTools: number }> {
    const credential = await this.requireCredential(userId);
    const client = new ComposioClient(composioCredentialStore.decryptAccessToken(credential));
    const viewer = await client.viewer();

    logComposio({
      event: "sync",
      level: "info",
      connector: "composio",
      userId,
      message: "Composio test connection succeeded",
      metadata: { availableTools: viewer.availableTools },
    });

    return { availableTools: viewer.availableTools };
  }

  async health(userId: string): Promise<ComposioConnectionHealth> {
    const checkedAt = new Date().toISOString();
    const credential = await composioCredentialStore.getActiveByUserAsync(userId);

    if (!credential) {
      return {
        status: "down",
        checkedAt,
        details: {
          auth: false,
          apiReachable: false,
          rateLimited: false,
          errorType: "auth",
          message: "No Composio credential is connected",
        },
      };
    }

    try {
      const client = new ComposioClient(composioCredentialStore.decryptAccessToken(credential));
      await client.viewer();

      const health: ComposioConnectionHealth = {
        status: "ok",
        checkedAt,
        authMethod: credential.authMethod,
        tokenRefreshStatus: "not_applicable",
        details: {
          auth: true,
          apiReachable: true,
          rateLimited: false,
        },
      };

      logComposio({
        event: "health",
        level: "info",
        connector: "composio",
        userId,
        message: "Composio health check passed",
      });

      return health;
    } catch (error) {
      const connectorError = error instanceof ConnectorError
        ? error
        : new ConnectorError("upstream", error instanceof Error ? error.message : String(error), 502);

      logComposio({
        event: "error",
        level: "error",
        connector: "composio",
        userId,
        message: connectorError.message,
        errorType: connectorError.type,
      });

      return {
        status: connectorError.type === "rate-limit" ? "degraded" : "down",
        checkedAt,
        authMethod: credential.authMethod,
        tokenRefreshStatus: "not_applicable",
        details: {
          auth: connectorError.type !== "auth",
          apiReachable: connectorError.type !== "network",
          rateLimited: connectorError.type === "rate-limit",
          errorType: connectorError.type,
          message: connectorError.message,
        },
      };
    }
  }

  async disconnect(userId: string, credentialId: string): Promise<boolean> {
    const revoked = await composioCredentialStore.revokeAsync(credentialId, userId);

    if (revoked) {
      logComposio({
        event: "disconnect",
        level: "info",
        connector: "composio",
        userId,
        message: "Composio credential revoked",
        metadata: { credentialId },
      });
    }

    return revoked;
  }

  async listToolEnums(userId: string): Promise<string[]> {
    const client = await this.createClient(userId);
    const tools = await client.listToolEnums();

    logComposio({
      event: "sync",
      level: "info",
      connector: "composio",
      userId,
      message: "Composio tool enums synced",
      metadata: { total: tools.length },
    });

    return tools;
  }

  async listConnectedAccounts(userId: string, params: {
    toolkitSlugs?: string[];
    statuses?: string[];
    targetUserIds?: string[];
    limit?: number;
    cursor?: string;
  }): Promise<{ items: ComposioConnectedAccount[]; nextCursor?: string | null }> {
    const client = await this.createClient(userId);
    const result = await client.listConnectedAccounts({
      toolkitSlugs: params.toolkitSlugs,
      statuses: params.statuses,
      userIds: params.targetUserIds,
      limit: params.limit,
      cursor: params.cursor,
    });

    logComposio({
      event: "sync",
      level: "info",
      connector: "composio",
      userId,
      message: "Composio connected accounts synced",
      metadata: { total: result.items.length },
    });

    return result;
  }

  async createConnectedAccount(userId: string, params: {
    authConfigId: string;
    externalUserId: string;
    connection?: Record<string, unknown>;
    validateCredentials?: boolean;
  }): Promise<ComposioConnectedAccount> {
    const client = await this.createClient(userId);
    const account = await client.createConnectedAccount({
      authConfigId: params.authConfigId,
      userId: params.externalUserId,
      connection: params.connection,
      validateCredentials: params.validateCredentials,
    });

    logComposio({
      event: "connect",
      level: "info",
      connector: "composio",
      userId,
      message: "Composio connected account initiated",
      metadata: {
        connectedAccountId: account.id,
        authConfigId: params.authConfigId,
        status: account.status,
      },
    });

    return account;
  }

  async refreshConnectedAccount(userId: string, params: {
    connectedAccountId: string;
    redirectUrl?: string;
    validateCredentials?: boolean;
  }): Promise<{ id: string; status?: string; redirectUrl?: string | null }> {
    const client = await this.createClient(userId);
    const result = await client.refreshConnectedAccount(params);

    logComposio({
      event: "connect",
      level: "info",
      connector: "composio",
      userId,
      message: "Composio connected account refresh initiated",
      metadata: {
        connectedAccountId: params.connectedAccountId,
        status: result.status,
      },
    });

    return result;
  }

  async executeTool(userId: string, params: {
    toolSlug: string;
    arguments?: Record<string, unknown>;
    connectedAccountId?: string;
    version?: string;
  }): Promise<ComposioToolExecutionResult> {
    const client = await this.createClient(userId);
    const result = await client.executeTool(params);

    logComposio({
      event: "sync",
      level: result.successful ? "info" : "warn",
      connector: "composio",
      userId,
      message: "Composio tool executed",
      metadata: {
        toolSlug: params.toolSlug,
        connectedAccountId: params.connectedAccountId,
        successful: result.successful,
      },
    });

    return result;
  }

  async listActiveTriggers(userId: string, params: {
    connectedAccountIds?: string[];
    triggerNames?: string[];
    limit?: number;
  }): Promise<ComposioActiveTrigger[]> {
    const client = await this.createClient(userId);
    const triggers = await client.listActiveTriggers(params);

    logComposio({
      event: "sync",
      level: "info",
      connector: "composio",
      userId,
      message: "Composio active triggers synced",
      metadata: { total: triggers.length },
    });

    return triggers;
  }

  async upsertTrigger(userId: string, params: {
    slug: string;
    connectedAccountId: string;
    triggerConfig?: Record<string, unknown>;
    toolkitVersions?: string | Record<string, string>;
  }): Promise<{ triggerId: string }> {
    const client = await this.createClient(userId);
    const result = await client.upsertTrigger(params);

    logComposio({
      event: "sync",
      level: "info",
      connector: "composio",
      userId,
      message: "Composio trigger upserted",
      metadata: {
        triggerId: result.triggerId,
        slug: params.slug,
        connectedAccountId: params.connectedAccountId,
      },
    });

    return result;
  }

  private async requireCredential(userId: string) {
    const credential = await composioCredentialStore.getActiveByUserAsync(userId);
    if (!credential) {
      throw new ConnectorError("auth", "No active Composio credential found", 404);
    }
    return credential;
  }

  private async createClient(userId: string): Promise<ComposioClient> {
    const credential = await this.requireCredential(userId);
    return new ComposioClient(composioCredentialStore.decryptAccessToken(credential));
  }
}

export const composioConnectorService = new ComposioConnectorService();
