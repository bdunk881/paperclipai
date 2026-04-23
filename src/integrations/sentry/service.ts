import { sentryCredentialStore } from "./credentialStore";
import { logSentry } from "./logger";
import { exchangeCodeForTokens, parseSentryScopes, refreshAccessToken, buildSentryOAuthUrl } from "./oauth";
import { consumePkceState, createPkceState } from "./pkceStore";
import { SentryClient } from "./sentryClient";
import {
  ConnectorError,
  SentryConnectionHealth,
  SentryCredential,
  SentryCredentialPublic,
  SentryIssue,
  SentryProject,
} from "./types";

function shouldRefreshCredential(credential: SentryCredential): boolean {
  if (credential.authMethod !== "oauth2_pkce") {
    return false;
  }

  const expiresAt = credential.metadata?.expiresAt;
  if (!expiresAt) {
    return false;
  }

  const expiresAtMs = Date.parse(expiresAt);
  return Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now() + 60_000;
}

export class SentryConnectorService {
  beginOAuth(userId: string): {
    authUrl: string;
    state: string;
    codeVerifier: string;
    expiresInSeconds: number;
  } {
    const pkce = createPkceState(userId);
    const authUrl = buildSentryOAuthUrl({
      state: pkce.state,
      codeChallenge: pkce.challenge,
    });

    logSentry({
      event: "connect",
      level: "info",
      connector: "sentry",
      userId,
      message: "Sentry OAuth flow initialized",
      metadata: { authMethod: "oauth2_pkce" },
    });

    return {
      authUrl,
      state: pkce.state,
      codeVerifier: pkce.verifier,
      expiresInSeconds: pkce.expiresInSeconds,
    };
  }

  async completeOAuth(params: { code: string; state: string }): Promise<SentryCredentialPublic> {
    const state = consumePkceState(params.state);
    if (!state) {
      throw new ConnectorError("auth", "OAuth state is invalid or expired", 401);
    }

    const tokenSet = await exchangeCodeForTokens({
      code: params.code,
      codeVerifier: state.verifier,
    });

    const credential = sentryCredentialStore.saveOAuth({
      userId: state.userId,
      accessToken: tokenSet.accessToken,
      refreshToken: tokenSet.refreshToken,
      scopes: parseSentryScopes(tokenSet.scope),
      organizationId: tokenSet.organizationId,
      organizationSlug: tokenSet.organizationSlug,
      organizationName: tokenSet.organizationName,
      metadata: tokenSet.expiresAt ? { expiresAt: tokenSet.expiresAt } : undefined,
    });

    logSentry({
      event: "connect",
      level: "info",
      connector: "sentry",
      userId: state.userId,
      organizationId: tokenSet.organizationId,
      organizationSlug: tokenSet.organizationSlug,
      message: "Sentry OAuth connection completed",
      metadata: { authMethod: "oauth2_pkce" },
    });

    return credential;
  }

  async connectApiKey(params: { userId: string; apiKey: string }): Promise<SentryCredentialPublic> {
    const client = new SentryClient(params.apiKey, "api_key");
    const viewer = await client.viewer();

    const credential = sentryCredentialStore.saveApiKey({
      userId: params.userId,
      apiKey: params.apiKey,
      organizationId: viewer.organizationId,
      organizationSlug: viewer.organizationSlug,
      organizationName: viewer.organizationName,
    });

    logSentry({
      event: "connect",
      level: "info",
      connector: "sentry",
      userId: params.userId,
      organizationId: viewer.organizationId,
      organizationSlug: viewer.organizationSlug,
      message: "Sentry API-key fallback connection completed",
      metadata: { authMethod: "api_key" },
    });

    return credential;
  }

  async listConnections(userId: string): Promise<SentryCredentialPublic[]> {
    return sentryCredentialStore.getPublicByUserAsync(userId);
  }

  async testConnection(userId: string): Promise<{
    organizationId: string;
    organizationSlug: string;
    organizationName?: string;
  }> {
    const credential = await this.ensureValidCredential(userId);
    const client = new SentryClient(
      sentryCredentialStore.decryptAccessToken(credential),
      credential.authMethod
    );
    const viewer = await client.viewer();

    logSentry({
      event: "sync",
      level: "info",
      connector: "sentry",
      userId,
      organizationId: viewer.organizationId,
      organizationSlug: viewer.organizationSlug,
      message: "Sentry test connection succeeded",
    });

    return viewer;
  }

