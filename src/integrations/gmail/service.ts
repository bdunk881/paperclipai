import { gmailCredentialStore } from "./credentialStore";
import { GmailClient } from "./gmailClient";
import { logGmail } from "./logger";
import { buildGmailOAuthUrl, exchangeCodeForTokens, parseGmailScopes, refreshAccessToken } from "./oauth";
import { consumePkceState, createPkceState } from "./pkceStore";
import {
  ConnectorError,
  GmailConnectionHealth,
  GmailCredential,
  GmailCredentialPublic,
  GmailLabel,
  GmailMessageDetail,
  GmailMessageSummary,
  GmailWatchResponse,
} from "./types";

export class GmailConnectorService {
  beginOAuth(userId: string): {
    authUrl: string;
    state: string;
    codeVerifier: string;
    expiresInSeconds: number;
  } {
    const pkce = createPkceState(userId);
    const authUrl = buildGmailOAuthUrl({
      state: pkce.state,
      codeChallenge: pkce.challenge,
    });

    logGmail({
      event: "connect",
      level: "info",
      connector: "gmail",
      userId,
      message: "Gmail OAuth flow initialized",
      metadata: { authMethod: "oauth2_pkce" },
    });

    return {
      authUrl,
      state: pkce.state,
      codeVerifier: pkce.verifier,
      expiresInSeconds: pkce.expiresInSeconds,
    };
  }

  async completeOAuth(params: { code: string; state: string }): Promise<GmailCredentialPublic> {
    const state = consumePkceState(params.state);
    if (!state) {
      throw new ConnectorError("auth", "OAuth state is invalid or expired", 401);
    }

    const tokenSet = await exchangeCodeForTokens({
      code: params.code,
      codeVerifier: state.verifier,
    });

    const credential = gmailCredentialStore.saveOAuth({
      userId: state.userId,
      accessToken: tokenSet.accessToken,
      refreshToken: tokenSet.refreshToken,
      scopes: parseGmailScopes(tokenSet.scope),
      emailAddress: tokenSet.emailAddress,
      metadata: {
        ...(tokenSet.expiresAt ? { expiresAt: tokenSet.expiresAt } : {}),
        ...(tokenSet.historyId ? { historyId: tokenSet.historyId } : {}),
      },
    });

    logGmail({
      event: "connect",
      level: "info",
      connector: "gmail",
      userId: state.userId,
      emailAddress: tokenSet.emailAddress,
      message: "Gmail OAuth connection completed",
      metadata: { authMethod: "oauth2_pkce" },
    });

    return credential;
  }

  async connectApiKey(params: {
    userId: string;
    apiKey: string;
  }): Promise<GmailCredentialPublic> {
    const client = new GmailClient(params.apiKey);
    const profile = await client.getProfile();

    const credential = gmailCredentialStore.saveApiKey({
      userId: params.userId,
      apiKey: params.apiKey,
      emailAddress: profile.emailAddress,
      metadata: profile.historyId ? { historyId: profile.historyId } : undefined,
    });

    logGmail({
      event: "connect",
      level: "info",
      connector: "gmail",
      userId: params.userId,
      emailAddress: profile.emailAddress,
      message: "Gmail API-key fallback connection completed",
      metadata: { authMethod: "api_key" },
    });

    return credential;
  }

  async listConnections(userId: string): Promise<GmailCredentialPublic[]> {
    return gmailCredentialStore.getPublicByUserAsync(userId);
  }

  async testConnection(userId: string): Promise<{ emailAddress: string; historyId?: string }> {
    return this.withClient(userId, async (client, credential) => {
      const profile = await client.getProfile();

      logGmail({
        event: "sync",
        level: "info",
        connector: "gmail",
        userId,
        emailAddress: credential.emailAddress,
        message: "Gmail test connection succeeded",
      });

      return {
        emailAddress: profile.emailAddress,
        historyId: profile.historyId,
      };
    });
  }

