import { apolloCredentialStore } from "./credentialStore";
import { ApolloClient } from "./apolloClient";
import { logApollo } from "./logger";
import { buildApolloOAuthUrl, exchangeCodeForTokens, parseApolloScopes, refreshAccessToken } from "./oauth";
import { consumeOAuthState, createOAuthState } from "./oauthStateStore";
import { buildTier1ConnectionHealth } from "../shared/tier1Contract";
import { ApolloConnectionHealth, ApolloCredential, ApolloCredentialPublic, ConnectorError } from "./types";

export class ApolloConnectorService {
  beginOAuth(userId: string): {
    authUrl: string;
    state: string;
    expiresInSeconds: number;
  } {
    const state = createOAuthState(userId);
    const authUrl = buildApolloOAuthUrl({ state: state.state });

    logApollo({
      event: "connect",
      level: "info",
      connector: "apollo",
      userId,
      message: "Apollo OAuth flow initialized",
      metadata: { authMethod: "oauth2" },
    });

    return {
      authUrl,
      state: state.state,
      expiresInSeconds: state.expiresInSeconds,
    };
  }

  async completeOAuth(params: { code: string; state: string }): Promise<ApolloCredentialPublic> {
    const state = consumeOAuthState(params.state);
    if (!state) {
      throw new ConnectorError("auth", "OAuth state is invalid or expired", 401);
    }

    const tokenSet = await exchangeCodeForTokens({ code: params.code });
    const credential = apolloCredentialStore.saveOAuth({
      userId: state.userId,
      accessToken: tokenSet.accessToken,
      refreshToken: tokenSet.refreshToken,
      scopes: parseApolloScopes(tokenSet.scope),
      accountId: tokenSet.accountId,
      accountLabel: tokenSet.accountLabel,
      metadata: tokenSet.expiresAt ? { expiresAt: tokenSet.expiresAt } : undefined,
    });

    logApollo({
      event: "connect",
      level: "info",
      connector: "apollo",
      userId: state.userId,
      accountId: tokenSet.accountId,
      message: "Apollo OAuth connection completed",
      metadata: { authMethod: "oauth2" },
    });

    return credential;
  }

  async connectApiKey(params: { userId: string; apiKey: string }): Promise<ApolloCredentialPublic> {
    const client = new ApolloClient(params.apiKey, "api_key");
    const viewer = await client.viewer();

    const credential = apolloCredentialStore.saveApiKey({
      userId: params.userId,
      apiKey: params.apiKey,
      accountId: viewer.accountId,
      accountLabel: viewer.accountLabel,
    });

    logApollo({
      event: "connect",
      level: "info",
      connector: "apollo",
      userId: params.userId,
      accountId: viewer.accountId,
      message: "Apollo API-key connection completed",
      metadata: { authMethod: "api_key" },
    });

    return credential;
  }

  async listConnections(userId: string): Promise<ApolloCredentialPublic[]> {
    return apolloCredentialStore.getPublicByUserAsync(userId);
  }

  async testConnection(userId: string): Promise<{ accountId: string; accountLabel?: string }> {
    const credential = await this.ensureValidCredential(userId);
    const token = apolloCredentialStore.decryptAccessToken(credential);
    const client = new ApolloClient(token, credential.authMethod);
    const viewer = await client.viewer();

    logApollo({
      event: "sync",
      level: "info",
      connector: "apollo",
      userId,
      accountId: viewer.accountId,
      message: "Apollo test connection succeeded",
    });

    return viewer;
  }