  async health(userId: string): Promise<SentryConnectionHealth> {
    const checkedAt = new Date().toISOString();
    const credential = await sentryCredentialStore.getActiveByUserAsync(userId);

    if (!credential) {
      return {
        status: "down",
        checkedAt,
        details: {
          auth: false,
          apiReachable: false,
          rateLimited: false,
          errorType: "auth",
          message: "No Sentry credential is connected",
        },
      };
    }

    try {
      const client = new SentryClient(
        sentryCredentialStore.decryptAccessToken(credential),
        credential.authMethod
      );
      await client.viewer();

      const health: SentryConnectionHealth = {
        status: "ok",
        checkedAt,
        organizationId: credential.organizationId,
        organizationSlug: credential.organizationSlug,
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

      logSentry({
        event: "health",
        level: "info",
        connector: "sentry",
        userId,
        organizationId: credential.organizationId,
        organizationSlug: credential.organizationSlug,
        message: "Sentry health check passed",
      });

      return health;
    } catch (error) {
      const connectorError = error instanceof ConnectorError
        ? error
        : new ConnectorError("upstream", error instanceof Error ? error.message : String(error), 502);

      logSentry({
        event: "error",
        level: "error",
        connector: "sentry",
        userId,
        organizationId: credential.organizationId,
        organizationSlug: credential.organizationSlug,
        message: connectorError.message,
        errorType: connectorError.type,
      });

      return {
        status: connectorError.type === "rate-limit" ? "degraded" : "down",
        checkedAt,
        organizationId: credential.organizationId,
        organizationSlug: credential.organizationSlug,
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
    const revoked = await sentryCredentialStore.revokeAsync(credentialId, userId);

    if (revoked) {
      logSentry({
        event: "disconnect",
        level: "info",
        connector: "sentry",
        userId,
        message: "Sentry credential revoked",
        metadata: { credentialId },
      });
    }

    return revoked;
  }

  async listProjects(userId: string): Promise<SentryProject[]> {
    const credential = await this.ensureValidCredential(userId);
    const client = new SentryClient(
      sentryCredentialStore.decryptAccessToken(credential),
      credential.authMethod
    );
    const projects = await client.listProjects(credential.organizationSlug);

    logSentry({
      event: "sync",
      level: "info",
      connector: "sentry",
      userId,
      organizationId: credential.organizationId,
      organizationSlug: credential.organizationSlug,
      message: "Sentry projects synced",
      metadata: { total: projects.length },
    });

    return projects;
  }

  async listIssues(userId: string, params?: {
    projectSlug?: string;
    query?: string;
    limit?: number;
  }): Promise<SentryIssue[]> {
    const credential = await this.ensureValidCredential(userId);
    const client = new SentryClient(
      sentryCredentialStore.decryptAccessToken(credential),
      credential.authMethod
    );
    const issues = await client.listIssues({
      organizationSlug: credential.organizationSlug,
      projectSlug: params?.projectSlug,
      query: params?.query,
      limit: params?.limit,
    });

    logSentry({
      event: "sync",
      level: "info",
      connector: "sentry",
      userId,
      organizationId: credential.organizationId,
      organizationSlug: credential.organizationSlug,
      message: "Sentry issues synced",
      metadata: {
        total: issues.length,
        projectSlug: params?.projectSlug,
      },
    });

    return issues;
  }

  private async ensureValidCredential(userId: string): Promise<SentryCredential> {
    const credential = await sentryCredentialStore.getActiveByUserAsync(userId);
    if (!credential) {
      throw new ConnectorError("auth", "No active Sentry credential found", 404);
    }

    if (!shouldRefreshCredential(credential)) {
      return credential;
    }

    const refreshToken = sentryCredentialStore.decryptRefreshToken(credential);
    if (!refreshToken) {
      throw new ConnectorError("auth", "Sentry OAuth credential is missing a refresh token", 401);
    }

    const refreshed = await refreshAccessToken(refreshToken);
    sentryCredentialStore.rotateToken({
      credentialId: credential.id,
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      scopes: parseSentryScopes(refreshed.scope),
      expiresAt: refreshed.expiresAt,
    });

    return (await sentryCredentialStore.getActiveByUserAsync(userId)) ?? credential;
  }
}

export const sentryConnectorService = new SentryConnectorService();
