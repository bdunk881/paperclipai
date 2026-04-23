import { hubSpotCredentialStore } from "./credentialStore";
import { HubSpotClient } from "./hubspotClient";
import { logHubSpot } from "./logger";
import { buildHubSpotOAuthUrl, exchangeCodeForTokens, parseHubSpotScopes, refreshAccessToken } from "./oauth";
import { consumeOAuthState, createOAuthState } from "./oauthStateStore";
import {
  ConnectorError,
  HubSpotCompany,
  HubSpotConnectionHealth,
  HubSpotContact,
  HubSpotCredential,
  HubSpotCredentialPublic,
  HubSpotDeal,
} from "./types";

export class HubSpotConnectorService {
  beginOAuth(userId: string): {
    authUrl: string;
    state: string;
    expiresInSeconds: number;
  } {
    const state = createOAuthState(userId);
    const authUrl = buildHubSpotOAuthUrl({ state: state.state });

    logHubSpot({
      event: "connect",
      level: "info",
      connector: "hubspot",
      userId,
      message: "HubSpot OAuth flow initialized",
      metadata: { authMethod: "oauth2" },
    });

    return {
      authUrl,
      state: state.state,
      expiresInSeconds: state.expiresInSeconds,
    };
  }

  async completeOAuth(params: { code: string; state: string }): Promise<HubSpotCredentialPublic> {
    const state = consumeOAuthState(params.state);
    if (!state) {
      throw new ConnectorError("auth", "OAuth state is invalid or expired", 401);
    }

    const tokenSet = await exchangeCodeForTokens({ code: params.code });
    const credential = hubSpotCredentialStore.saveOAuth({
      userId: state.userId,
      accessToken: tokenSet.accessToken,
      refreshToken: tokenSet.refreshToken,
      scopes: tokenSet.scopes,
      hubId: tokenSet.hubId,
      hubDomain: tokenSet.hubDomain,
      metadata: tokenSet.expiresAt ? { expiresAt: tokenSet.expiresAt } : undefined,
    });

    logHubSpot({
      event: "connect",
      level: "info",
      connector: "hubspot",
      userId: state.userId,
      hubId: tokenSet.hubId,
      message: "HubSpot OAuth connection completed",
      metadata: { authMethod: "oauth2" },
    });

    return credential;
  }

  async connectApiKey(params: {
    userId: string;
    apiKey: string;
  }): Promise<HubSpotCredentialPublic> {
    const client = new HubSpotClient(params.apiKey, "api_key");
    const viewer = await client.viewer();

    const credential = hubSpotCredentialStore.saveApiKey({
      userId: params.userId,
      apiKey: params.apiKey,
      scopes: viewer.scopes,
      hubId: viewer.hubId,
      hubDomain: viewer.hubDomain,
    });

    logHubSpot({
      event: "connect",
      level: "info",
      connector: "hubspot",
      userId: params.userId,
      hubId: viewer.hubId,
      message: "HubSpot private-app token fallback connection completed",
      metadata: { authMethod: "api_key" },
    });

    return credential;
  }

  async listConnections(userId: string): Promise<HubSpotCredentialPublic[]> {
    return hubSpotCredentialStore.getPublicByUserAsync(userId);
  }

  async testConnection(userId: string): Promise<{ hubId: string; hubDomain?: string }> {
    const credential = await this.ensureValidCredential(userId);
    const token = hubSpotCredentialStore.decryptAccessToken(credential);
    const client = new HubSpotClient(token, credential.authMethod);
    const viewer = await client.viewer();

    logHubSpot({
      event: "sync",
      level: "info",
      connector: "hubspot",
      userId,
      hubId: viewer.hubId,
      message: "HubSpot test connection succeeded",
    });

    return {
      hubId: viewer.hubId,
      hubDomain: viewer.hubDomain,
    };
  }