  async health(userId: string): Promise<ApolloConnectionHealth> {
    const checkedAt = new Date().toISOString();
    const credential = await apolloCredentialStore.getActiveByUserAsync(userId);

    if (!credential) {
      return buildTier1ConnectionHealth({
        connector: "apollo",
        subject: userId,
        checkedAt,
        status: "disabled",
        recommendedNextAction: "Connect an Apollo credential from the dashboard to enable prospecting workflows.",
        details: {
          auth: false,
          apiReachable: false,
          rateLimited: false,
          errorType: "auth",
          message: "No Apollo credential is connected",
        },
      });
    }

    try {
      const token = apolloCredentialStore.decryptAccessToken(credential);
      const client = new ApolloClient(token, credential.authMethod);
      await client.viewer();

      const health: ApolloConnectionHealth = buildTier1ConnectionHealth({
        connector: "apollo",
        subject: userId,
        checkedAt,
        authMethod: credential.authMethod,
        tokenRefreshStatus:
          credential.authMethod === "oauth2"
            ? credential.refreshTokenEncrypted
              ? "healthy"
              : "failed"
            : "not_applicable",
        metadata: {
          accountId: credential.accountId,
        },
        details: {
          auth: true,
          apiReachable: true,
          rateLimited: false,
        },
      });

      logApollo({
        event: "health",
        level: "info",
        connector: "apollo",
        userId,
        accountId: credential.accountId,
        message: "Apollo health check passed",
      });

      return health;
    } catch (error) {
      const connectorError = error instanceof ConnectorError
        ? error
        : new ConnectorError("upstream", error instanceof Error ? error.message : String(error), 502);

      logApollo({
        event: "error",
        level: "error",
        connector: "apollo",
        userId,
        accountId: credential.accountId,
        message: connectorError.message,
        errorType: connectorError.type,
      });

      return buildTier1ConnectionHealth({
        connector: "apollo",
        subject: userId,
        checkedAt,
        authMethod: credential.authMethod,
        tokenRefreshStatus:
          credential.authMethod === "oauth2"
            ? connectorError.type === "auth"
              ? "failed"
              : "healthy"
            : "not_applicable",
        metadata: {
          accountId: credential.accountId,
        },
        details: {
          auth: connectorError.type !== "auth",
          apiReachable: connectorError.type !== "network",
          rateLimited: connectorError.type === "rate-limit",
          errorType: connectorError.type,
          message: connectorError.message,
        },
      });
    }
  }

  async disconnect(userId: string, credentialId: string): Promise<boolean> {
    const revoked = await apolloCredentialStore.revokeAsync(credentialId, userId);

    if (revoked) {
      logApollo({
        event: "disconnect",
        level: "info",
        connector: "apollo",
        userId,
        message: "Apollo credential revoked",
        metadata: { credentialId },
      });
    }

    return revoked;
  }

  private async ensureValidCredential(userId: string): Promise<ApolloCredential> {
    let credential = await apolloCredentialStore.getActiveByUserAsync(userId);
    if (!credential) {
      throw new ConnectorError("auth", "Apollo connector is not configured", 404);
    }

    if (credential.authMethod === "oauth2" && credential.refreshTokenEncrypted) {
      const expiresAt = credential.metadata?.expiresAt;
      if (expiresAt && Date.now() >= Date.parse(expiresAt) - 60_000) {
        try {
          const refreshToken = apolloCredentialStore.decryptRefreshToken(credential);
          if (!refreshToken) {
            throw new ConnectorError("auth", "Missing refresh token", 401);
          }

          const refreshed = await refreshAccessToken(refreshToken);
          apolloCredentialStore.rotateToken({
            credentialId: credential.id,
            accessToken: refreshed.accessToken,
            refreshToken: refreshed.refreshToken,
            scopes: parseApolloScopes(refreshed.scope),
            expiresAt: refreshed.expiresAt,
          });

          credential = (await apolloCredentialStore.getActiveByUserAsync(userId)) ?? credential;
        } catch (error) {
          logApollo({
            event: "error",
            level: "error",
            connector: "apollo",
            userId,
            accountId: credential.accountId,
            message: `Apollo token refresh failed: ${error instanceof Error ? error.message : String(error)}`,
            errorType: "auth",
          });
          throw new ConnectorError("auth", "Apollo token refresh failed", 401);
        }
      }
    }

    return credential;
  }
}

export const apolloConnectorService = new ApolloConnectorService();
