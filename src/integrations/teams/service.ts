import { teamsCredentialStore } from "./credentialStore";
import { logTeams } from "./logger";
import {
  buildTeamsOAuthUrl,
  exchangeCodeForTokens,
  parseTeamsScopes,
  refreshAccessToken,
} from "./oauth";
import { consumePkceState, createPkceState } from "./pkceStore";
import { runOAuthTokenRefreshMiddleware } from "../shared/tokenRefreshMiddleware";
import { TeamsClient } from "./teamsClient";
import { ConnectorError, TeamsConnectionHealth, TeamsCredentialPublic } from "./types";

export class TeamsConnectorService {
  beginOAuth(userId: string): {
    authUrl: string;
    state: string;
    codeVerifier: string;
    expiresInSeconds: number;
  } {
    const pkce = createPkceState(userId);
    const authUrl = buildTeamsOAuthUrl({
      state: pkce.state,
      codeChallenge: pkce.challenge,
    });

    logTeams({
      event: "connect",
      level: "info",
      connector: "microsoft-teams",
      userId,
      message: "Microsoft Teams OAuth flow initialized",
      metadata: { authMethod: "oauth2_pkce" },
    });

    return {
      authUrl,
      state: pkce.state,
      codeVerifier: pkce.verifier,
      expiresInSeconds: pkce.expiresInSeconds,
    };
  }

  async completeOAuth(params: { code: string; state: string }): Promise<TeamsCredentialPublic> {
    const state = consumePkceState(params.state);
    if (!state) {
      throw new ConnectorError("auth", "OAuth state is invalid or expired", 401);
    }

    const tokenSet = await exchangeCodeForTokens({
      code: params.code,
      codeVerifier: state.verifier,
    });

    const credential = teamsCredentialStore.saveOAuth({
      userId: state.userId,
      accessToken: tokenSet.accessToken,
      refreshToken: tokenSet.refreshToken,
      scopes: parseTeamsScopes(tokenSet.scope),
      tenantId: tokenSet.tenantId,
      accountId: tokenSet.accountId,
      accountName: tokenSet.accountName,
      metadata: tokenSet.expiresAt ? { expiresAt: tokenSet.expiresAt } : undefined,
    });

    logTeams({
      event: "connect",
      level: "info",
      connector: "microsoft-teams",
      userId: state.userId,
      accountId: tokenSet.accountId,
      message: "Microsoft Teams OAuth connection completed",
      metadata: { authMethod: "oauth2_pkce" },
    });

    return credential;
  }

  async connectApiKey(params: { userId: string; apiKey: string }): Promise<TeamsCredentialPublic> {
    const client = new TeamsClient(params.apiKey);
    const me = await client.me();

    const credential = teamsCredentialStore.saveApiKey({
      userId: params.userId,
      apiKey: params.apiKey,
      tenantId: process.env.TEAMS_TENANT_ID ?? "common",
      accountId: me.id,
      accountName: me.displayName ?? me.userPrincipalName,
      metadata: { accountId: me.id },
    });

    logTeams({
      event: "connect",
      level: "info",
      connector: "microsoft-teams",
      userId: params.userId,
      accountId: me.id,
      message: "Microsoft Teams API-key fallback connection completed",
      metadata: { authMethod: "api_key" },
    });

    return credential;
  }

  listConnections(userId: string): TeamsCredentialPublic[] {
    return teamsCredentialStore.getPublicByUser(userId);
  }

  async testConnection(userId: string): Promise<{ accountId: string; accountName?: string }> {
    const credential = await this.ensureValidCredential(userId);
    const token = teamsCredentialStore.decryptAccessToken(credential);
    const client = new TeamsClient(token);
    const me = await client.me();

    logTeams({
      event: "sync",
      level: "info",
      connector: "microsoft-teams",
      userId,
      accountId: me.id,
      message: "Microsoft Teams test connection succeeded",
    });

    return {
      accountId: me.id,
      accountName: me.displayName ?? me.userPrincipalName,
    };
  }

