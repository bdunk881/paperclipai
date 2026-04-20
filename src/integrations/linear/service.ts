import { linearCredentialStore } from "./credentialStore";
import { LinearClient } from "./linearClient";
import { logLinear } from "./logger";
import {
  buildLinearOAuthUrl,
  exchangeCodeForTokens,
  parseLinearScopes,
  refreshAccessToken,
} from "./oauth";
import { consumePkceState, createPkceState } from "./pkceStore";
import { ConnectorError, LinearConnectionHealth, LinearCredentialPublic } from "./types";
import { runOAuthTokenRefreshMiddleware } from "../shared/tokenRefreshMiddleware";

export class LinearConnectorService {
  beginOAuth(userId: string): {
    authUrl: string;
    state: string;
    codeVerifier: string;
    expiresInSeconds: number;
  } {
    const pkce = createPkceState(userId);
    const authUrl = buildLinearOAuthUrl({
      state: pkce.state,
      codeChallenge: pkce.challenge,
    });

    logLinear({
      event: "connect",
      level: "info",
      connector: "linear",
      userId,
      message: "Linear OAuth flow initialized",
      metadata: { authMethod: "oauth2_pkce" },
    });

    return {
      authUrl,
      state: pkce.state,
      codeVerifier: pkce.verifier,
      expiresInSeconds: pkce.expiresInSeconds,
    };
  }

  async completeOAuth(params: { code: string; state: string }): Promise<LinearCredentialPublic> {
    const state = consumePkceState(params.state);
    if (!state) {
      throw new ConnectorError("auth", "OAuth state is invalid or expired", 401);
    }

    const tokenSet = await exchangeCodeForTokens({
      code: params.code,
      codeVerifier: state.verifier,
    });

    const credential = linearCredentialStore.saveOAuth({
      userId: state.userId,
      accessToken: tokenSet.accessToken,
      refreshToken: tokenSet.refreshToken,
      scopes: parseLinearScopes(tokenSet.scope),
      organizationId: tokenSet.organizationId,
      organizationName: tokenSet.organizationName,
      metadata: tokenSet.expiresAt ? { expiresAt: tokenSet.expiresAt } : undefined,
    });

    logLinear({
      event: "connect",
      level: "info",
      connector: "linear",
      userId: state.userId,
      organizationId: tokenSet.organizationId,
      message: "Linear OAuth connection completed",
      metadata: { authMethod: "oauth2_pkce" },
    });

    return credential;
  }

  async connectApiKey(params: { userId: string; apiKey: string }): Promise<LinearCredentialPublic> {
    const client = new LinearClient(params.apiKey);
    const viewer = await client.viewer();

    const credential = linearCredentialStore.saveApiKey({
      userId: params.userId,
      apiKey: params.apiKey,
      organizationId: viewer.organizationId,
      organizationName: viewer.organizationName,
      metadata: { viewerId: viewer.viewerId },
    });

    logLinear({
      event: "connect",
      level: "info",
      connector: "linear",
      userId: params.userId,
      organizationId: viewer.organizationId,
      message: "Linear API-key fallback connection completed",
      metadata: { authMethod: "api_key" },
    });

    return credential;
  }

  listConnections(userId: string): LinearCredentialPublic[] {
    return linearCredentialStore.getPublicByUser(userId);
  }

  async testConnection(userId: string): Promise<{ organizationId: string; organizationName?: string }> {
    const credential = await this.ensureValidCredential(userId);
    const token = linearCredentialStore.decryptAccessToken(credential);
    const client = new LinearClient(token);
    const viewer = await client.viewer();

    logLinear({
      event: "sync",
      level: "info",
      connector: "linear",
      userId,
      organizationId: viewer.organizationId,
      message: "Linear test connection succeeded",
    });

    return {
      organizationId: viewer.organizationId,
      organizationName: viewer.organizationName,
    };
  }

