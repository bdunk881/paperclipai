import {
  ConnectorError,
  ConnectorErrorType,
  StripeAccountSummary,
  StripeAuthMethod,
  StripeCustomer,
  StripeInvoice,
  StripePaymentIntent,
  StripeSubscription,
} from "./types";
import {
  classifyStandardErrorType,
  isStandardRetryable,
  resolveRetryDelayMs,
  sleep,
} from "../shared/retryPolicy";

const STRIPE_API_BASE = (process.env.STRIPE_API_BASE_URL ?? "https://api.stripe.com/v1").replace(/\/$/, "");
const MAX_RETRIES = 4;

function parseErrorType(status: number, text: string): ConnectorErrorType {
  return classifyStandardErrorType(status, text);
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

function appendFormValue(params: URLSearchParams, key: string, value: unknown): void {
  if (value === undefined || value === null) {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => appendFormValue(params, `${key}[${index}]`, entry));
    return;
  }

  if (typeof value === "object") {
    Object.entries(value as Record<string, unknown>).forEach(([childKey, childValue]) => {
      appendFormValue(params, `${key}[${childKey}]`, childValue);
    });
    return;
  }

  if (typeof value === "boolean") {
    params.append(key, value ? "true" : "false");
    return;
  }

  params.append(key, String(value));
}

function toQueryString(input: Record<string, unknown>): string {
  const params = new URLSearchParams();
  Object.entries(input).forEach(([key, value]) => appendFormValue(params, key, value));
  return params.toString();
}

interface StripeListResponse<T> {
  object: "list";
  data: T[];
  has_more: boolean;
}

interface StripeAccountResponse {
  id: string;
  email?: string | null;
  business_profile?: {
    name?: string | null;
  };
  settings?: {
    dashboard?: {
      display_name?: string | null;
    };
  };
  display_name?: string | null;
  livemode?: boolean;
}

interface StripeCustomerResponse {
  id: string;
  email?: string | null;
  name?: string | null;
  phone?: string | null;
  currency?: string | null;
  created: number;
  delinquent?: boolean | null;
  livemode: boolean;
}

interface StripeSubscriptionItemPriceResponse {
  id?: string;
}

interface StripeSubscriptionItemResponse {
  id: string;
  price?: StripeSubscriptionItemPriceResponse | null;
  quantity?: number | null;
  current_period_start?: number | null;
  current_period_end?: number | null;
}

interface StripeSubscriptionResponse {
  id: string;
  customer?: string | { id: string } | null;
  status: string;
  cancel_at_period_end: boolean;
  created: number;
  livemode: boolean;
  items?: {
    data: StripeSubscriptionItemResponse[];
  };
}

interface StripeInvoiceResponse {
  id: string;
  customer?: string | { id: string } | null;
  status?: string | null;
  currency?: string | null;
  total?: number | null;
  hosted_invoice_url?: string | null;
  created: number;
  livemode: boolean;
}

interface StripePaymentIntentResponse {
  id: string;
  customer?: string | { id: string } | null;
  status: string;
  amount: number;
  currency: string;
  description?: string | null;
  created: number;
  livemode: boolean;
}

function toIso(timestampSeconds: number | null | undefined): string | undefined {
  if (!timestampSeconds || !Number.isFinite(timestampSeconds)) {
    return undefined;
  }

  return new Date(timestampSeconds * 1000).toISOString();
}

function customerIdOf(value: string | { id: string } | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return typeof value === "string" ? value : value.id;
}

function buildAccountName(account: StripeAccountResponse): string | undefined {
  const candidates = [
    account.business_profile?.name,
    account.settings?.dashboard?.display_name,
    account.display_name,
    account.email,
  ];

  return candidates.find((value): value is string => Boolean(value && value.trim()))?.trim();
}

export class StripeConnectorClient {
  private readonly token: string;

  private readonly authMethod: StripeAuthMethod;

  constructor(token: string, authMethod: StripeAuthMethod) {
    this.token = token;
    this.authMethod = authMethod;
  }

