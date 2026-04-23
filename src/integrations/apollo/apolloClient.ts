import { APOLLO_API_BASE } from "../apollo-attio/config";
import { ApolloAuthMethod, ConnectorError, ConnectorErrorType } from "./types";

const MAX_RETRIES = 4;

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

function buildLabel(profile: Record<string, unknown>): string | undefined {
  const direct = profile.name;
  if (typeof direct === "string" && direct.trim()) {
    return direct.trim();
  }

  const firstName = typeof profile.first_name === "string" ? profile.first_name.trim() : "";
  const lastName = typeof profile.last_name === "string" ? profile.last_name.trim() : "";
  const fullName = `${firstName} ${lastName}`.trim();
  if (fullName) {
    return fullName;
  }

  const email = profile.email;
  return typeof email === "string" && email.trim() ? email.trim() : undefined;
}

export class ApolloClient {
  private readonly token: string;

  private readonly authMethod: ApolloAuthMethod;

  constructor(token: string, authMethod: ApolloAuthMethod) {
    this.token = token;
    this.authMethod = authMethod;
  }

  private headers(extra?: RequestInit["headers"]): Record<string, string> {
    return {
      "Content-Type": "application/json",
      ...(this.authMethod === "api_key"
        ? { "X-Api-Key": this.token }
        : { Authorization: `Bearer ${this.token}` }),
      ...((extra as Record<string, string> | undefined) ?? {}),
    };
  }

  private async request<T>(path: string, init?: RequestInit, attempt = 0): Promise<T> {
    try {
      const response = await fetch(`${APOLLO_API_BASE}${path}`, {
        ...init,
        headers: this.headers(init?.headers),
      });

      if (response.status === 429) {
        if (attempt >= MAX_RETRIES) {
          throw new ConnectorError("rate-limit", "Apollo API rate limit exceeded", 429);
        }

        const retryAfterSeconds = Number(response.headers.get("Retry-After") ?? "1");
        await sleep(Math.max(1, retryAfterSeconds) * 1000);
        return this.request<T>(path, init, attempt + 1);
      }

      const text = await response.text();
      if (!response.ok) {
        const type = parseErrorType(response.status, text);
        throw new ConnectorError(type, `Apollo HTTP ${response.status}: ${text || response.statusText}`, response.status);
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
        `Apollo network request failed: ${error instanceof Error ? error.message : String(error)}`,
        502
      );
    }
  }

  async viewer(): Promise<{ accountId: string; accountLabel?: string }> {
    if (this.authMethod === "api_key") {
      const health = await this.request<Record<string, unknown>>("/auth/health", {
        method: "GET",
        headers: { "Cache-Control": "no-cache" },
      });

      const authenticated = health.authenticated;
      const hasApiKey = health.api_key_found;
      if (authenticated === false || hasApiKey === false) {
        throw new ConnectorError("auth", "Apollo API key is invalid", 401);
      }

      return {
        accountId: "apollo-api-key",
        accountLabel: "Apollo API Key",
      };
    }

    const raw = await this.request<Record<string, unknown>>("/users/api_profile");
    const profile = (() => {
      const user = raw.user;
      return user && typeof user === "object" ? (user as Record<string, unknown>) : raw;
    })();

    const accountIdValue = profile.id ?? profile.user_id ?? profile.email ?? "apollo-oauth";
    return {
      accountId: String(accountIdValue),
      accountLabel: buildLabel(profile),
    };
  }
}
