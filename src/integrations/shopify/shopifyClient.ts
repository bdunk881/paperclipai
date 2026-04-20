import { ConnectorError, ConnectorErrorType } from "./types";

const MAX_RETRIES = 4;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseErrorType(status: number, bodyText: string): ConnectorErrorType {
  if (status === 401 || status === 403) return "auth";
  if (status === 429 || bodyText.includes("Too Many Requests") || bodyText.includes("throttled")) return "rate-limit";
  if (status >= 500) return "upstream";
  if (status >= 400) return "schema";
  return "network";
}

function extractNextPageInfo(linkHeader: string | null): string | null {
  if (!linkHeader) return null;

  const segments = linkHeader.split(",");
  for (const segment of segments) {
    if (!segment.includes('rel="next"')) continue;
    const start = segment.indexOf("<");
    const end = segment.indexOf(">", start + 1);
    if (start === -1 || end === -1) continue;

    const url = new URL(segment.slice(start + 1, end));
    const pageInfo = url.searchParams.get("page_info");
    if (pageInfo) return pageInfo;
  }

  return null;
}

export class ShopifyClient {
  private token: string;
  private shopDomain: string;

  constructor(params: { token: string; shopDomain: string }) {
    this.token = params.token;
    this.shopDomain = params.shopDomain;
  }

  private get baseUrl(): string {
    const version = process.env.SHOPIFY_API_VERSION ?? "2024-10";
    return `https://${this.shopDomain}/admin/api/${version}`;
  }

  private async request(
    path: string,
    init: RequestInit = {},
    attempt = 0
  ): Promise<{ data: any; headers: Headers }> {
    const url = `${this.baseUrl}${path}`;

    try {
      const response = await fetch(url, {
        ...init,
        headers: {
          "X-Shopify-Access-Token": this.token,
          "Content-Type": "application/json",
          ...(init.headers ?? {}),
        },
      });

      const rawText = await response.text();
      let data: any = {};
      if (rawText.trim()) {
        data = JSON.parse(rawText);
      }

      if (response.status === 429) {
        if (attempt >= MAX_RETRIES) {
          throw new ConnectorError("rate-limit", "Shopify API rate limit exceeded", 429);
        }

        const retryAfterSeconds = Number(response.headers.get("Retry-After") ?? "1");
        await sleep(Math.max(1, retryAfterSeconds) * 1000);
        return this.request(path, init, attempt + 1);
      }

      if (!response.ok) {
        const type = parseErrorType(response.status, rawText);
        const message = data?.errors
          ? `Shopify API error: ${JSON.stringify(data.errors)}`
          : `Shopify HTTP ${response.status}: ${rawText || response.statusText}`;

        if ((type === "upstream" || type === "network") && attempt < MAX_RETRIES) {
          await sleep(250 * Math.pow(2, attempt));
          return this.request(path, init, attempt + 1);
        }

        throw new ConnectorError(type, message, response.status);
      }

      return { data, headers: response.headers };
    } catch (error) {
      if (error instanceof ConnectorError) throw error;

      if (attempt < MAX_RETRIES) {
        await sleep(250 * Math.pow(2, attempt));
        return this.request(path, init, attempt + 1);
      }

      throw new ConnectorError(
        "network",
        `Shopify network request failed: ${error instanceof Error ? error.message : String(error)}`,
        502
      );
    }
  }

  async shop(): Promise<{ id: number; name: string; domain: string }> {
    const { data } = await this.request("/shop.json", { method: "GET" });
    return {
      id: Number(data.shop?.id),
      name: String(data.shop?.name ?? ""),
      domain: String(data.shop?.domain ?? this.shopDomain),
    };
  }