  async health(userId: string): Promise<TeamsConnectionHealth> {
    const checkedAt = new Date().toISOString();
    const credential = teamsCredentialStore.getActiveByUser(userId);

    if (!credential) {
      return {
        status: "down",
        checkedAt,
        details: {
          auth: false,
          apiReachable: false,
          rateLimited: false,
          errorType: "auth",
          message: "No Microsoft Teams credential is connected",
        },
      };
    }

    try {
      const token = teamsCredentialStore.decryptAccessToken(credential);
      const client = new TeamsClient(token);
      await client.me();

      return {
        status: "ok",
        checkedAt,
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

      logTeams({
        event: "error",
        level: "error",
        connector: "microsoft-teams",
        userId,
        accountId: credential.accountId,
        message: connectorError.message,
        errorType: connectorError.type,
      });

      return {
        status: connectorError.type === "rate-limit" ? "degraded" : "down",
        checkedAt,
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
    const revoked = teamsCredentialStore.revoke(credentialId, userId);

    if (revoked) {
      logTeams({
        event: "disconnect",
        level: "info",
        connector: "microsoft-teams",
        userId,
        message: "Teams credential revoked",
        metadata: { credentialId },
      });
    }

    return revoked;
  }

  async listTeams(userId: string): Promise<Array<{ id: string; displayName?: string; description?: string }>> {
    const credential = await this.ensureValidCredential(userId);
    const client = new TeamsClient(teamsCredentialStore.decryptAccessToken(credential));
    return client.listTeams();
  }

  async listChats(userId: string): Promise<Array<{ id: string; topic?: string; chatType?: string }>> {
    const credential = await this.ensureValidCredential(userId);
    const client = new TeamsClient(teamsCredentialStore.decryptAccessToken(credential));
    return client.listChats();
  }

  async listChannelMessages(
    userId: string,
    teamId: string,
    channelId: string
  ): Promise<Array<{ id: string; summary?: string; createdDateTime?: string }>> {
    const credential = await this.ensureValidCredential(userId);
    const client = new TeamsClient(teamsCredentialStore.decryptAccessToken(credential));
    return client.listChannelMessages(teamId, channelId);
  }

  private async ensureValidCredential(userId: string) {
    const credential = teamsCredentialStore.getActiveByUser(userId);
    if (!credential) {
      throw new ConnectorError("auth", "Microsoft Teams connector is not configured", 404);
    }

    const refreshed = await runOAuthTokenRefreshMiddleware({
      shouldAttemptRefresh: credential.authMethod === "oauth2_pkce" && Boolean(credential.refreshTokenEncrypted),
      expiresAt: credential.metadata?.expiresAt,
      getRefreshToken: () => teamsCredentialStore.decryptRefreshToken(credential),
      refreshAccessToken,
      persistRefreshedToken: (tokenSet) => {
        teamsCredentialStore.rotateToken({
          credentialId: credential.id,
          accessToken: tokenSet.accessToken,
          refreshToken: tokenSet.refreshToken,
          scopes: parseTeamsScopes(tokenSet.scope),
          expiresAt: tokenSet.expiresAt,
        });
      },
      onRefreshSuccess: () => {
        logTeams({
          event: "sync",
          level: "info",
          connector: "microsoft-teams",
          userId,
          accountId: credential.accountId,
          message: "Teams OAuth token refreshed",
        });
      },
      isKnownError: (error) => error instanceof ConnectorError,
      createAuthError: (message, statusCode) => new ConnectorError("auth", message, statusCode),
      refreshFailedMessage: "Failed to refresh Teams token",
    });

    if (refreshed) {
      const updatedCredential = teamsCredentialStore.getActiveByUser(userId);
      if (!updatedCredential) {
        throw new ConnectorError("auth", "Credential missing after token refresh", 404);
      }
      return updatedCredential;
    }

    return credential;
  }
}

export const teamsConnectorService = new TeamsConnectorService();
