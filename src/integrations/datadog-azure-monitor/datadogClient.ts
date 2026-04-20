import { ConnectorError, ConnectorErrorType } from "./types";

const DEFAULT_DATADOG_SITE = "datadoghq.com";
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

interface DatadogMetricSeries {
  metric?: string;
  pointlist?: Array<[number, number | null]>;
  scope?: string;
}

interface DatadogQueryResponse {
  series?: DatadogMetricSeries[];
}

export class DatadogClient {
  private readonly apiKey: string;
  private readonly appKey?: string;
  private readonly site: string;

  constructor(params: { apiKey: string; appKey?: string; site?: string }) {
    this.apiKey = params.apiKey;
    this.appKey = params.appKey;
    this.site = params.site?.trim() || DEFAULT_DATADOG_SITE;
  }

  private getBaseUrl(): string {
    return `https://api.${this.site}`;
  }

  private async request<T>(
    path: string,
    query: Record<string, string> = {},
    attempt = 0
  ): Promise<T> {
    const url = new URL(`${this.getBaseUrl()}${path}`);
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }

    const headers: Record<string, string> = {
      Accept: "application/json",
      "DD-API-KEY": this.apiKey,
    };

    if (this.appKey) {
      headers["DD-APPLICATION-KEY"] = this.appKey;
    }

    try {
      const response = await fetch(url.toString(), {
        method: "GET",
        headers,
      });

      if (response.status === 429) {
        if (attempt >= MAX_RETRIES) {
          throw new ConnectorError("rate-limit", "Datadog rate limit exceeded", 429);
        }

        const retryAfterSeconds = Number(response.headers.get("Retry-After") ?? "1");
        await sleep(Math.max(1, retryAfterSeconds) * 1000);
        return this.request<T>(path, query, attempt + 1);
      }

      const text = await response.text();
      const json = text.trim() ? JSON.parse(text) as T : ({} as T);

      if (!response.ok) {
        const type = parseErrorType(response.status, text);
        throw new ConnectorError(type, `Datadog HTTP ${response.status}`, response.status);
      }

      return json;
    } catch (error) {
      if (error instanceof ConnectorError) {
        const retryable = error.type === "upstream" || error.type === "network";
        if (retryable && attempt < MAX_RETRIES) {
          await sleep(250 * Math.pow(2, attempt));
          return this.request<T>(path, query, attempt + 1);
        }
        throw error;
      }

      if (attempt < MAX_RETRIES) {
        await sleep(250 * Math.pow(2, attempt));
        return this.request<T>(path, query, attempt + 1);
      }

      throw new ConnectorError(
        "network",
        `Datadog request failed: ${error instanceof Error ? error.message : String(error)}`,
        502
      );
    }
  }

  async validate(): Promise<{ valid: boolean }> {
    const response = await this.request<{ valid?: boolean }>("/api/v1/validate");
    return { valid: response.valid === true };
  }

  async queryMetrics(params: {
    query: string;
    from: number;
    to: number;
  }): Promise<Array<{ metric?: string; scope?: string; points: Array<[number, number | null]> }>> {
    const response = await this.request<DatadogQueryResponse>("/api/v1/query", {
      query: params.query,
      from: String(params.from),
      to: String(params.to),
    });

    return (response.series ?? []).map((series) => ({
      metric: typeof series.metric === "string" ? series.metric : undefined,
      scope: typeof series.scope === "string" ? series.scope : undefined,
      points: Array.isArray(series.pointlist) ? series.pointlist : [],
    }));
  }
}
