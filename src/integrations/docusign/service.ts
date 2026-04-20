import { docuSignCredentialStore } from "./credentialStore";
import { DocuSignClient } from "./docusignClient";
import { logDocuSign } from "./logger";
import {
  buildDocuSignOAuthUrl,
  exchangeCodeForTokens,
  parseScopeSet,
  refreshAccessToken,
} from "./oauth";
import { consumePkceState, createPkceState } from "./pkceStore";
import { ConnectorError, DocuSignConnectionHealth, DocuSignCredentialPublic } from "./types";
import { runOAuthTokenRefreshMiddleware } from "../shared/tokenRefreshMiddleware";

function requiredScopes(): string[] {
  return (process.env.DOCUSIGN_SCOPES ?? "signature extended offline_access")
    .split(/[\s,]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function hasMissingRequiredScopes(scopes: string[]): string[] {
  const available = new Set(scopes);
  return requiredScopes().filter((scope) => !available.has(scope));
}

export class DocuSignConnectorService {
  beginOAuth(userId: string): {
    authUrl: string;
    state: string;
    codeVerifier: string;
    expiresInSeconds: number;
  } {
    const pkce = createPkceState(userId);
    const authUrl = buildDocuSignOAuthUrl({
      state: pkce.state,
      codeChallenge: pkce.challenge,
    });

    logDocuSign({
      event: "connect",
      level: "info",
      connector: "docusign",
      userId,
      message: "DocuSign OAuth flow initialized",
      metadata: { authMethod: "oauth2_pkce" },
    });

    return {
      authUrl,
      state: pkce.state,
      codeVerifier: pkce.verifier,
      expiresInSeconds: pkce.expiresInSeconds,
    };
  }

  async completeOAuth(params: { code: string; state: string }): Promise<DocuSignCredentialPublic> {
    const state = consumePkceState(params.state);
    if (!state) {
      throw new ConnectorError("auth", "OAuth state is invalid or expired", 401);
    }

    const tokenSet = await exchangeCodeForTokens({
      code: params.code,
      codeVerifier: state.verifier,
    });

    const scopes = parseScopeSet(tokenSet.scope);

    const credential = docuSignCredentialStore.saveOAuth({
      userId: state.userId,
      accessToken: tokenSet.accessToken,
      refreshToken: tokenSet.refreshToken,
      scopes,
      accountId: tokenSet.accountId,
      accountName: tokenSet.accountName,
      baseUri: tokenSet.baseUri,
      metadata: tokenSet.expiresAt
        ? {
          expiresAt: tokenSet.expiresAt,
          baseUri: tokenSet.baseUri,
          accountId: tokenSet.accountId,
        }
        : {
          baseUri: tokenSet.baseUri,
          accountId: tokenSet.accountId,
        },
    });

    const missingScopes = hasMissingRequiredScopes(scopes);

    logDocuSign({
      event: missingScopes.length > 0 ? "error" : "connect",
      level: missingScopes.length > 0 ? "warn" : "info",
      connector: "docusign",
      userId: state.userId,
      accountId: tokenSet.accountId,
      message: missingScopes.length > 0
        ? "DocuSign OAuth connection completed with missing recommended scopes"
        : "DocuSign OAuth connection completed",
      metadata: {
        authMethod: "oauth2_pkce",
        missingScopes,
      },
    });

    return credential;
  }

  async connectApiKey(params: {
    userId: string;
    accessToken: string;
    accountId: string;
    baseUri: string;
    scopes?: string[];
    accountName?: string;
  }): Promise<DocuSignCredentialPublic> {
    const client = new DocuSignClient({
      token: params.accessToken,
      accountId: params.accountId,
      baseUri: params.baseUri,
    });

    const accountInfo = await client.getAccountInfo();

    const credential = docuSignCredentialStore.saveApiKey({
      userId: params.userId,
      accessToken: params.accessToken,
      scopes: params.scopes ?? [],
      accountId: params.accountId,
      accountName: accountInfo.accountName ?? params.accountName,
      baseUri: params.baseUri,
      metadata: {
        accountId: params.accountId,
        baseUri: params.baseUri,
      },
    });

    logDocuSign({
      event: "connect",
      level: "info",
      connector: "docusign",
      userId: params.userId,
      accountId: params.accountId,
      message: "DocuSign API-key fallback connection completed",
      metadata: { authMethod: "api_key" },
    });

    return credential;
  }

  listConnections(userId: string): DocuSignCredentialPublic[] {
    return docuSignCredentialStore.getPublicByUser(userId);
  }

  async testConnection(userId: string): Promise<{ accountId: string; accountName?: string }> {
    const credential = await this.ensureValidCredential(userId);
    const client = this.getClientForCredential(credential);
    const account = await client.getAccountInfo();

    logDocuSign({
      event: "sync",
      level: "info",
      connector: "docusign",
      userId,
      accountId: credential.accountId,
      message: "DocuSign test connection succeeded",
    });

    return {
      accountId: account.accountId,
      accountName: account.accountName,
    };
  }

  async health(userId: string): Promise<DocuSignConnectionHealth> {
    const checkedAt = new Date().toISOString();
    const credential = docuSignCredentialStore.getActiveByUser(userId);

    if (!credential) {
      return {
        status: "down",
        checkedAt,
        details: {
          auth: false,
          apiReachable: false,
          rateLimited: false,
          errorType: "auth",
          message: "No DocuSign credential is connected",
        },
      };
    }

    try {
      const validCredential = await this.ensureValidCredential(userId);
      const client = this.getClientForCredential(validCredential);
      await client.getAccountInfo();

      const missingScopes = validCredential.authMethod === "oauth2_pkce"
        ? hasMissingRequiredScopes(validCredential.scopes)
        : [];

      if (missingScopes.length > 0) {
        return {
          status: "degraded",
          checkedAt,
          accountId: validCredential.accountId,
          authMethod: validCredential.authMethod,
          tokenRefreshStatus: validCredential.authMethod === "oauth2_pkce" ? "healthy" : "not_applicable",
          details: {
            auth: true,
            apiReachable: true,
            rateLimited: false,
            errorType: "schema",
            message: `Missing scopes: ${missingScopes.join(", ")}`,
          },
        };
      }

      logDocuSign({
        event: "health",
        level: "info",
        connector: "docusign",
        userId,
        accountId: validCredential.accountId,
        message: "DocuSign health check passed",
      });

      return {
        status: "ok",
        checkedAt,
        accountId: validCredential.accountId,
        authMethod: validCredential.authMethod,
        tokenRefreshStatus:
          validCredential.authMethod === "oauth2_pkce"
            ? validCredential.refreshTokenEncrypted
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

      logDocuSign({
        event: "error",
        level: "error",
        connector: "docusign",
        userId,
        accountId: credential.accountId,
        message: connectorError.message,
        errorType: connectorError.type,
      });

      return {
        status: connectorError.type === "rate-limit" ? "degraded" : "down",
        checkedAt,
        accountId: credential.accountId,
        authMethod: credential.authMethod,
        tokenRefreshStatus: credential.authMethod === "oauth2_pkce" ? "failed" : "not_applicable",
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
    const revoked = docuSignCredentialStore.revoke(credentialId, userId);

    if (revoked) {
      logDocuSign({
        event: "disconnect",
        level: "info",
        connector: "docusign",
        userId,
        message: "DocuSign credential revoked",
        metadata: { credentialId },
      });
    }

    return revoked;
  }

  async listEnvelopes(userId: string): Promise<Array<{ envelopeId: string; status?: string; emailSubject?: string }>> {
    const credential = await this.ensureValidCredential(userId);
    const client = this.getClientForCredential(credential);
    return client.listEnvelopes();
  }

  async createEnvelope(
    userId: string,
    envelopeDefinition: Record<string, unknown>
  ): Promise<{ envelopeId: string; status?: string; uri?: string }> {
    const credential = await this.ensureValidCredential(userId);
    const client = this.getClientForCredential(credential);
    return client.createEnvelope(envelopeDefinition);
  }

  async getEnvelope(
    userId: string,
    envelopeId: string
  ): Promise<{ envelopeId: string; status?: string; emailSubject?: string }> {
    const credential = await this.ensureValidCredential(userId);
    const client = this.getClientForCredential(credential);
    return client.getEnvelope(envelopeId);
  }

  private getClientForCredential(credential: NonNullable<ReturnType<typeof docuSignCredentialStore.getActiveByUser>>): DocuSignClient {
    return new DocuSignClient({
      token: docuSignCredentialStore.decryptAccessToken(credential),
      accountId: credential.accountId,
      baseUri: credential.baseUri,
    });
  }

  private async ensureValidCredential(userId: string) {
    const credential = docuSignCredentialStore.getActiveByUser(userId);
    if (!credential) {
      throw new ConnectorError("auth", "DocuSign connector is not configured", 404);
    }

    await runOAuthTokenRefreshMiddleware({
      shouldAttemptRefresh: credential.authMethod === "oauth2_pkce" && Boolean(credential.refreshTokenEncrypted),
      expiresAt: credential.metadata?.expiresAt,
      getRefreshToken: () => docuSignCredentialStore.decryptRefreshToken(credential),
      refreshAccessToken,
      persistRefreshedToken: (tokenSet) => {
        docuSignCredentialStore.rotateToken({
          credentialId: credential.id,
          accessToken: tokenSet.accessToken,
          refreshToken: tokenSet.refreshToken,
          scopes: parseScopeSet(tokenSet.scope),
          accountName: tokenSet.accountName,
          baseUri: tokenSet.baseUri,
          metadata: {
            ...(tokenSet.expiresAt ? { expiresAt: tokenSet.expiresAt } : {}),
            accountId: tokenSet.accountId,
            baseUri: tokenSet.baseUri,
          },
        });
      },
      onRefreshFailure: (error) => {
        logDocuSign({
          event: "error",
          level: "error",
          connector: "docusign",
          userId,
          accountId: credential.accountId,
          message: `DocuSign token refresh failed: ${error instanceof Error ? error.message : String(error)}`,
          errorType: "auth",
        });
      },
      isKnownError: (error) => error instanceof ConnectorError,
      createAuthError: (message, statusCode) => new ConnectorError("auth", message, statusCode),
      refreshFailedMessage: "DocuSign token refresh failed",
    });

    const updated = docuSignCredentialStore.getActiveByUser(userId);
    if (!updated) {
      throw new ConnectorError("auth", "DocuSign connector is not configured", 404);
    }

    return updated;
  }
}

export const docuSignConnectorService = new DocuSignConnectorService();