  async listProducts(limit = 50): Promise<Array<{ id: number; title: string; status?: string }>> {
    const items: Array<{ id: number; title: string; status?: string }> = [];
    let pageInfo: string | null = null;

    do {
      const params = new URLSearchParams({ limit: String(Math.min(250, Math.max(1, limit))) });
      if (pageInfo) params.set("page_info", pageInfo);
      const { data, headers } = await this.request(`/products.json?${params.toString()}`, { method: "GET" });

      const products = Array.isArray(data.products) ? data.products : [];
      for (const product of products) {
        items.push({
          id: Number(product.id),
          title: String(product.title ?? ""),
          status: typeof product.status === "string" ? product.status : undefined,
        });
      }

      pageInfo = extractNextPageInfo(headers.get("link"));
    } while (pageInfo);

    return items;
  }

  async createProduct(input: { title: string; body_html?: string; vendor?: string; product_type?: string }): Promise<{ id: number; title: string; status?: string }> {
    const { data } = await this.request("/products.json", {
      method: "POST",
      body: JSON.stringify({ product: input }),
    });

    const product = data.product;
    return {
      id: Number(product.id),
      title: String(product.title ?? ""),
      status: typeof product.status === "string" ? product.status : undefined,
    };
  }

  async updateProduct(productId: string, patch: Record<string, unknown>): Promise<{ id: number; title: string; status?: string }> {
    const { data } = await this.request(`/products/${encodeURIComponent(productId)}.json`, {
      method: "PUT",
      body: JSON.stringify({ product: { id: Number(productId), ...patch } }),
    });

    const product = data.product;
    return {
      id: Number(product.id),
      title: String(product.title ?? ""),
      status: typeof product.status === "string" ? product.status : undefined,
    };
  }

  async listOrders(limit = 50): Promise<Array<{ id: number; name: string; financialStatus?: string; fulfillmentStatus?: string }>> {
    const items: Array<{ id: number; name: string; financialStatus?: string; fulfillmentStatus?: string }> = [];
    let pageInfo: string | null = null;

    do {
      const params = new URLSearchParams({
        limit: String(Math.min(250, Math.max(1, limit))),
        status: "any",
      });
      if (pageInfo) params.set("page_info", pageInfo);

      const { data, headers } = await this.request(`/orders.json?${params.toString()}`, { method: "GET" });
      const orders = Array.isArray(data.orders) ? data.orders : [];
      for (const order of orders) {
        items.push({
          id: Number(order.id),
          name: String(order.name ?? ""),
          financialStatus: typeof order.financial_status === "string" ? order.financial_status : undefined,
          fulfillmentStatus: typeof order.fulfillment_status === "string" ? order.fulfillment_status : undefined,
        });
      }

      pageInfo = extractNextPageInfo(headers.get("link"));
    } while (pageInfo);

    return items;
  }

  async listCustomers(limit = 50): Promise<Array<{ id: number; email?: string; firstName?: string; lastName?: string }>> {
    const items: Array<{ id: number; email?: string; firstName?: string; lastName?: string }> = [];
    let pageInfo: string | null = null;

    do {
      const params = new URLSearchParams({
        limit: String(Math.min(250, Math.max(1, limit))),
      });
      if (pageInfo) params.set("page_info", pageInfo);

      const { data, headers } = await this.request(`/customers.json?${params.toString()}`, { method: "GET" });
      const customers = Array.isArray(data.customers) ? data.customers : [];
      for (const customer of customers) {
        items.push({
          id: Number(customer.id),
          email: typeof customer.email === "string" ? customer.email : undefined,
          firstName: typeof customer.first_name === "string" ? customer.first_name : undefined,
          lastName: typeof customer.last_name === "string" ? customer.last_name : undefined,
        });
      }

      pageInfo = extractNextPageInfo(headers.get("link"));
    } while (pageInfo);

    return items;
  }

  async subscribeWebhook(input: { topic: string; address: string; format?: "json" | "xml" }): Promise<{ id: number; topic: string; address: string }> {
    const { data } = await this.request("/webhooks.json", {
      method: "POST",
      body: JSON.stringify({
        webhook: {
          topic: input.topic,
          address: input.address,
          format: input.format ?? "json",
        },
      }),
    });

    const webhook = data.webhook;
    return {
      id: Number(webhook.id),
      topic: String(webhook.topic ?? ""),
      address: String(webhook.address ?? ""),
    };
  }
}
