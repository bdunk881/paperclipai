import { ConnectorError, ConnectorErrorType } from "./types";

const ARM_BASE_URL = "https://management.azure.com";
const MAX_RETRIES = 4;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseErrorType(status: number, text: string): ConnectorErrorType {
  if (status === 401 || status === 403) return "auth";
  if (status === 429 || /rate.?limit|too many/i.test(text)) return "rate-limit";
  if (status >= 500) return "upstream";
  if (status >= 400) return "schema";
  return "network";
}

interface ArmCollection<T> {
  value?: T[];
  nextLink?: string;
}

export class AzureMonitorClient {
  private readonly token: string;

  constructor(token: string) {
    this.token = token;
  }

  private async request<T>(pathOrUrl: string, attempt = 0): Promise<T> {
    const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${ARM_BASE_URL}${pathOrUrl}`;

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/json",
        },
      });

      if (response.status === 429) {
        if (attempt >= MAX_RETRIES) {
          throw new ConnectorError("rate-limit", "Azure Monitor rate limit exceeded", 429);
        }

        const retryAfterSeconds = Number(response.headers.get("Retry-After") ?? "1");
        await sleep(Math.max(1, retryAfterSeconds) * 1000);
        return this.request<T>(pathOrUrl, attempt + 1);
      }

      const text = await response.text();
      const json = text.trim() ? JSON.parse(text) as T : ({} as T);

      if (!response.ok) {
        const type = parseErrorType(response.status, text);
        throw new ConnectorError(type, `Azure Monitor HTTP ${response.status}`, response.status);
      }

      return json;
    } catch (error) {
      if (error instanceof ConnectorError) {
        const retryable = error.type === "upstream" || error.type === "network";
        if (retryable && attempt < MAX_RETRIES) {
          await sleep(250 * Math.pow(2, attempt));
          return this.request<T>(pathOrUrl, attempt + 1);
        }
        throw error;
      }

      if (attempt < MAX_RETRIES) {
        await sleep(250 * Math.pow(2, attempt));
        return this.request<T>(pathOrUrl, attempt + 1);
      }

      throw new ConnectorError(
        "network",
        `Azure Monitor request failed: ${error instanceof Error ? error.message : String(error)}`,
        502
      );
    }
  }

  private async listAllPages<T>(path: string): Promise<T[]> {
    const results: T[] = [];
    let next: string | undefined = path;

    while (next) {
      const page: ArmCollection<T> = await this.request<ArmCollection<T>>(next);
      for (const item of page.value ?? []) {
        results.push(item);
      }
      next = page.nextLink;
    }

    return results;
  }

  async listSubscriptions(): Promise<Array<{ subscriptionId: string; displayName?: string; state?: string }>> {
    const subscriptions = await this.listAllPages<{ subscriptionId: string; displayName?: string; state?: string }>(
      "/subscriptions?api-version=2020-01-01"
    );

    return subscriptions.map((subscription) => ({
      subscriptionId: String(subscription.subscriptionId),
      displayName: typeof subscription.displayName === "string" ? subscription.displayName : undefined,
      state: typeof subscription.state === "string" ? subscription.state : undefined,
    }));
  }

  async listMetrics(params: {
    resourceId: string;
    metricName: string;
    timespan: string;
    interval?: string;
  }): Promise<Array<{ name: string; timeseriesCount: number }>> {
    const encodedResource = params.resourceId
      .split("/")
      .map((part) => encodeURIComponent(part))
      .join("/")
      .replace(/%2F/g, "/");

    const query: Record<string, string> = {
      "api-version": "2023-10-01",
      metricnames: params.metricName,
      timespan: params.timespan,
    };

    if (params.interval) {
      query.interval = params.interval;
    }

    const path = `${encodedResource}/providers/microsoft.insights/metrics`;
    const response = await this.request<{
      value?: Array<{
        name?: { value?: string };
        timeseries?: unknown[];
      }>;
    }>(`${path}?${new URLSearchParams(query).toString()}`);

    return (response.value ?? []).map((metric) => ({
      name: metric.name?.value ?? "unknown",
      timeseriesCount: Array.isArray(metric.timeseries) ? metric.timeseries.length : 0,
    }));
  }
}
