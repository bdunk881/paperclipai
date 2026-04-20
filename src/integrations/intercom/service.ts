import { intercomCredentialStore } from "./credentialStore";
import { IntercomClient } from "./intercomClient";
import { logIntercom } from "./logger";
import {
  buildIntercomOAuthUrl,
  exchangeCodeForTokens,
  parseIntercomScopes,
  refreshAccessToken,
} from "./oauth";
import { consumePkceState, createPkceState } from "./pkceStore";
import {
  ConnectorError,
  IntercomConnectionHealth,
  IntercomContact,
  IntercomConversation,
  IntercomCredentialPublic,
} from "./types";

export class IntercomConnectorService {
  beginOAuth(userId: string): {
    authUrl: string;
    state: string;
    codeVerifier: string;
    expiresInSeconds: number;
  } {
    const pkce = createPkceState(userId);
    const authUrl = buildIntercomOAuthUrl({
      state: pkce.state,
      codeChallenge: pkce.challenge,
    });

    logIntercom({
      event: "connect",
      level: "info",
      connector: "intercom",
      userId,
      message: "Intercom OAuth flow initialized",
      metadata: { authMethod: "oauth2_pkce" },
    });

    return {
      authUrl,
      state: pkce.state,
      codeVerifier: pkce.verifier,
      expiresInSeconds: pkce.expiresInSeconds,
    };
  }

  async completeOAuth(params: { code: string; state: string }): Promise<IntercomCredentialPublic> {
    const state = consumePkceState(params.state);
    if (!state) {
      throw new ConnectorError("auth", "OAuth state is invalid or expired", 401);
    }

    const tokenSet = await exchangeCodeForTokens({
      code: params.code,
      codeVerifier: state.verifier,
    });

    const credential = intercomCredentialStore.saveOAuth({
      userId: state.userId,
      accessToken: tokenSet.accessToken,
      refreshToken: tokenSet.refreshToken,
      scopes: parseIntercomScopes(tokenSet.scope),
      workspaceId: tokenSet.workspaceId,
      workspaceName: tokenSet.workspaceName,
      metadata: tokenSet.expiresAt ? { expiresAt: tokenSet.expiresAt } : undefined,
    });

    logIntercom({
      event: "connect",
      level: "info",
      connector: "intercom",
      userId: state.userId,
      workspaceId: tokenSet.workspaceId,
      message: "Intercom OAuth connection completed",
      metadata: { authMethod: "oauth2_pkce" },
    });

    return credential;
  }

  async connectApiKey(params: { userId: string; apiKey: string }): Promise<IntercomCredentialPublic> {
    const client = new IntercomClient(params.apiKey);
    const viewer = await client.viewer();

    const credential = intercomCredentialStore.saveApiKey({
      userId: params.userId,
      apiKey: params.apiKey,
      workspaceId: viewer.workspaceId,
      workspaceName: viewer.workspaceName,
      metadata: { viewerId: viewer.viewerId },
    });

    logIntercom({
      event: "connect",
      level: "info",
      connector: "intercom",
      userId: params.userId,
      workspaceId: viewer.workspaceId,
      message: "Intercom API-key fallback connection completed",
      metadata: { authMethod: "api_key" },
    });

    return credential;
  }

  listConnections(userId: string): IntercomCredentialPublic[] {
    return intercomCredentialStore.getPublicByUser(userId);
  }

  async testConnection(userId: string): Promise<{ workspaceId: string; workspaceName?: string }> {
    const credential = await this.ensureValidCredential(userId);
    const token = intercomCredentialStore.decryptAccessToken(credential);
    const client = new IntercomClient(token);
    const viewer = await client.viewer();

    logIntercom({
      event: "sync",
      level: "info",
      connector: "intercom",
      userId,
      workspaceId: viewer.workspaceId,
      message: "Intercom test connection succeeded",
    });

    return {
      workspaceId: viewer.workspaceId,
      workspaceName: viewer.workspaceName,
    };
  }

