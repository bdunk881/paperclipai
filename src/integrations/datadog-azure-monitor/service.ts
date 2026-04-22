import { monitoringCredentialStore } from "./credentialStore";
import { DatadogClient } from "./datadogClient";
import { logMonitoring } from "./logger";
import {
  buildAzureOAuthUrl,
  exchangeCodeForTokens,
  parseAzureScopes,
  refreshAccessToken,
} from "./oauth";
import { consumePkceState, createPkceState } from "./pkceStore";
import {
  ConnectorError,
  MonitoringConnectionHealth,
  MonitoringCredential,
  MonitoringCredentialPublic,
  MonitoringProvider,
} from "./types";
import { AzureMonitorClient } from "./azureMonitorClient";

const DEFAULT_DATADOG_SITE = "datadoghq.com";

export class DatadogAzureMonitorConnectorService {
  beginAzureOAuth(userId: string): {
    authUrl: string;
    state: string;
    codeVerifier: string;
    expiresInSeconds: number;
  } {
    const pkce = createPkceState(userId);
    const authUrl = buildAzureOAuthUrl({
      state: pkce.state,
      codeChallenge: pkce.challenge,
    });

    logMonitoring({
      event: "connect",
      level: "info",
      connector: "datadog-azure-monitor",
      provider: "azure_monitor",
      userId,
      message: "Azure Monitor OAuth flow initialized",
      metadata: { authMethod: "oauth2_pkce" },
    });

    return {
      authUrl,
      state: pkce.state,
      codeVerifier: pkce.verifier,
      expiresInSeconds: pkce.expiresInSeconds,
    };
  }

  async completeAzureOAuth(params: { code: string; state: string }): Promise<MonitoringCredentialPublic> {
    const state = consumePkceState(params.state);
    if (!state) {
      throw new ConnectorError("auth", "OAuth state is invalid or expired", 401);
    }

    const tokenSet = await exchangeCodeForTokens({
      code: params.code,
      codeVerifier: state.verifier,
    });

    const credential = monitoringCredentialStore.saveOAuth({
      userId: state.userId,
      provider: "azure_monitor",
      accessToken: tokenSet.accessToken,
      refreshToken: tokenSet.refreshToken,
      scopes: parseAzureScopes(tokenSet.scope),
      tenantId: tokenSet.tenantId,
      accountId: tokenSet.accountId,
      accountName: tokenSet.accountName,
      metadata: tokenSet.expiresAt ? { expiresAt: tokenSet.expiresAt } : undefined,
    });

    logMonitoring({
      event: "connect",
      level: "info",
      connector: "datadog-azure-monitor",
      provider: "azure_monitor",
      userId: state.userId,
      accountId: tokenSet.accountId,
      message: "Azure Monitor OAuth connection completed",
      metadata: { authMethod: "oauth2_pkce" },
    });

    return credential;
  }

  async connectDatadogApiKey(params: {
    userId: string;
    apiKey: string;
    appKey?: string;
    site?: string;
  }): Promise<MonitoringCredentialPublic> {
    const site = params.site?.trim() || DEFAULT_DATADOG_SITE;
    const client = new DatadogClient({
      apiKey: params.apiKey,
      appKey: params.appKey,
      site,
    });

    const validation = await client.validate();
    if (!validation.valid) {
      throw new ConnectorError("auth", "Datadog API key validation failed", 401);
    }

    const scopes: string[] = ["metrics:read"];
    if (params.appKey?.trim()) {
      scopes.push("application_key");
    }

    const credential = monitoringCredentialStore.saveApiKey({
      userId: params.userId,
      provider: "datadog",
      apiKey: params.apiKey,
      site,
      scopes,
      accountId: site,
      accountName: `Datadog (${site})`,
      metadata: {
        site,
        hasAppKey: params.appKey?.trim() ? "true" : "false",
        ...(params.appKey?.trim() ? { appKey: params.appKey.trim() } : {}),
      },
    });

    logMonitoring({
      event: "connect",
      level: "info",
      connector: "datadog-azure-monitor",
      provider: "datadog",
      userId: params.userId,
      accountId: site,
      message: "Datadog API-key connection completed",
      metadata: { authMethod: "api_key", site },
    });

    return credential;
  }

  listConnections(userId: string): MonitoringCredentialPublic[] {
    return monitoringCredentialStore.getPublicByUser(userId);
  }

  async testConnection(
    userId: string,
    provider?: MonitoringProvider
  ): Promise<{ provider: MonitoringProvider; accountId?: string; accountName?: string }> {
    const credential = await this.ensureValidCredential(userId, provider);

    if (credential.provider === "datadog") {
      const client = this.createDatadogClient(credential);
      const result = await client.validate();
      if (!result.valid) {
        throw new ConnectorError("auth", "Datadog API key validation failed", 401);
      }

      logMonitoring({
        event: "sync",
        level: "info",
        connector: "datadog-azure-monitor",
        provider: "datadog",
        userId,
        accountId: credential.accountId,
        message: "Datadog test connection succeeded",
      });

      return {
        provider: "datadog",
        accountId: credential.accountId,
        accountName: credential.accountName,
      };
    }

    const client = new AzureMonitorClient(monitoringCredentialStore.decryptAccessToken(credential));
    const subscriptions = await client.listSubscriptions();

    logMonitoring({
      event: "sync",
      level: "info",
      connector: "datadog-azure-monitor",
      provider: "azure_monitor",
      userId,
      accountId: subscriptions[0]?.subscriptionId,
      message: "Azure Monitor test connection succeeded",
    });

    return {
      provider: "azure_monitor",
      accountId: subscriptions[0]?.subscriptionId,
      accountName: subscriptions[0]?.displayName,
    };
  }

