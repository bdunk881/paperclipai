import { ConnectorError, ConnectorErrorType } from "./types";

const MAX_RETRIES = 4;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseErrorType(status: number, bodyText: string): ConnectorErrorType {
  if (status === 401 || status === 403) return "auth";
  if (status === 429 || bodyText.includes("RATE_LIMIT_EXCEEDED") || bodyText.includes("too many")) {
    return "rate-limit";
  }
  if (status >= 500) return "upstream";
  if (status >= 400) return "schema";
  return "network";
}

function normalizeBaseUri(baseUri: string): string {
  return baseUri
    .trim()
    .replace(/\/$/, "")
    .replace(/\/restapi$/i, "");
}

function getStartPosition(nextUri: string | undefined): string | null {
  if (!nextUri) return null;
  try {
    const parsed = new URL(nextUri, "https://example.invalid");
    return parsed.searchParams.get("start_position");
  } catch {
    return null;
  }
}

export class DocuSignClient {
  private token: string;
  private accountId: string;
  private baseUri: string;

  constructor(params: { token: string; accountId: string; baseUri: string }) {
    this.token = params.token;
    this.accountId = params.accountId;
    this.baseUri = normalizeBaseUri(params.baseUri);
  }

  private get apiBase(): string {
    return `${this.baseUri}/restapi/v2.1/accounts/${encodeURIComponent(this.accountId)}`;
  }

  private async request(
    path: string,
    init: RequestInit = {},
    attempt = 0
  ): Promise<any> {
    const url = `${this.apiBase}${path}`;

    try {
      const response = await fetch(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
          ...(init.headers ?? {}),
        },
      });

      if (response.status === 429) {
        if (attempt >= MAX_RETRIES) {
          throw new ConnectorError("rate-limit", "DocuSign API rate limit exceeded", 429);
        }

        const retryAfterSeconds = Number(response.headers.get("Retry-After") ?? "1");
        await sleep(Math.max(1, retryAfterSeconds) * 1000);
        return this.request(path, init, attempt + 1);
      }

      const text = await response.text();
      let data: any = {};
      if (text.trim()) {
        data = JSON.parse(text);
      }

      if (!response.ok) {
        const type = parseErrorType(response.status, text);
        const message = data?.message
          ? `DocuSign API error: ${data.message}`
          : `DocuSign HTTP ${response.status}: ${text || response.statusText}`;

        if ((type === "upstream" || type === "network") && attempt < MAX_RETRIES) {
          await sleep(250 * Math.pow(2, attempt));
          return this.request(path, init, attempt + 1);
        }

        throw new ConnectorError(type, message, response.status);
      }

      return data;
    } catch (error) {
      if (error instanceof ConnectorError) throw error;

      if (attempt < MAX_RETRIES) {
        await sleep(250 * Math.pow(2, attempt));
        return this.request(path, init, attempt + 1);
      }

      throw new ConnectorError(
        "network",
        `DocuSign network request failed: ${error instanceof Error ? error.message : String(error)}`,
        502
      );
    }
  }

  async getAccountInfo(): Promise<{ accountId: string; accountName?: string }> {
    const data = await this.request("", { method: "GET" });
    return {
      accountId: String(data.accountId ?? this.accountId),
      accountName: typeof data.accountName === "string" ? data.accountName : undefined,
    };
  }

  async listEnvelopes(limit = 100): Promise<Array<{ envelopeId: string; status?: string; emailSubject?: string }>> {
    const results: Array<{ envelopeId: string; status?: string; emailSubject?: string }> = [];
    const capped = String(Math.min(100, Math.max(1, limit)));
    let startPosition: string | null = "0";

    while (startPosition !== null) {
      const params = new URLSearchParams({
        from_date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        status: "any",
        count: capped,
      });
      if (startPosition) {
        params.set("start_position", startPosition);
      }

      const data = await this.request(`/envelopes?${params.toString()}`, { method: "GET" });
      const envelopes = Array.isArray(data.envelopes) ? data.envelopes : [];
      for (const envelope of envelopes) {
        results.push({
          envelopeId: String(envelope.envelopeId ?? ""),
          status: typeof envelope.status === "string" ? envelope.status : undefined,
          emailSubject: typeof envelope.emailSubject === "string" ? envelope.emailSubject : undefined,
        });
      }

      startPosition = getStartPosition(typeof data.nextUri === "string" ? data.nextUri : undefined);
    }

    return results;
  }

  async createEnvelope(input: Record<string, unknown>): Promise<{ envelopeId: string; status?: string; uri?: string }> {
    const data = await this.request("/envelopes", {
      method: "POST",
      body: JSON.stringify(input),
    });

    return {
      envelopeId: String(data.envelopeId ?? ""),
      status: typeof data.status === "string" ? data.status : undefined,
      uri: typeof data.uri === "string" ? data.uri : undefined,
    };
  }

  async getEnvelope(envelopeId: string): Promise<{ envelopeId: string; status?: string; emailSubject?: string }> {
    const data = await this.request(`/envelopes/${encodeURIComponent(envelopeId)}`, {
      method: "GET",
    });

    return {
      envelopeId: String(data.envelopeId ?? envelopeId),
      status: typeof data.status === "string" ? data.status : undefined,
      emailSubject: typeof data.emailSubject === "string" ? data.emailSubject : undefined,
    };
  }
}