  async health(userId: string): Promise<IntercomConnectionHealth> {
    const checkedAt = new Date().toISOString();
    const credential = intercomCredentialStore.getActiveByUser(userId);

    if (!credential) {
      return {
        status: "down",
        checkedAt,
        details: {
          auth: false,
          apiReachable: false,
          rateLimited: false,
          errorType: "auth",
          message: "No Intercom credential is connected",
        },
      };
    }

    try {
      const token = intercomCredentialStore.decryptAccessToken(credential);
      const client = new IntercomClient(token);
      await client.viewer();

      const health: IntercomConnectionHealth = {
        status: "ok",
        checkedAt,
        workspaceId: credential.workspaceId,
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

      logIntercom({
        event: "health",
        level: "info",
        connector: "intercom",
        userId,
        workspaceId: credential.workspaceId,
        message: "Intercom health check passed",
      });

      return health;
    } catch (error) {
      const connectorError = error instanceof ConnectorError
        ? error
        : new ConnectorError("upstream", error instanceof Error ? error.message : String(error), 502);

      logIntercom({
        event: "error",
        level: "error",
        connector: "intercom",
        userId,
        workspaceId: credential.workspaceId,
        message: connectorError.message,
        errorType: connectorError.type,
      });

      return {
        status: connectorError.type === "rate-limit" ? "degraded" : "down",
        checkedAt,
        workspaceId: credential.workspaceId,
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
    const revoked = intercomCredentialStore.revoke(credentialId, userId);

    if (revoked) {
      logIntercom({
        event: "disconnect",
        level: "info",
        connector: "intercom",
        userId,
        message: "Intercom credential revoked",
        metadata: { credentialId },
      });
    }

    return revoked;
  }

  async listContacts(userId: string): Promise<IntercomContact[]> {
    const credential = await this.ensureValidCredential(userId);
    const client = new IntercomClient(intercomCredentialStore.decryptAccessToken(credential));
    const contacts = await client.listContacts();

    logIntercom({
      event: "sync",
      level: "info",
      connector: "intercom",
      userId,
      workspaceId: credential.workspaceId,
      message: "Intercom contacts synced",
      metadata: { total: contacts.length },
    });

    return contacts;
  }

  async createContact(userId: string, input: {
    email?: string;
    name?: string;
    role?: "lead" | "user";
    externalId?: string;
  }): Promise<IntercomContact> {
    const credential = await this.ensureValidCredential(userId);
    const client = new IntercomClient(intercomCredentialStore.decryptAccessToken(credential));
    const contact = await client.createContact(input);

    logIntercom({
      event: "sync",
      level: "info",
      connector: "intercom",
      userId,
      workspaceId: credential.workspaceId,
      message: "Intercom contact created",
      metadata: { contactId: contact.id },
    });

    return contact;
  }

  async updateContact(userId: string, contactId: string, input: {
    email?: string;
    name?: string;
    role?: "lead" | "user";
  }): Promise<IntercomContact> {
    const credential = await this.ensureValidCredential(userId);
    const client = new IntercomClient(intercomCredentialStore.decryptAccessToken(credential));
    const contact = await client.updateContact(contactId, input);

    logIntercom({
      event: "sync",
      level: "info",
      connector: "intercom",
      userId,
      workspaceId: credential.workspaceId,
      message: "Intercom contact updated",
      metadata: { contactId: contact.id },
    });

    return contact;
  }

  async listConversations(userId: string): Promise<IntercomConversation[]> {
    const credential = await this.ensureValidCredential(userId);
    const client = new IntercomClient(intercomCredentialStore.decryptAccessToken(credential));
    const conversations = await client.listConversations();

    logIntercom({
      event: "sync",
      level: "info",
      connector: "intercom",
      userId,
      workspaceId: credential.workspaceId,
      message: "Intercom conversations synced",
      metadata: { total: conversations.length },
    });

    return conversations;
  }

  async createConversation(userId: string, input: {
    fromContactId: string;
    body: string;
    messageType?: "comment" | "note";
    assigneeId?: string;
  }): Promise<{ id: string }> {
    const credential = await this.ensureValidCredential(userId);
    const client = new IntercomClient(intercomCredentialStore.decryptAccessToken(credential));
    const conversation = await client.createConversation(input);

    logIntercom({
      event: "sync",
      level: "info",
      connector: "intercom",
      userId,
      workspaceId: credential.workspaceId,
      message: "Intercom conversation created",
      metadata: { conversationId: conversation.id },
    });

    return conversation;
  }

  async replyToConversation(userId: string, conversationId: string, input: {
    adminId: string;
    body: string;
    messageType?: "comment" | "note";
  }): Promise<{ id: string }> {
    const credential = await this.ensureValidCredential(userId);
    const client = new IntercomClient(intercomCredentialStore.decryptAccessToken(credential));
    const conversation = await client.replyToConversation(conversationId, input);

    logIntercom({
      event: "sync",
      level: "info",
      connector: "intercom",
      userId,
      workspaceId: credential.workspaceId,
      message: "Intercom conversation replied",
      metadata: { conversationId: conversation.id },
    });

    return conversation;
  }

  private async ensureValidCredential(userId: string) {
    const credential = intercomCredentialStore.getActiveByUser(userId);
    if (!credential) {
      throw new ConnectorError("auth", "Intercom connector is not configured", 404);
    }

    if (credential.authMethod === "oauth2_pkce" && credential.refreshTokenEncrypted) {
      const expiresAt = credential.metadata?.expiresAt;
      if (expiresAt && Date.now() >= Date.parse(expiresAt) - 60_000) {
        try {
          const refreshToken = intercomCredentialStore.decryptRefreshToken(credential);
          if (!refreshToken) {
            throw new ConnectorError("auth", "Missing refresh token", 401);
          }

          const refreshed = await refreshAccessToken(refreshToken);
          intercomCredentialStore.rotateToken({
            credentialId: credential.id,
            accessToken: refreshed.accessToken,
            refreshToken: refreshed.refreshToken,
            scopes: parseIntercomScopes(refreshed.scope),
            expiresAt: refreshed.expiresAt,
          });
        } catch (error) {
          logIntercom({
            event: "error",
            level: "error",
            connector: "intercom",
            userId,
            workspaceId: credential.workspaceId,
            message: `Intercom token refresh failed: ${error instanceof Error ? error.message : String(error)}`,
            errorType: "auth",
          });
          throw new ConnectorError("auth", "Intercom token refresh failed", 401);
        }
      }
    }

    return credential;
  }
}

export const intercomConnectorService = new IntercomConnectorService();