  async health(userId: string): Promise<LinearConnectionHealth> {
    const checkedAt = new Date().toISOString();
    const credential = linearCredentialStore.getActiveByUser(userId);

    if (!credential) {
      return {
        status: "down",
        checkedAt,
        details: {
          auth: false,
          apiReachable: false,
          rateLimited: false,
          errorType: "auth",
          message: "No Linear credential is connected",
        },
      };
    }

    try {
      const token = linearCredentialStore.decryptAccessToken(credential);
      const client = new LinearClient(token);
      await client.viewer();

      const health: LinearConnectionHealth = {
        status: "ok",
        checkedAt,
        organizationId: credential.organizationId,
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

      logLinear({
        event: "health",
        level: "info",
        connector: "linear",
        userId,
        organizationId: credential.organizationId,
        message: "Linear health check passed",
      });

      return health;
    } catch (error) {
      const connectorError = error instanceof ConnectorError
        ? error
        : new ConnectorError("upstream", error instanceof Error ? error.message : String(error), 502);

      logLinear({
        event: "error",
        level: "error",
        connector: "linear",
        userId,
        organizationId: credential.organizationId,
        message: connectorError.message,
        errorType: connectorError.type,
      });

      return {
        status: connectorError.type === "rate-limit" ? "degraded" : "down",
        checkedAt,
        organizationId: credential.organizationId,
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
    const revoked = linearCredentialStore.revoke(credentialId, userId);

    if (revoked) {
      logLinear({
        event: "disconnect",
        level: "info",
        connector: "linear",
        userId,
        message: "Linear credential revoked",
        metadata: { credentialId },
      });
    }

    return revoked;
  }

  async listProjects(userId: string): Promise<Array<{ id: string; name: string; state?: string }>> {
    const credential = await this.ensureValidCredential(userId);
    const client = new LinearClient(linearCredentialStore.decryptAccessToken(credential));
    return client.listProjects();
  }

  async listIssues(userId: string): Promise<Array<{ id: string; identifier: string; title: string; state?: string }>> {
    const credential = await this.ensureValidCredential(userId);
    const client = new LinearClient(linearCredentialStore.decryptAccessToken(credential));
    return client.listIssues();
  }

  async createIssue(userId: string, input: {
    title: string;
    description?: string;
    teamId?: string;
    projectId?: string;
  }): Promise<{ id: string; identifier: string; title: string }> {
    const credential = await this.ensureValidCredential(userId);
    const client = new LinearClient(linearCredentialStore.decryptAccessToken(credential));
    return client.createIssue(input);
  }

  async updateIssue(userId: string, issueId: string, input: {
    title?: string;
    description?: string;
    stateId?: string;
    projectId?: string;
  }): Promise<{ id: string; identifier: string; title: string }> {
    const credential = await this.ensureValidCredential(userId);
    const client = new LinearClient(linearCredentialStore.decryptAccessToken(credential));
    return client.updateIssue(issueId, input);
  }

  private async ensureValidCredential(userId: string) {
    const credential = linearCredentialStore.getActiveByUser(userId);
    if (!credential) {
      throw new ConnectorError("auth", "Linear connector is not configured", 404);
    }

    const refreshed = await runOAuthTokenRefreshMiddleware({
      shouldAttemptRefresh: credential.authMethod === "oauth2_pkce" && Boolean(credential.refreshTokenEncrypted),
      expiresAt: credential.metadata?.expiresAt,
      getRefreshToken: () => linearCredentialStore.decryptRefreshToken(credential),
      refreshAccessToken,
      persistRefreshedToken: (tokenSet) => {
        linearCredentialStore.rotateToken({
          credentialId: credential.id,
          accessToken: tokenSet.accessToken,
          refreshToken: tokenSet.refreshToken,
          scopes: parseLinearScopes(tokenSet.scope),
          expiresAt: tokenSet.expiresAt,
        });
      },
      onRefreshFailure: (error) => {
        logLinear({
          event: "error",
          level: "error",
          connector: "linear",
          userId,
          organizationId: credential.organizationId,
          message: `Linear token refresh failed: ${error instanceof Error ? error.message : String(error)}`,
          errorType: "auth",
        });
      },
      isKnownError: (error) => error instanceof ConnectorError,
      createAuthError: (message, statusCode) => new ConnectorError("auth", message, statusCode),
      refreshFailedMessage: "Linear token refresh failed",
    });

    if (refreshed) {
      const updatedCredential = linearCredentialStore.getActiveByUser(userId);
      if (!updatedCredential) {
        throw new ConnectorError("auth", "Credential missing after token refresh", 404);
      }
      return updatedCredential;
    }

    return credential;
  }
}

export const linearConnectorService = new LinearConnectorService();
