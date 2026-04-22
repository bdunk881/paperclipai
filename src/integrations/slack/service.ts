import { slackCredentialStore } from "./credentialStore";
import { logSlack } from "./logger";
import { buildSlackOAuthUrl, exchangeCodeForTokens, refreshAccessToken } from "./oauth";
import { consumePkceState, createPkceState } from "./pkceStore";
import { SlackClient } from "./slackClient";
import { ConnectorError, SlackConnectionHealth, SlackCredential, SlackCredentialPublic } from "./types";

function parseScopes(scope?: string): string[] {
  if (!scope) {
    return [];
  }

  return scope
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export class SlackConnectorService {
  beginOAuth(userId: string): {
    authUrl: string;
    state: string;
    codeVerifier: string;
    expiresInSeconds: number;
  } {
    const pkce = createPkceState(userId);
    const authUrl = buildSlackOAuthUrl({
      state: pkce.state,
      codeChallenge: pkce.challenge,
    });

    logSlack({
      event: "connect",
      level: "info",
      connector: "slack",
      userId,
      message: "Slack OAuth flow initialized",
      metadata: { authMethod: "oauth2_pkce" },
    });

    return {
      authUrl,
      state: pkce.state,
      codeVerifier: pkce.verifier,
      expiresInSeconds: pkce.expiresInSeconds,
    };
  }

  async completeOAuth(params: { code: string; state: string }): Promise<SlackCredentialPublic> {
    const state = consumePkceState(params.state);
    if (!state) {
      throw new ConnectorError("auth", "OAuth state is invalid or expired", 401);
    }

    const tokenSet = await exchangeCodeForTokens({
      code: params.code,
      codeVerifier: state.verifier,
    });

    const credential = slackCredentialStore.saveOAuth({
      userId: state.userId,
      accessToken: tokenSet.accessToken,
      refreshToken: tokenSet.refreshToken,
      scopes: parseScopes(tokenSet.scope),
      teamId: tokenSet.teamId,
      teamName: tokenSet.teamName,
      metadata: tokenSet.expiresAt ? { expiresAt: tokenSet.expiresAt } : undefined,
    });

    logSlack({
      event: "connect",
      level: "info",
      connector: "slack",
      userId: state.userId,
      teamId: tokenSet.teamId,
      message: "Slack OAuth connection completed",
      metadata: { authMethod: "oauth2_pkce" },
    });

    return credential;
  }

  async connectApiKey(params: {
    userId: string;
    botToken: string;
  }): Promise<SlackCredentialPublic> {
    const client = new SlackClient(params.botToken);
    const auth = await client.authTest();

    const credential = slackCredentialStore.saveApiKey({
      userId: params.userId,
      botToken: params.botToken,
      teamId: auth.teamId,
      teamName: auth.teamName,
      metadata: auth.botUserId ? { botUserId: auth.botUserId } : undefined,
    });

    logSlack({
      event: "connect",
      level: "info",
      connector: "slack",
      userId: params.userId,
      teamId: auth.teamId,
      message: "Slack API-key connection completed",
      metadata: { authMethod: "api_key" },
    });

    return credential;
  }

  async listConnections(userId: string): Promise<SlackCredentialPublic[]> {
    return slackCredentialStore.getPublicByUserAsync(userId);
  }

  async testConnection(userId: string): Promise<{ teamId: string; teamName?: string }> {
    const credential = await this.ensureValidCredential(userId);
    const token = slackCredentialStore.decryptAccessToken(credential);
    const client = new SlackClient(token);

    const auth = await client.authTest();
    logSlack({
      event: "sync",
      level: "info",
      connector: "slack",
      userId,
      teamId: auth.teamId,
      message: "Slack test connection succeeded",
    });

    return { teamId: auth.teamId, teamName: auth.teamName };
  }

  async health(userId: string): Promise<SlackConnectionHealth> {
    const checkedAt = new Date().toISOString();
    const credential = await slackCredentialStore.getActiveByUserAsync(userId);

    if (!credential) {
      return {
        status: "down",
        checkedAt,
        details: {
          auth: false,
          apiReachable: false,
          rateLimited: false,
          errorType: "auth",
          message: "No Slack credential is connected",
        },
      };
    }

    try {
      const token = slackCredentialStore.decryptAccessToken(credential);
      const client = new SlackClient(token);
      await client.authTest();

      const health: SlackConnectionHealth = {
        status: "ok",
        checkedAt,
        teamId: credential.teamId,
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

      logSlack({
        event: "health",
        level: "info",
        connector: "slack",
        userId,
        teamId: credential.teamId,
        message: "Slack health check passed",
      });

      return health;
    } catch (error) {
      const connectorError = error instanceof ConnectorError
        ? error
        : new ConnectorError("upstream", error instanceof Error ? error.message : String(error), 502);

      logSlack({
        event: "error",
        level: "error",
        connector: "slack",
        userId,
        teamId: credential.teamId,
        message: connectorError.message,
        errorType: connectorError.type,
      });

      return {
        status: connectorError.type === "rate-limit" ? "degraded" : "down",
        checkedAt,
        teamId: credential.teamId,
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

  async disconnect(userId: string, credentialId: string): Promise<boolean> {
    const revoked = await slackCredentialStore.revokeAsync(credentialId, userId);

    if (revoked) {
      logSlack({
        event: "disconnect",
        level: "info",
        connector: "slack",
        userId,
        message: "Slack credential revoked",
        metadata: { credentialId },
      });
    }

    return revoked;
  }

  async listChannels(userId: string): Promise<Array<{ id: string; name: string; isPrivate: boolean }>> {
    const credential = await this.ensureValidCredential(userId);
    const client = new SlackClient(slackCredentialStore.decryptAccessToken(credential));
    return client.listConversations();
  }

  async listChannelMessages(
    userId: string,
    channel: string
  ): Promise<Array<{ ts: string; text: string; user?: string }>> {
    const credential = await this.ensureValidCredential(userId);
    const client = new SlackClient(slackCredentialStore.decryptAccessToken(credential));
    return client.listChannelMessages(channel);
  }

  private async ensureValidCredential(userId: string): Promise<SlackCredential> {
    let credential = await slackCredentialStore.getActiveByUserAsync(userId);
    if (!credential) {
      throw new ConnectorError("auth", "Slack connector is not configured", 404);
    }

    if (credential.authMethod === "oauth2_pkce" && credential.refreshTokenEncrypted) {
      const expiresAt = credential.metadata?.expiresAt;
      if (expiresAt && Date.now() >= Date.parse(expiresAt) - 60_000) {
        try {
          const refreshToken = slackCredentialStore.decryptRefreshToken(credential);
          if (!refreshToken) {
            throw new ConnectorError("auth", "Missing refresh token", 401);
          }

          const refreshed = await refreshAccessToken(refreshToken);
          slackCredentialStore.rotateToken({
            credentialId: credential.id,
            accessToken: refreshed.accessToken,
            refreshToken: refreshed.refreshToken,
            scopes: parseScopes(refreshed.scope),
            expiresAt: refreshed.expiresAt,
          });

          credential = (await slackCredentialStore.getActiveByUserAsync(userId)) ?? credential;
        } catch (error) {
          logSlack({
            event: "error",
            level: "error",
            connector: "slack",
            userId,
            teamId: credential.teamId,
            message: `Slack token refresh failed: ${error instanceof Error ? error.message : String(error)}`,
            errorType: "auth",
          });
          throw new ConnectorError("auth", "Slack token refresh failed", 401);
        }
      }
    }

    return credential;
  }
}

export const slackConnectorService = new SlackConnectorService();
