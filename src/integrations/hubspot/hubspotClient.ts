import {
  ConnectorError,
  ConnectorErrorType,
  HubSpotCompany,
  HubSpotContact,
  HubSpotDeal,
  HubSpotAuthMethod,
} from "./types";
import { fetchHubSpotAccessTokenMetadata } from "./oauth";

const MAX_RETRIES = 4;

function hubSpotApiBase(): string {
  return (process.env.HUBSPOT_API_BASE_URL ?? "https://api.hubapi.com").replace(/\/$/, "");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseErrorType(status: number, text: string): ConnectorErrorType {
  if (status === 401 || status === 403) return "auth";
  if (status === 429 || /rate.?limit/i.test(text)) return "rate-limit";
  if (status >= 500) return "upstream";
  if (status >= 400) return "schema";
  return "network";
}

function safeJsonParse(text: string): unknown {
  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

interface HubSpotListResponse<T> {
  results?: T[];
  paging?: {
    next?: {
      after?: string;
    };
  };
}

export class HubSpotClient {
  private token: string;
  private authMethod: HubSpotAuthMethod;

  constructor(token: string, authMethod: HubSpotAuthMethod) {
    this.token = token;
    this.authMethod = authMethod;
  }

  private async request<T>(path: string, init?: RequestInit, attempt = 0): Promise<T> {
    try {
      const response = await fetch(`${hubSpotApiBase()}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/json",
          ...(init?.headers ?? {}),
        },
      });

      if (response.status === 429) {
        if (attempt >= MAX_RETRIES) {
          throw new ConnectorError("rate-limit", "HubSpot API rate limit exceeded", 429);
        }

        const retryAfterSeconds = Number(response.headers.get("Retry-After") ?? "1");
        await sleep(Math.max(1, retryAfterSeconds) * 1000);
        return this.request<T>(path, init, attempt + 1);
      }

      const text = await response.text();
      if (!response.ok) {
        const type = parseErrorType(response.status, text);
        throw new ConnectorError(type, `HubSpot HTTP ${response.status}: ${text || response.statusText}`, response.status);
      }

      return safeJsonParse(text) as T;
    } catch (error) {
      if (error instanceof ConnectorError) {
        const retryable = error.type === "upstream" || error.type === "network";
        if (retryable && attempt < MAX_RETRIES) {
          await sleep(250 * Math.pow(2, attempt));
          return this.request<T>(path, init, attempt + 1);
        }
        throw error;
      }

      if (attempt < MAX_RETRIES) {
        await sleep(250 * Math.pow(2, attempt));
        return this.request<T>(path, init, attempt + 1);
      }

      throw new ConnectorError(
        "network",
        `HubSpot network request failed: ${error instanceof Error ? error.message : String(error)}`,
        502
      );
    }
  }

  async viewer(): Promise<{ hubId: string; hubDomain?: string; scopes: string[] }> {
    const metadata = await fetchHubSpotAccessTokenMetadata(this.token);
    return {
      hubId: metadata.hubId,
      hubDomain: metadata.hubDomain,
      scopes: metadata.scopes,
    };
  }

  private async listObjects<TInput, TOutput>(
    path: string,
    limit: number,
    mapItem: (item: TInput) => TOutput | null
  ): Promise<TOutput[]> {
    const pageSize = Math.min(100, Math.max(1, limit));
    const results: TOutput[] = [];
    let after: string | undefined;

    while (results.length < limit) {
      const query = new URLSearchParams({ limit: String(pageSize) });
      if (after) {
        query.set("after", after);
      }

      const data = await this.request<HubSpotListResponse<TInput>>(`${path}${path.includes("?") ? "&" : "?"}${query.toString()}`);
      const page = Array.isArray(data.results) ? data.results : [];

      for (const item of page) {
        const mapped = mapItem(item);
        if (!mapped) {
          continue;
        }
        results.push(mapped);
        if (results.length >= limit) {
          break;
        }
      }

      after = data.paging?.next?.after;
      if (!after || page.length === 0) {
        break;
      }
    }

    return results;
  }

  async listContacts(limit = 100): Promise<HubSpotContact[]> {
    return this.listObjects<{
      id?: string;
      properties?: Record<string, string>;
      createdAt?: string;
      updatedAt?: string;
      archived?: boolean;
    }, HubSpotContact>(
      "/crm/v3/objects/contacts?properties=email,firstname,lastname,company,phone",
      limit,
      (item) => item.id ? ({
        id: String(item.id),
        email: item.properties?.email,
        firstname: item.properties?.firstname,
        lastname: item.properties?.lastname,
        company: item.properties?.company,
        phone: item.properties?.phone,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        archived: item.archived,
      }) : null
    );
  }

  async createContact(input: {
    email?: string;
    firstname?: string;
    lastname?: string;
    company?: string;
    phone?: string;
  }): Promise<HubSpotContact> {
    const created = await this.request<{
      id?: string;
      properties?: Record<string, string>;
      createdAt?: string;
      updatedAt?: string;
      archived?: boolean;
    }>("/crm/v3/objects/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ properties: input }),
    });

    if (!created.id) {
      throw new ConnectorError("upstream", "HubSpot create contact returned no id", 502);
    }

    return {
      id: String(created.id),
      email: created.properties?.email,
      firstname: created.properties?.firstname,
      lastname: created.properties?.lastname,
      company: created.properties?.company,
      phone: created.properties?.phone,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
      archived: created.archived,
    };
  }

  async updateContact(contactId: string, input: {
    email?: string;
    firstname?: string;
    lastname?: string;
    company?: string;
    phone?: string;
  }): Promise<HubSpotContact> {
    const updated = await this.request<{
      id?: string;
      properties?: Record<string, string>;
      createdAt?: string;
      updatedAt?: string;
      archived?: boolean;
    }>(`/crm/v3/objects/contacts/${encodeURIComponent(contactId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ properties: input }),
    });

    if (!updated.id) {
      throw new ConnectorError("upstream", "HubSpot update contact returned no id", 502);
    }

    return {
      id: String(updated.id),
      email: updated.properties?.email,
      firstname: updated.properties?.firstname,
      lastname: updated.properties?.lastname,
      company: updated.properties?.company,
      phone: updated.properties?.phone,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
      archived: updated.archived,
    };
  }

  async listCompanies(limit = 100): Promise<HubSpotCompany[]> {
    return this.listObjects<{
      id?: string;
      properties?: Record<string, string>;
      createdAt?: string;
      updatedAt?: string;
      archived?: boolean;
    }, HubSpotCompany>(
      "/crm/v3/objects/companies?properties=name,domain,industry,phone,city,country",
      limit,
      (item) => item.id ? ({
        id: String(item.id),
        name: item.properties?.name,
        domain: item.properties?.domain,
        industry: item.properties?.industry,
        phone: item.properties?.phone,
        city: item.properties?.city,
        country: item.properties?.country,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        archived: item.archived,
      }) : null
    );
  }

  async createCompany(input: {
    name?: string;
    domain?: string;
    industry?: string;
    phone?: string;
    city?: string;
    country?: string;
  }): Promise<HubSpotCompany> {
    const created = await this.request<{
      id?: string;
      properties?: Record<string, string>;
      createdAt?: string;
      updatedAt?: string;
      archived?: boolean;
    }>("/crm/v3/objects/companies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ properties: input }),
    });

    if (!created.id) {
      throw new ConnectorError("upstream", "HubSpot create company returned no id", 502);
    }

    return {
      id: String(created.id),
      name: created.properties?.name,
      domain: created.properties?.domain,
      industry: created.properties?.industry,
      phone: created.properties?.phone,
      city: created.properties?.city,
      country: created.properties?.country,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
      archived: created.archived,
    };
  }

  async updateCompany(companyId: string, input: {
    name?: string;
    domain?: string;
    industry?: string;
    phone?: string;
    city?: string;
    country?: string;
  }): Promise<HubSpotCompany> {
    const updated = await this.request<{
      id?: string;
      properties?: Record<string, string>;
      createdAt?: string;
      updatedAt?: string;
      archived?: boolean;
    }>(`/crm/v3/objects/companies/${encodeURIComponent(companyId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ properties: input }),
    });

    if (!updated.id) {
      throw new ConnectorError("upstream", "HubSpot update company returned no id", 502);
    }

    return {
      id: String(updated.id),
      name: updated.properties?.name,
      domain: updated.properties?.domain,
      industry: updated.properties?.industry,
      phone: updated.properties?.phone,
      city: updated.properties?.city,
      country: updated.properties?.country,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
      archived: updated.archived,
    };
  }

  async listDeals(limit = 100): Promise<HubSpotDeal[]> {
    return this.listObjects<{
      id?: string;
      properties?: Record<string, string>;
      createdAt?: string;
      updatedAt?: string;
      archived?: boolean;
    }, HubSpotDeal>(
      "/crm/v3/objects/deals?properties=dealname,amount,dealstage,pipeline,closedate",
      limit,
      (item) => item.id ? ({
        id: String(item.id),
        dealname: item.properties?.dealname,
        amount: item.properties?.amount,
        dealstage: item.properties?.dealstage,
        pipeline: item.properties?.pipeline,
        closedate: item.properties?.closedate,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        archived: item.archived,
      }) : null
    );
  }

  async createDeal(input: {
    dealname: string;
    amount?: string;
    dealstage?: string;
    pipeline?: string;
    closedate?: string;
  }): Promise<HubSpotDeal> {
    const created = await this.request<{
      id?: string;
      properties?: Record<string, string>;
      createdAt?: string;
      updatedAt?: string;
      archived?: boolean;
    }>("/crm/v3/objects/deals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ properties: input }),
    });

    if (!created.id) {
      throw new ConnectorError("upstream", "HubSpot create deal returned no id", 502);
    }

    return {
      id: String(created.id),
      dealname: created.properties?.dealname,
      amount: created.properties?.amount,
      dealstage: created.properties?.dealstage,
      pipeline: created.properties?.pipeline,
      closedate: created.properties?.closedate,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
      archived: created.archived,
    };
  }

  async updateDeal(dealId: string, input: {
    dealname?: string;
    amount?: string;
    dealstage?: string;
    pipeline?: string;
    closedate?: string;
  }): Promise<HubSpotDeal> {
    const updated = await this.request<{
      id?: string;
      properties?: Record<string, string>;
      createdAt?: string;
      updatedAt?: string;
      archived?: boolean;
    }>(`/crm/v3/objects/deals/${encodeURIComponent(dealId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ properties: input }),
    });

    if (!updated.id) {
      throw new ConnectorError("upstream", "HubSpot update deal returned no id", 502);
    }

    return {
      id: String(updated.id),
      dealname: updated.properties?.dealname,
      amount: updated.properties?.amount,
      dealstage: updated.properties?.dealstage,
      pipeline: updated.properties?.pipeline,
      closedate: updated.properties?.closedate,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
      archived: updated.archived,
    };
  }

  getAuthMethod(): HubSpotAuthMethod {
    return this.authMethod;
  }
}