  async health(userId: string, provider?: MonitoringProvider): Promise<MonitoringConnectionHealth> {
    const checkedAt = new Date().toISOString();
    const credential = provider
      ? monitoringCredentialStore.getActiveByUserAndProvider(userId, provider)
      : monitoringCredentialStore.getLatestActiveByUser(userId);

    if (!credential) {
      return {
        status: "down",
        checkedAt,
        details: {
          auth: false,
          apiReachable: false,
          rateLimited: false,
          errorType: "auth",
          message: "No Datadog/Azure Monitor credential is connected",
        },
      };
    }

    try {
      await this.testConnection(userId, credential.provider);

      return {
        status: "ok",
        checkedAt,
        provider: credential.provider,
        authMethod: credential.authMethod,
        tokenRefreshStatus:
          credential.authMethod === "oauth2_pkce"
            ? credential.refreshTokenEncrypted
              ? "healthy"
              : "failed"
            : "not_applicable",
        details: {
          auth: true,
          apiReachable: true,
          rateLimited: false,
        },
      };
    } catch (error) {
      const connectorError = error instanceof ConnectorError
        ? error
        : new ConnectorError("upstream", error instanceof Error ? error.message : String(error), 502);

      logMonitoring({
        event: "error",
        level: "error",
        connector: "datadog-azure-monitor",
        provider: credential.provider,
        userId,
        accountId: credential.accountId,
        message: connectorError.message,
        errorType: connectorError.type,
      });

      return {
        status: connectorError.type === "rate-limit" ? "degraded" : "down",
        checkedAt,
        provider: credential.provider,
        authMethod: credential.authMethod,
        tokenRefreshStatus:
          credential.authMethod === "oauth2_pkce"
            ? connectorError.type === "auth"
              ? "failed"
              : "healthy"
            : "not_applicable",
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

  disconnect(userId: string, credentialId: string): boolean {
    const revoked = monitoringCredentialStore.revoke(credentialId, userId);

    if (revoked) {
      logMonitoring({
        event: "disconnect",
        level: "info",
        connector: "datadog-azure-monitor",
        userId,
        message: "Datadog/Azure Monitor credential revoked",
        metadata: { credentialId },
      });
    }

    return revoked;
  }

  async queryDatadogMetrics(userId: string, params: {
    query: string;
    from: number;
    to: number;
  }): Promise<Array<{ metric?: string; scope?: string; points: Array<[number, number | null]> }>> {
    const credential = await this.ensureValidCredential(userId, "datadog");
    const client = this.createDatadogClient(credential);
    return client.queryMetrics(params);
  }

  async listAzureSubscriptions(userId: string): Promise<Array<{ subscriptionId: string; displayName?: string; state?: string }>> {
    const credential = await this.ensureValidCredential(userId, "azure_monitor");
    const client = new AzureMonitorClient(monitoringCredentialStore.decryptAccessToken(credential));
    return client.listSubscriptions();
  }

  async queryAzureMetrics(userId: string, params: {
    resourceId: string;
    metricName: string;
    timespan: string;
    interval?: string;
  }): Promise<Array<{ name: string; timeseriesCount: number }>> {
    const credential = await this.ensureValidCredential(userId, "azure_monitor");
    const client = new AzureMonitorClient(monitoringCredentialStore.decryptAccessToken(credential));
    return client.listMetrics(params);
  }

  private createDatadogClient(credential: MonitoringCredential): DatadogClient {
    const apiKey = monitoringCredentialStore.decryptAccessToken(credential);
    const site = credential.site ?? credential.metadata?.site ?? DEFAULT_DATADOG_SITE;
    const appKey = credential.metadata?.appKey;

    return new DatadogClient({
      apiKey,
      appKey,
      site,
    });
  }

  private async ensureValidCredential(
    userId: string,
    provider?: MonitoringProvider
  ): Promise<MonitoringCredential> {
    const credential = provider
      ? monitoringCredentialStore.getActiveByUserAndProvider(userId, provider)
      : monitoringCredentialStore.getLatestActiveByUser(userId);

    if (!credential) {
      throw new ConnectorError("auth", "Datadog/Azure Monitor connector is not configured", 404);
    }

    if (credential.provider === "azure_monitor" && credential.authMethod === "oauth2_pkce") {
      const expiresAt = credential.metadata?.expiresAt;
      if (expiresAt && Date.now() >= Date.parse(expiresAt) - 60_000) {
        try {
          const refreshToken = monitoringCredentialStore.decryptRefreshToken(credential);
          if (!refreshToken) {
            throw new ConnectorError("auth", "Missing refresh token", 401);
          }

          const refreshed = await refreshAccessToken(refreshToken);
          monitoringCredentialStore.rotateToken({
            credentialId: credential.id,
            accessToken: refreshed.accessToken,
            refreshToken: refreshed.refreshToken,
            scopes: parseAzureScopes(refreshed.scope),
            expiresAt: refreshed.expiresAt,
          });

          logMonitoring({
            event: "sync",
            level: "info",
            connector: "datadog-azure-monitor",
            provider: "azure_monitor",
            userId,
            accountId: credential.accountId,
            message: "Azure Monitor OAuth token refreshed",
          });

          const updatedCredential = monitoringCredentialStore.getActiveByUserAndProvider(
            userId,
            "azure_monitor"
          );
          if (!updatedCredential) {
            throw new ConnectorError("auth", "Credential missing after token refresh", 404);
          }
          return updatedCredential;
        } catch (error) {
          throw error instanceof ConnectorError
            ? error
            : new ConnectorError("auth", "Failed to refresh Azure Monitor token", 401);
        }
      }
    }

    return credential;
  }
}

export const datadogAzureMonitorConnectorService = new DatadogAzureMonitorConnectorService();