  private headers(extra?: RequestInit["headers"]): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      ...((extra as Record<string, string> | undefined) ?? {}),
    };
  }

  private async request<T>(
    path: string,
    init?: RequestInit,
    formData?: Record<string, unknown>,
    attempt = 0
  ): Promise<T> {
    try {
      const headers = this.headers(init?.headers);
      let body = init?.body;

      if (formData) {
        headers["Content-Type"] = "application/x-www-form-urlencoded";
        body = toQueryString(formData);
      }

      const response = await fetch(`${STRIPE_API_BASE}${path}`, {
        ...init,
        headers,
        body,
      });

      if (response.status === 429) {
        if (attempt >= MAX_RETRIES) {
          throw new ConnectorError("rate-limit", "Stripe API rate limit exceeded", 429);
        }
        await sleep(resolveRetryDelayMs({ attempt, headers: response.headers }));
        return this.request<T>(path, init, formData, attempt + 1);
      }

      const text = await response.text();
      if (!response.ok) {
        const type = parseErrorType(response.status, text);
        const parsed = safeJsonParse(text) as { error?: { message?: string } };
        const detail = parsed.error?.message ?? text ?? response.statusText;
        throw new ConnectorError(type, `Stripe HTTP ${response.status}: ${detail}`, response.status);
      }

      return safeJsonParse(text) as T;
    } catch (error) {
      if (error instanceof ConnectorError) {
        if (isStandardRetryable(error.type) && attempt < MAX_RETRIES) {
          await sleep(resolveRetryDelayMs({ attempt }));
          return this.request<T>(path, init, formData, attempt + 1);
        }
        throw error;
      }

      if (attempt < MAX_RETRIES) {
        await sleep(resolveRetryDelayMs({ attempt }));
        return this.request<T>(path, init, formData, attempt + 1);
      }

      throw new ConnectorError(
        "network",
        `Stripe network request failed: ${error instanceof Error ? error.message : String(error)}`,
        502
      );
    }
  }

  private async listAll<TItem, TMapped>(
    path: string,
    query: Record<string, unknown>,
    mapItem: (item: TItem) => TMapped
  ): Promise<TMapped[]> {
    const pageSizeRaw = typeof query.limit === "number" ? query.limit : 100;
    const pageSize = Math.min(Math.max(Number(pageSizeRaw) || 100, 1), 100);
    const baseQuery = { ...query, limit: pageSize };
    const items: TMapped[] = [];
    let startingAfter: string | undefined;

    while (true) {
      const currentQuery = startingAfter
        ? { ...baseQuery, starting_after: startingAfter }
        : baseQuery;
      const queryString = toQueryString(currentQuery);
      const response = await this.request<StripeListResponse<TItem>>(`/${path}?${queryString}`, {
        method: "GET",
      });

      for (const item of response.data) {
        items.push(mapItem(item));
      }

      if (!response.has_more || response.data.length === 0) {
        return items;
      }

      const last = response.data[response.data.length - 1] as { id?: string };
      if (!last.id) {
        return items;
      }
      startingAfter = last.id;
    }
  }

  async viewer(): Promise<StripeAccountSummary> {
    const account = await this.request<StripeAccountResponse>("/account", { method: "GET" });
    return {
      accountId: account.id,
      accountName: buildAccountName(account),
      accountEmail: account.email ?? undefined,
      livemode: Boolean(account.livemode),
      scopes: this.authMethod === "api_key" ? ["full_access"] : [],
    };
  }

  async listCustomers(limit = 100): Promise<StripeCustomer[]> {
    return this.listAll<StripeCustomerResponse, StripeCustomer>(
      "customers",
      { limit },
      (customer) => ({
        id: customer.id,
        email: customer.email ?? undefined,
        name: customer.name ?? undefined,
        phone: customer.phone ?? undefined,
        currency: customer.currency ?? undefined,
        createdAt: new Date(customer.created * 1000).toISOString(),
        delinquent: customer.delinquent ?? undefined,
        livemode: customer.livemode,
      })
    );
  }

  async createCustomer(input: {
    email?: string;
    name?: string;
    phone?: string;
    description?: string;
    metadata?: Record<string, string>;
  }): Promise<StripeCustomer> {
    const customer = await this.request<StripeCustomerResponse>(
      "/customers",
      { method: "POST" },
      input
    );

    return {
      id: customer.id,
      email: customer.email ?? undefined,
      name: customer.name ?? undefined,
      phone: customer.phone ?? undefined,
      currency: customer.currency ?? undefined,
      createdAt: new Date(customer.created * 1000).toISOString(),
      delinquent: customer.delinquent ?? undefined,
      livemode: customer.livemode,
    };
  }

  async updateCustomer(
    customerId: string,
    input: {
      email?: string;
      name?: string;
      phone?: string;
      description?: string;
      metadata?: Record<string, string>;
    }
  ): Promise<StripeCustomer> {
    const customer = await this.request<StripeCustomerResponse>(
      `/customers/${customerId}`,
      { method: "POST" },
      input
    );

    return {
      id: customer.id,
      email: customer.email ?? undefined,
      name: customer.name ?? undefined,
      phone: customer.phone ?? undefined,
      currency: customer.currency ?? undefined,
      createdAt: new Date(customer.created * 1000).toISOString(),
      delinquent: customer.delinquent ?? undefined,
      livemode: customer.livemode,
    };
  }

  async listSubscriptions(params: {
    customerId?: string;
    status?: string;
    limit?: number;
  }): Promise<StripeSubscription[]> {
    return this.listAll<StripeSubscriptionResponse, StripeSubscription>(
      "subscriptions",
      {
        customer: params.customerId,
        status: params.status ?? "all",
        limit: params.limit ?? 100,
      },
      (subscription) => {
        const firstItem = subscription.items?.data[0];
        return {
          id: subscription.id,
          customerId: customerIdOf(subscription.customer),
          status: subscription.status,
          priceId: firstItem?.price?.id,
          quantity: firstItem?.quantity ?? undefined,
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
          currentPeriodStart: toIso(firstItem?.current_period_start),
          currentPeriodEnd: toIso(firstItem?.current_period_end),
          createdAt: new Date(subscription.created * 1000).toISOString(),
          livemode: subscription.livemode,
        };
      }
    );
  }

  async createSubscription(input: {
    customerId: string;
    priceId: string;
    quantity?: number;
    trialPeriodDays?: number;
    metadata?: Record<string, string>;
  }): Promise<StripeSubscription> {
    const subscription = await this.request<StripeSubscriptionResponse>(
      "/subscriptions",
      { method: "POST" },
      {
        customer: input.customerId,
        items: [{ price: input.priceId, quantity: input.quantity ?? 1 }],
        trial_period_days: input.trialPeriodDays,
        metadata: input.metadata,
      }
    );

    const firstItem = subscription.items?.data[0];
    return {
      id: subscription.id,
      customerId: customerIdOf(subscription.customer),
      status: subscription.status,
      priceId: firstItem?.price?.id,
      quantity: firstItem?.quantity ?? undefined,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      currentPeriodStart: toIso(firstItem?.current_period_start),
      currentPeriodEnd: toIso(firstItem?.current_period_end),
      createdAt: new Date(subscription.created * 1000).toISOString(),
      livemode: subscription.livemode,
    };
  }

  async updateSubscription(
    subscriptionId: string,
    input: {
      priceId?: string;
      quantity?: number;
      cancelAtPeriodEnd?: boolean;
      metadata?: Record<string, string>;
    }
  ): Promise<StripeSubscription> {
    const existing = await this.request<StripeSubscriptionResponse>(`/subscriptions/${subscriptionId}`, {
      method: "GET",
    });
    const firstItem = existing.items?.data[0];
    const form: Record<string, unknown> = {
      cancel_at_period_end: input.cancelAtPeriodEnd,
      metadata: input.metadata,
    };

    if (firstItem && (input.priceId || input.quantity !== undefined)) {
      form.items = [{
        id: firstItem.id,
        price: input.priceId ?? firstItem.price?.id,
        quantity: input.quantity ?? firstItem.quantity ?? 1,
      }];
    }

    const subscription = await this.request<StripeSubscriptionResponse>(
      `/subscriptions/${subscriptionId}`,
      { method: "POST" },
      form
    );

    const nextItem = subscription.items?.data[0];
    return {
      id: subscription.id,
      customerId: customerIdOf(subscription.customer),
      status: subscription.status,
      priceId: nextItem?.price?.id,
      quantity: nextItem?.quantity ?? undefined,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      currentPeriodStart: toIso(nextItem?.current_period_start),
      currentPeriodEnd: toIso(nextItem?.current_period_end),
      createdAt: new Date(subscription.created * 1000).toISOString(),
      livemode: subscription.livemode,
    };
  }

  async listInvoices(params: {
    customerId?: string;
    status?: string;
    limit?: number;
  }): Promise<StripeInvoice[]> {
    return this.listAll<StripeInvoiceResponse, StripeInvoice>(
      "invoices",
      {
        customer: params.customerId,
        status: params.status,
        limit: params.limit ?? 100,
      },
      (invoice) => ({
        id: invoice.id,
        customerId: customerIdOf(invoice.customer),
        status: invoice.status ?? undefined,
        currency: invoice.currency ?? undefined,
        total: invoice.total ?? undefined,
        hostedInvoiceUrl: invoice.hosted_invoice_url ?? undefined,
        createdAt: new Date(invoice.created * 1000).toISOString(),
        livemode: invoice.livemode,
      })
    );
  }

  async createInvoice(input: {
    customerId: string;
    autoAdvance?: boolean;
    collectionMethod?: string;
    daysUntilDue?: number;
    metadata?: Record<string, string>;
  }): Promise<StripeInvoice> {
    const invoice = await this.request<StripeInvoiceResponse>(
      "/invoices",
      { method: "POST" },
      {
        customer: input.customerId,
        auto_advance: input.autoAdvance,
        collection_method: input.collectionMethod,
        days_until_due: input.daysUntilDue,
        metadata: input.metadata,
      }
    );

    return {
      id: invoice.id,
      customerId: customerIdOf(invoice.customer),
      status: invoice.status ?? undefined,
      currency: invoice.currency ?? undefined,
      total: invoice.total ?? undefined,
      hostedInvoiceUrl: invoice.hosted_invoice_url ?? undefined,
      createdAt: new Date(invoice.created * 1000).toISOString(),
      livemode: invoice.livemode,
    };
  }

  async updateInvoice(
    invoiceId: string,
    input: {
      autoAdvance?: boolean;
      collectionMethod?: string;
      daysUntilDue?: number;
      metadata?: Record<string, string>;
    }
  ): Promise<StripeInvoice> {
    const invoice = await this.request<StripeInvoiceResponse>(
      `/invoices/${invoiceId}`,
      { method: "POST" },
      {
        auto_advance: input.autoAdvance,
        collection_method: input.collectionMethod,
        days_until_due: input.daysUntilDue,
        metadata: input.metadata,
      }
    );

    return {
      id: invoice.id,
      customerId: customerIdOf(invoice.customer),
      status: invoice.status ?? undefined,
      currency: invoice.currency ?? undefined,
      total: invoice.total ?? undefined,
      hostedInvoiceUrl: invoice.hosted_invoice_url ?? undefined,
      createdAt: new Date(invoice.created * 1000).toISOString(),
      livemode: invoice.livemode,
    };
  }

  async deleteInvoice(invoiceId: string): Promise<boolean> {
    const invoice = await this.request<{ id: string; deleted?: boolean; status?: string }>(
      `/invoices/${invoiceId}`,
      { method: "DELETE" }
    );
    return invoice.deleted === true || invoice.status === "deleted";
  }

  async listPaymentIntents(params: {
    customerId?: string;
    status?: string;
    limit?: number;
  }): Promise<StripePaymentIntent[]> {
    return this.listAll<StripePaymentIntentResponse, StripePaymentIntent>(
      "payment_intents",
      {
        customer: params.customerId,
        limit: params.limit ?? 100,
      },
      (paymentIntent) => ({
        id: paymentIntent.id,
        customerId: customerIdOf(paymentIntent.customer),
        status: paymentIntent.status,
        amount: paymentIntent.amount,
        currency: paymentIntent.currency,
        description: paymentIntent.description ?? undefined,
        createdAt: new Date(paymentIntent.created * 1000).toISOString(),
        livemode: paymentIntent.livemode,
      })
    ).then((items) =>
      params.status ? items.filter((item) => item.status === params.status) : items
    );
  }

  async createPaymentIntent(input: {
    amount: number;
    currency: string;
    customerId?: string;
    description?: string;
    confirm?: boolean;
    paymentMethodId?: string;
    metadata?: Record<string, string>;
  }): Promise<StripePaymentIntent> {
    const paymentIntent = await this.request<StripePaymentIntentResponse>(
      "/payment_intents",
      { method: "POST" },
      {
        amount: input.amount,
        currency: input.currency,
        customer: input.customerId,
        description: input.description,
        confirm: input.confirm,
        payment_method: input.paymentMethodId,
        metadata: input.metadata,
      }
    );

    return {
      id: paymentIntent.id,
      customerId: customerIdOf(paymentIntent.customer),
      status: paymentIntent.status,
      amount: paymentIntent.amount,
      currency: paymentIntent.currency,
      description: paymentIntent.description ?? undefined,
      createdAt: new Date(paymentIntent.created * 1000).toISOString(),
      livemode: paymentIntent.livemode,
    };
  }

  async updatePaymentIntent(
    paymentIntentId: string,
    input: {
      amount?: number;
      description?: string;
      metadata?: Record<string, string>;
    }
  ): Promise<StripePaymentIntent> {
    const paymentIntent = await this.request<StripePaymentIntentResponse>(
      `/payment_intents/${paymentIntentId}`,
      { method: "POST" },
      {
        amount: input.amount,
        description: input.description,
        metadata: input.metadata,
      }
    );

    return {
      id: paymentIntent.id,
      customerId: customerIdOf(paymentIntent.customer),
      status: paymentIntent.status,
      amount: paymentIntent.amount,
      currency: paymentIntent.currency,
      description: paymentIntent.description ?? undefined,
      createdAt: new Date(paymentIntent.created * 1000).toISOString(),
      livemode: paymentIntent.livemode,
    };
  }

  async cancelPaymentIntent(paymentIntentId: string): Promise<StripePaymentIntent> {
    const paymentIntent = await this.request<StripePaymentIntentResponse>(
      `/payment_intents/${paymentIntentId}/cancel`,
      { method: "POST" }
    );

    return {
      id: paymentIntent.id,
      customerId: customerIdOf(paymentIntent.customer),
      status: paymentIntent.status,
      amount: paymentIntent.amount,
      currency: paymentIntent.currency,
      description: paymentIntent.description ?? undefined,
      createdAt: new Date(paymentIntent.created * 1000).toISOString(),
      livemode: paymentIntent.livemode,
    };
  }
}
