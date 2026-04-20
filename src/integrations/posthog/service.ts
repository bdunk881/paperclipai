import { posthogCredentialStore } from "./credentialStore";
import { PostHogClient } from "./posthogClient";
import { logPostHog } from "./logger";
import {
  buildPostHogOAuthUrl,
  exchangeCodeForTokens,
  parsePostHogScopes,
  refreshAccessToken,
} from "./oauth";
import { consumePkceState, createPkceState } from "./pkceStore";
import { ConnectorError, PostHogConnectionHealth, PostHogCredentialPublic } from "./types";
import { runOAuthTokenRefreshMiddleware } from "../shared/tokenRefreshMiddleware";

export class PostHogConnectorService {
  beginOAuth(userId: string): {
    authUrl: string;
    state: string;
    codeVerifier: string;
    expiresInSeconds: number;
  } {
    const pkce = createPkceState(userId);
    const authUrl = buildPostHogOAuthUrl({
      state: pkce.state,
      codeChallenge: pkce.challenge,
    });

    logPostHog({
      event: "connect",
      level: "info",
      connector: "posthog",
      userId,
      message: "PostHog OAuth flow initialized",
      metadata: { authMethod: "oauth2_pkce" },
    });

    return {
      authUrl,
      state: pkce.state,
      codeVerifier: pkce.verifier,
      expiresInSeconds: pkce.expiresInSeconds,
    };
  }

  async completeOAuth(params: { code: string; state: string }): Promise<PostHogCredentialPublic> {
    const state = consumePkceState(params.state);
    if (!state) {
      throw new ConnectorError("auth", "OAuth state is invalid or expired", 401);
    }

    const tokenSet = await exchangeCodeForTokens({
      code: params.code,
      codeVerifier: state.verifier,
    });

    const credential = posthogCredentialStore.saveOAuth({
      userId: state.userId,
      accessToken: tokenSet.accessToken,
      refreshToken: tokenSet.refreshToken,
      scopes: parsePostHogScopes(tokenSet.scope),
      organizationId: tokenSet.organizationId,
      organizationName: tokenSet.organizationName,
      metadata: tokenSet.expiresAt ? { expiresAt: tokenSet.expiresAt } : undefined,
    });

    logPostHog({
      event: "connect",
      level: "info",
      connector: "posthog",
      userId: state.userId,
      organizationId: tokenSet.organizationId,
      message: "PostHog OAuth connection completed",
      metadata: { authMethod: "oauth2_pkce" },
    });

    return credential;
  }

  async connectApiKey(params: { userId: string; apiKey: string }): Promise<PostHogCredentialPublic> {
    const client = new PostHogClient(params.apiKey);
    const viewer = await client.viewer();

    const credential = posthogCredentialStore.saveApiKey({
      userId: params.userId,
      apiKey: params.apiKey,
      organizationId: viewer.organizationId,
      organizationName: viewer.organizationName,
      metadata: { viewerId: viewer.viewerId },
    });

    logPostHog({
      event: "connect",
      level: "info",
      connector: "posthog",
      userId: params.userId,
      organizationId: viewer.organizationId,
      message: "PostHog API-key fallback connection completed",
      metadata: { authMethod: "api_key" },
    });

    return credential;
  }

  listConnections(userId: string): PostHogCredentialPublic[] {
    return posthogCredentialStore.getPublicByUser(userId);
  }

  async testConnection(userId: string): Promise<{ organizationId: string; organizationName?: string }> {
    const credential = await this.ensureValidCredential(userId);
    const token = posthogCredentialStore.decryptAccessToken(credential);
    const client = new PostHogClient(token);
    const viewer = await client.viewer();

    logPostHog({
      event: "sync",
      level: "info",
      connector: "posthog",
      userId,
      organizationId: viewer.organizationId,
      message: "PostHog test connection succeeded",
    });

    return {
      organizationId: viewer.organizationId,
      organizationName: viewer.organizationName,
    };
  }