  async health(userId: string): Promise<HubSpotConnectionHealth> {
    const checkedAt = new Date().toISOString();
    const credential = await hubSpotCredentialStore.getActiveByUserAsync(userId);

    if (!credential) {
      return {
        status: "down",
        checkedAt,
        details: {
          auth: false,
          apiReachable: false,
          rateLimited: false,
          errorType: "auth",
          message: "No HubSpot credential is connected",
        },
      };
    }

    try {
      const token = hubSpotCredentialStore.decryptAccessToken(credential);
      const client = new HubSpotClient(token, credential.authMethod);
      await client.viewer();

      const health: HubSpotConnectionHealth = {
        status: "ok",
        checkedAt,
        hubId: credential.hubId,
        authMethod: credential.authMethod,
        tokenRefreshStatus:
          credential.authMethod === "oauth2"
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

      logHubSpot({
        event: "health",
        level: "info",
        connector: "hubspot",
        userId,
        hubId: credential.hubId,
        message: "HubSpot health check passed",
      });

      return health;
    } catch (error) {
      const connectorError = error instanceof ConnectorError
        ? error
        : new ConnectorError("upstream", error instanceof Error ? error.message : String(error), 502);

      logHubSpot({
        event: "error",
        level: "error",
        connector: "hubspot",
        userId,
        hubId: credential.hubId,
        message: connectorError.message,
        errorType: connectorError.type,
      });

      return {
        status: connectorError.type === "rate-limit" ? "degraded" : "down",
        checkedAt,
        hubId: credential.hubId,
        authMethod: credential.authMethod,
        tokenRefreshStatus:
          credential.authMethod === "oauth2"
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
    const revoked = await hubSpotCredentialStore.revokeAsync(credentialId, userId);

    if (revoked) {
      logHubSpot({
        event: "disconnect",
        level: "info",
        connector: "hubspot",
        userId,
        message: "HubSpot credential revoked",
        metadata: { credentialId },
      });
    }

    return revoked;
  }

  async listContacts(userId: string): Promise<HubSpotContact[]> {
    const credential = await this.ensureValidCredential(userId);
    const client = new HubSpotClient(hubSpotCredentialStore.decryptAccessToken(credential), credential.authMethod);
    const contacts = await client.listContacts();

    logHubSpot({
      event: "sync",
      level: "info",
      connector: "hubspot",
      userId,
      hubId: credential.hubId,
      message: "HubSpot contacts synced",
      metadata: { total: contacts.length },
    });

    return contacts;
  }

  async createContact(userId: string, input: {
    email?: string;
    firstname?: string;
    lastname?: string;
    company?: string;
    phone?: string;
  }): Promise<HubSpotContact> {
    const credential = await this.ensureValidCredential(userId);
    const client = new HubSpotClient(hubSpotCredentialStore.decryptAccessToken(credential), credential.authMethod);
    const contact = await client.createContact(input);

    logHubSpot({
      event: "sync",
      level: "info",
      connector: "hubspot",
      userId,
      hubId: credential.hubId,
      message: "HubSpot contact created",
      metadata: { contactId: contact.id },
    });

    return contact;
  }

  async updateContact(userId: string, contactId: string, input: {
    email?: string;
    firstname?: string;
    lastname?: string;
    company?: string;
    phone?: string;
  }): Promise<HubSpotContact> {
    const credential = await this.ensureValidCredential(userId);
    const client = new HubSpotClient(hubSpotCredentialStore.decryptAccessToken(credential), credential.authMethod);
    const contact = await client.updateContact(contactId, input);

    logHubSpot({
      event: "sync",
      level: "info",
      connector: "hubspot",
      userId,
      hubId: credential.hubId,
      message: "HubSpot contact updated",
      metadata: { contactId: contact.id },
    });

    return contact;
  }

  async listCompanies(userId: string): Promise<HubSpotCompany[]> {
    const credential = await this.ensureValidCredential(userId);
    const client = new HubSpotClient(hubSpotCredentialStore.decryptAccessToken(credential), credential.authMethod);
    const companies = await client.listCompanies();

    logHubSpot({
      event: "sync",
      level: "info",
      connector: "hubspot",
      userId,
      hubId: credential.hubId,
      message: "HubSpot companies synced",
      metadata: { total: companies.length },
    });

    return companies;
  }

  async createCompany(userId: string, input: {
    name?: string;
    domain?: string;
    industry?: string;
    phone?: string;
    city?: string;
    country?: string;
  }): Promise<HubSpotCompany> {
    const credential = await this.ensureValidCredential(userId);
    const client = new HubSpotClient(hubSpotCredentialStore.decryptAccessToken(credential), credential.authMethod);
    const company = await client.createCompany(input);

    logHubSpot({
      event: "sync",
      level: "info",
      connector: "hubspot",
      userId,
      hubId: credential.hubId,
      message: "HubSpot company created",
      metadata: { companyId: company.id },
    });

    return company;
  }

  async updateCompany(userId: string, companyId: string, input: {
    name?: string;
    domain?: string;
    industry?: string;
    phone?: string;
    city?: string;
    country?: string;
  }): Promise<HubSpotCompany> {
    const credential = await this.ensureValidCredential(userId);
    const client = new HubSpotClient(hubSpotCredentialStore.decryptAccessToken(credential), credential.authMethod);
    const company = await client.updateCompany(companyId, input);

    logHubSpot({
      event: "sync",
      level: "info",
      connector: "hubspot",
      userId,
      hubId: credential.hubId,
      message: "HubSpot company updated",
      metadata: { companyId: company.id },
    });

    return company;
  }

  async listDeals(userId: string): Promise<HubSpotDeal[]> {
    const credential = await this.ensureValidCredential(userId);
    const client = new HubSpotClient(hubSpotCredentialStore.decryptAccessToken(credential), credential.authMethod);
    const deals = await client.listDeals();

    logHubSpot({
      event: "sync",
      level: "info",
      connector: "hubspot",
      userId,
      hubId: credential.hubId,
      message: "HubSpot deals synced",
      metadata: { total: deals.length },
    });

    return deals;
  }

  async createDeal(userId: string, input: {
    dealname: string;
    amount?: string;
    dealstage?: string;
    pipeline?: string;
    closedate?: string;
  }): Promise<HubSpotDeal> {
    const credential = await this.ensureValidCredential(userId);
    const client = new HubSpotClient(hubSpotCredentialStore.decryptAccessToken(credential), credential.authMethod);
    const deal = await client.createDeal(input);

    logHubSpot({
      event: "sync",
      level: "info",
      connector: "hubspot",
      userId,
      hubId: credential.hubId,
      message: "HubSpot deal created",
      metadata: { dealId: deal.id },
    });

    return deal;
  }

  async updateDeal(userId: string, dealId: string, input: {
    dealname?: string;
    amount?: string;
    dealstage?: string;
    pipeline?: string;
    closedate?: string;
  }): Promise<HubSpotDeal> {
    const credential = await this.ensureValidCredential(userId);
    const client = new HubSpotClient(hubSpotCredentialStore.decryptAccessToken(credential), credential.authMethod);
    const deal = await client.updateDeal(dealId, input);

    logHubSpot({
      event: "sync",
      level: "info",
      connector: "hubspot",
      userId,
      hubId: credential.hubId,
      message: "HubSpot deal updated",
      metadata: { dealId: deal.id },
    });

    return deal;
  }

  private async ensureValidCredential(userId: string): Promise<HubSpotCredential> {
    let credential = await hubSpotCredentialStore.getActiveByUserAsync(userId);
    if (!credential) {
      throw new ConnectorError("auth", "HubSpot connector is not configured", 404);
    }

    if (credential.authMethod === "oauth2" && credential.refreshTokenEncrypted) {
      const expiresAt = credential.metadata?.expiresAt;
      if (expiresAt && Date.now() >= Date.parse(expiresAt) - 60_000) {
        try {
          const refreshToken = hubSpotCredentialStore.decryptRefreshToken(credential);
          if (!refreshToken) {
            throw new ConnectorError("auth", "Missing refresh token", 401);
          }

          const refreshed = await refreshAccessToken(refreshToken);
          hubSpotCredentialStore.rotateToken({
            credentialId: credential.id,
            accessToken: refreshed.accessToken,
            refreshToken: refreshed.refreshToken,
            scopes: refreshed.scopes,
            hubId: refreshed.hubId,
            hubDomain: refreshed.hubDomain,
            expiresAt: refreshed.expiresAt,
          });

          credential = (await hubSpotCredentialStore.getActiveByUserAsync(userId)) ?? credential;
        } catch (error) {
          logHubSpot({
            event: "error",
            level: "error",
            connector: "hubspot",
            userId,
            hubId: credential.hubId,
            message: `HubSpot token refresh failed: ${error instanceof Error ? error.message : String(error)}`,
            errorType: "auth",
          });
          throw new ConnectorError("auth", "HubSpot token refresh failed", 401);
        }
      }
    }

    return credential;
  }
}

export const hubSpotConnectorService = new HubSpotConnectorService();
