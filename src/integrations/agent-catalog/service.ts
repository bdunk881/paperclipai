import { agentCatalogCredentialStore } from "./credentialStore";
import { logAgentCatalog } from "./logger";
import { consumePkceState, createPkceState } from "./pkceStore";
import { buildAuthorizationUrl, exchangeCodeForToken, fetchProviderIdentity } from "./oauth";
import { AgentCatalogConnectorError, AgentCatalogConnectionPublic, AgentCatalogProvider } from "./types";

export class AgentCatalogConnectorService {
  beginOAuth(userId: string, provider: AgentCatalogProvider): { authUrl: string; state: string; expiresInSeconds: number } {
    const pkce = createPkceState(userId, provider);
    const authUrl = buildAuthorizationUrl({
      provider,
      state: pkce.state,
      codeChallenge: pkce.challenge,
    });

    logAgentCatalog({
      event: "connect",
      level: "info",
      connector: "agent-catalog",
      userId,
      provider,
      message: "Agent catalog OAuth flow initialized",
      metadata: { authMethod: "oauth2_pkce" },
    });

    return {
      authUrl,
      state: pkce.state,
      expiresInSeconds: 600,
    };
  }

  async completeOAuth(params: {
    provider: AgentCatalogProvider;
    code: string;
    state: string;
  }): Promise<AgentCatalogConnectionPublic> {
    const stateEntry = consumePkceState(params.state);
    if (!stateEntry || stateEntry.provider !== params.provider) {
      throw new AgentCatalogConnectorError("auth", "OAuth state is invalid or expired", 401);
    }

    const tokenSet = await exchangeCodeForToken({
      provider: params.provider,
      code: params.code,
      codeVerifier: stateEntry.verifier,
    });

    // Only persist as connected after a follow-up provider API verification succeeds.
    const identity = await fetchProviderIdentity(params.provider, tokenSet.accessToken);

    const connection = agentCatalogCredentialStore.saveOAuth({
      userId: stateEntry.userId,
      provider: params.provider,
      accessToken: tokenSet.accessToken,
      refreshToken: tokenSet.refreshToken,
      scopes: tokenSet.scopes,
      accountLabel: identity.accountLabel,
    });

    logAgentCatalog({
      event: "connect",
      level: "info",
      connector: "agent-catalog",
      userId: stateEntry.userId,
      provider: params.provider,
      message: "Agent catalog OAuth connection completed",
      metadata: { accountLabel: identity.accountLabel },
    });

    return connection;
  }

  listConnections(userId: string): AgentCatalogConnectionPublic[] {
    return agentCatalogCredentialStore.getPublicByUser(userId);
  }

  async testConnection(userId: string, provider: AgentCatalogProvider): Promise<{ accountLabel: string }> {
    const connection = agentCatalogCredentialStore.getActiveByUserProvider(userId, provider);
    if (!connection) {
      throw new AgentCatalogConnectorError("auth", `${provider} is not connected`, 404);
    }

    const accessToken = agentCatalogCredentialStore.decryptAccessToken(connection);
    const identity = await fetchProviderIdentity(provider, accessToken);

    logAgentCatalog({
      event: "sync",
      level: "info",
      connector: "agent-catalog",
      userId,
      provider,
      message: "Agent catalog connection verification succeeded",
      metadata: { accountLabel: identity.accountLabel },
    });

    return identity;
  }

  disconnect(userId: string, provider: AgentCatalogProvider): boolean {
    const revoked = agentCatalogCredentialStore.revokeByProvider(userId, provider);
    if (revoked) {
      logAgentCatalog({
        event: "disconnect",
        level: "info",
        connector: "agent-catalog",
        userId,
        provider,
        message: "Agent catalog provider disconnected",
      });
    }
    return revoked;
  }
}

export const agentCatalogConnectorService = new AgentCatalogConnectorService();