  async health(userId: string): Promise<PostHogConnectionHealth> {
    const checkedAt = new Date().toISOString();
    const credential = posthogCredentialStore.getActiveByUser(userId);

    if (!credential) {
      return {
        status: "down",
        checkedAt,
        details: {
          auth: false,
          apiReachable: false,
          rateLimited: false,
          errorType: "auth",
          message: "No PostHog credential is connected",
        },
      };
    }

    try {
      const token = posthogCredentialStore.decryptAccessToken(credential);
      const client = new PostHogClient(token);
      await client.viewer();

      const health: PostHogConnectionHealth = {
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

      logPostHog({
        event: "health",
        level: "info",
        connector: "posthog",
        userId,
        organizationId: credential.organizationId,
        message: "PostHog health check passed",
      });

      return health;
    } catch (error) {
      const connectorError = error instanceof ConnectorError
        ? error
        : new ConnectorError("upstream", error instanceof Error ? error.message : String(error), 502);

      logPostHog({
        event: "error",
        level: "error",
        connector: "posthog",
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
    const revoked = posthogCredentialStore.revoke(credentialId, userId);

    if (revoked) {
      logPostHog({
        event: "disconnect",
        level: "info",
        connector: "posthog",
        userId,
        message: "PostHog credential revoked",
        metadata: { credentialId },
      });
    }

    return revoked;
  }

  async listProjects(userId: string): Promise<Array<{
    id: string;
    name: string;
    organizationId?: string;
    organizationName?: string;
  }>> {
    const credential = await this.ensureValidCredential(userId);
    const client = new PostHogClient(posthogCredentialStore.decryptAccessToken(credential));
    const projects = await client.listProjects();

    logPostHog({
      event: "sync",
      level: "info",
      connector: "posthog",
      userId,
      organizationId: credential.organizationId,
      message: "PostHog projects synced",
      metadata: { total: projects.length },
    });

    return projects;
  }

  async listFeatureFlags(userId: string, projectId?: string): Promise<Array<{
    id: string;
    key: string;
    name?: string;
    active: boolean;
  }>> {
    const credential = await this.ensureValidCredential(userId);
    const resolvedProjectId = projectId?.trim() || credential.organizationId;
    if (!resolvedProjectId) {
      throw new ConnectorError("schema", "projectId is required when no default PostHog project is connected", 400);
    }

    const client = new PostHogClient(posthogCredentialStore.decryptAccessToken(credential));
    const flags = await client.listFeatureFlags(resolvedProjectId);

    logPostHog({
      event: "sync",
      level: "info",
      connector: "posthog",
      userId,
      organizationId: resolvedProjectId,
      message: "PostHog feature flags synced",
      metadata: { total: flags.length },
    });

    return flags;
  }

  async captureEvent(userId: string, input: {
    event: string;
    distinctId: string;
    properties?: Record<string, unknown>;
    projectApiKey?: string;
    timestamp?: string;
  }): Promise<{ accepted: boolean; status?: number | string }> {
    const credential = await this.ensureValidCredential(userId);
    const client = new PostHogClient(posthogCredentialStore.decryptAccessToken(credential));
    const result = await client.captureEvent(input);

    logPostHog({
      event: "sync",
      level: "info",
      connector: "posthog",
      userId,
      organizationId: credential.organizationId,
      message: "PostHog event captured",
      metadata: {
        eventName: input.event,
        distinctId: input.distinctId,
      },
    });

    return result;
  }

  private async ensureValidCredential(userId: string) {
    const credential = posthogCredentialStore.getActiveByUser(userId);
    if (!credential) {
      throw new ConnectorError("auth", "PostHog connector is not configured", 404);
    }

    const refreshed = await runOAuthTokenRefreshMiddleware({
      shouldAttemptRefresh: credential.authMethod === "oauth2_pkce" && Boolean(credential.refreshTokenEncrypted),
      expiresAt: credential.metadata?.expiresAt,
      getRefreshToken: () => posthogCredentialStore.decryptRefreshToken(credential),
      refreshAccessToken,
      persistRefreshedToken: (tokenSet) => {
        posthogCredentialStore.rotateToken({
          credentialId: credential.id,
          accessToken: tokenSet.accessToken,
          refreshToken: tokenSet.refreshToken,
          scopes: parsePostHogScopes(tokenSet.scope),
          expiresAt: tokenSet.expiresAt,
        });
      },
      onRefreshFailure: (error) => {
        logPostHog({
          event: "error",
          level: "error",
          connector: "posthog",
          userId,
          organizationId: credential.organizationId,
          message: `PostHog token refresh failed: ${error instanceof Error ? error.message : String(error)}`,
          errorType: "auth",
        });
      },
      isKnownError: (error) => error instanceof ConnectorError,
      createAuthError: (message, statusCode) => new ConnectorError("auth", message, statusCode),
      refreshFailedMessage: "PostHog token refresh failed",
    });

    if (refreshed) {
      const updatedCredential = posthogCredentialStore.getActiveByUser(userId);
      if (!updatedCredential) {
        throw new ConnectorError("auth", "Credential missing after token refresh", 404);
      }
      return updatedCredential;
    }

    return credential;
  }
}

export const posthogConnectorService = new PostHogConnectorService();