  async health(userId: string): Promise<GmailConnectionHealth> {
    const checkedAt = new Date().toISOString();
    const credential = await gmailCredentialStore.getActiveByUserAsync(userId);

    if (!credential) {
      return {
        status: "down",
        checkedAt,
        details: {
          auth: false,
          apiReachable: false,
          rateLimited: false,
          errorType: "auth",
          message: "No Gmail credential is connected",
        },
      };
    }

    try {
      const result = await this.withClient(userId, async (client) => client.getProfile());
      logGmail({
        event: "health",
        level: "info",
        connector: "gmail",
        userId,
        emailAddress: result.emailAddress,
        message: "Gmail health check passed",
      });

      return {
        status: "ok",
        checkedAt,
        emailAddress: credential.emailAddress,
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

      logGmail({
        event: "error",
        level: "error",
        connector: "gmail",
        userId,
        emailAddress: credential.emailAddress,
        message: connectorError.message,
        errorType: connectorError.type,
      });

      return {
        status: connectorError.type === "rate-limit" ? "degraded" : "down",
        checkedAt,
        emailAddress: credential.emailAddress,
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
    const revoked = await gmailCredentialStore.revokeAsync(credentialId, userId);

    if (revoked) {
      logGmail({
        event: "disconnect",
        level: "info",
        connector: "gmail",
        userId,
        message: "Gmail credential revoked",
        metadata: { credentialId },
      });
    }

    return revoked;
  }

  async listMessages(userId: string, params: {
    query?: string;
    labelIds?: string[];
    maxResults?: number;
  }): Promise<GmailMessageSummary[]> {
    return this.withClient(userId, async (client, credential) => {
      const messages = await client.listMessages(params);
      logGmail({
        event: "sync",
        level: "info",
        connector: "gmail",
        userId,
        emailAddress: credential.emailAddress,
        message: "Gmail messages listed",
        metadata: { total: messages.length, query: params.query },
      });
      return messages;
    });
  }

  async getMessage(userId: string, messageId: string): Promise<GmailMessageDetail> {
    return this.withClient(userId, async (client, credential) => {
      const message = await client.getMessage(messageId);
      logGmail({
        event: "sync",
        level: "info",
        connector: "gmail",
        userId,
        emailAddress: credential.emailAddress,
        message: "Gmail message fetched",
        metadata: { messageId },
      });
      return message;
    });
  }

  async sendMessage(userId: string, input: {
    to: string;
    subject: string;
    text: string;
    html?: string;
    cc?: string[];
    bcc?: string[];
    threadId?: string;
  }): Promise<{ id: string; threadId: string; labelIds: string[] }> {
    return this.withClient(userId, async (client, credential) => {
      const sent = await client.sendMessage(input);
      logGmail({
        event: "sync",
        level: "info",
        connector: "gmail",
        userId,
        emailAddress: credential.emailAddress,
        message: "Gmail message sent",
        metadata: { messageId: sent.id, threadId: sent.threadId },
      });
      return sent;
    });
  }

  async listLabels(userId: string): Promise<GmailLabel[]> {
    return this.withClient(userId, async (client, credential) => {
      const labels = await client.listLabels();
      logGmail({
        event: "sync",
        level: "info",
        connector: "gmail",
        userId,
        emailAddress: credential.emailAddress,
        message: "Gmail labels listed",
        metadata: { total: labels.length },
      });
      return labels;
    });
  }

  async createLabel(userId: string, input: {
    name: string;
    messageListVisibility?: string;
    labelListVisibility?: string;
    color?: {
      textColor?: string;
      backgroundColor?: string;
    };
  }): Promise<GmailLabel> {
    return this.withClient(userId, async (client, credential) => {
      const label = await client.createLabel(input);
      logGmail({
        event: "sync",
        level: "info",
        connector: "gmail",
        userId,
        emailAddress: credential.emailAddress,
        message: "Gmail label created",
        metadata: { labelId: label.id, name: label.name },
      });
      return label;
    });
  }

  async updateLabel(
    userId: string,
    labelId: string,
    input: {
      name?: string;
      messageListVisibility?: string;
      labelListVisibility?: string;
      color?: {
        textColor?: string;
        backgroundColor?: string;
      };
    }
  ): Promise<GmailLabel> {
    return this.withClient(userId, async (client, credential) => {
      const label = await client.updateLabel(labelId, input);
      logGmail({
        event: "sync",
        level: "info",
        connector: "gmail",
        userId,
        emailAddress: credential.emailAddress,
        message: "Gmail label updated",
        metadata: { labelId: label.id, name: label.name },
      });
      return label;
    });
  }

  async watchMailbox(userId: string, params: {
    topicName: string;
    labelIds?: string[];
    labelFilterAction?: "include" | "exclude";
  }): Promise<GmailWatchResponse> {
    return this.withClient(userId, async (client, credential) => {
      const watch = await client.watchMailbox(params);
      gmailCredentialStore.rotateToken({
        credentialId: credential.id,
        accessToken: gmailCredentialStore.decryptAccessToken(credential),
        historyId: watch.historyId,
      });
      logGmail({
        event: "sync",
        level: "info",
        connector: "gmail",
        userId,
        emailAddress: credential.emailAddress,
        message: "Gmail mailbox watch created",
        metadata: {
          historyId: watch.historyId,
          expiration: watch.expiration,
          topicName: params.topicName,
        },
      });
      return watch;
    });
  }

  private async withClient<T>(
    userId: string,
    action: (client: GmailClient, credential: GmailCredential) => Promise<T>
  ): Promise<T> {
    let credential = await this.ensureValidCredential(userId);
    let client = new GmailClient(gmailCredentialStore.decryptAccessToken(credential));

    try {
      return await action(client, credential);
    } catch (error) {
      if (
        error instanceof ConnectorError &&
        error.type === "auth" &&
        credential.authMethod === "oauth2_pkce" &&
        credential.refreshTokenEncrypted
      ) {
        credential = await this.refreshCredential(userId, credential);
        client = new GmailClient(gmailCredentialStore.decryptAccessToken(credential));
        return action(client, credential);
      }

      throw error;
    }
  }

  private async ensureValidCredential(userId: string): Promise<GmailCredential> {
    let credential = await gmailCredentialStore.getActiveByUserAsync(userId);
    if (!credential) {
      throw new ConnectorError("auth", "Gmail connector is not configured", 404);
    }

    if (credential.authMethod === "oauth2_pkce" && credential.refreshTokenEncrypted) {
      const expiresAt = credential.metadata?.expiresAt;
      if (expiresAt && Date.now() >= Date.parse(expiresAt) - 60_000) {
        credential = await this.refreshCredential(userId, credential);
      }
    }

    return credential;
  }

  private async refreshCredential(userId: string, credential: GmailCredential): Promise<GmailCredential> {
    try {
      const refreshToken = gmailCredentialStore.decryptRefreshToken(credential);
      if (!refreshToken) {
        throw new ConnectorError("auth", "Missing refresh token", 401);
      }

      const refreshed = await refreshAccessToken(refreshToken);
      gmailCredentialStore.rotateToken({
        credentialId: credential.id,
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        scopes: parseGmailScopes(refreshed.scope),
        emailAddress: refreshed.emailAddress,
        expiresAt: refreshed.expiresAt,
        historyId: refreshed.historyId,
      });

      return (await gmailCredentialStore.getActiveByUserAsync(userId)) ?? credential;
    } catch (error) {
      logGmail({
        event: "error",
        level: "error",
        connector: "gmail",
        userId,
        emailAddress: credential.emailAddress,
        message: `Gmail token refresh failed: ${error instanceof Error ? error.message : String(error)}`,
        errorType: "auth",
      });
      throw new ConnectorError("auth", "Gmail token refresh failed", 401);
    }
  }
}

export const gmailConnectorService = new GmailConnectorService();
