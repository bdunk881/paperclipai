import { ConnectorError, ConnectorErrorType } from "./types";

const SLACK_API_BASE = "https://slack.com/api";
const MAX_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseErrorType(status: number, bodyText: string): ConnectorErrorType {
  if (status === 401 || status === 403) return "auth";
  if (status === 429 || bodyText.includes("rate_limited")) return "rate-limit";
  if (status >= 500) return "upstream";
  if (status >= 400) return "schema";
  return "network";
}

export class SlackClient {
  private readonly token: string;

  constructor(token: string) {
    this.token = token;
  }

  private async request(path: string, init: RequestInit = {}, attempt = 0): Promise<unknown> {
    const url = `${SLACK_API_BASE}${path}`;

    try {
      const response = await fetch(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json; charset=utf-8",
          ...(init.headers ?? {}),
        },
      });

      if (response.status === 429) {
        if (attempt >= MAX_RETRIES) {
          throw new ConnectorError("rate-limit", "Slack API rate limit exceeded", 429);
        }

        const retryAfterSeconds = Number(response.headers.get("Retry-After") ?? "1");
        await sleep(Math.max(1, retryAfterSeconds) * 1000);
        return this.request(path, init, attempt + 1);
      }

      const text = await response.text();
      let data: { ok?: boolean; error?: string; [key: string]: unknown } = {};
      if (text.trim().length > 0) {
        data = JSON.parse(text) as typeof data;
      }

      if (!response.ok) {
        const type = parseErrorType(response.status, text);
        throw new ConnectorError(type, `Slack HTTP ${response.status}: ${text}`, response.status);
      }

      if (!data.ok) {
        const errorText = String(data.error ?? "unknown_error");
        const type = errorText === "invalid_auth" ? "auth" : "upstream";
        const statusCode = type === "auth" ? 401 : 502;

        if (type === "upstream" && attempt < MAX_RETRIES) {
          await sleep(250 * Math.pow(2, attempt));
          return this.request(path, init, attempt + 1);
        }

        throw new ConnectorError(type, `Slack API error: ${errorText}`, statusCode);
      }

      return data;
    } catch (error) {
      if (error instanceof ConnectorError) {
        throw error;
      }

      if (attempt < MAX_RETRIES) {
        await sleep(250 * Math.pow(2, attempt));
        return this.request(path, init, attempt + 1);
      }

      throw new ConnectorError(
        "network",
        `Slack network request failed: ${error instanceof Error ? error.message : String(error)}`,
        502
      );
    }
  }

  async authTest(): Promise<{ teamId: string; teamName?: string; botUserId?: string }> {
    const data = await this.request("/auth.test", { method: "POST" }) as {
      team_id: string;
      team?: string;
      user_id?: string;
    };

    return {
      teamId: String(data.team_id),
      teamName: data.team,
      botUserId: data.user_id,
    };
  }

  async listConversations(limit = 100): Promise<Array<{ id: string; name: string; isPrivate: boolean }>> {
    const results: Array<{ id: string; name: string; isPrivate: boolean }> = [];
    let cursor: string | undefined;

    do {
      const params = new URLSearchParams({
        limit: String(Math.min(200, Math.max(1, limit))),
        types: "public_channel,private_channel",
      });
      if (cursor) {
        params.set("cursor", cursor);
      }

      const data = await this.request(`/conversations.list?${params.toString()}`, {
        method: "GET",
      }) as {
        channels?: Array<{ id: string; name: string; is_private: boolean }>;
        response_metadata?: { next_cursor?: string };
      };

      const channels = Array.isArray(data.channels) ? data.channels : [];
      for (const channel of channels) {
        results.push({
          id: String(channel.id),
          name: String(channel.name),
          isPrivate: Boolean(channel.is_private),
        });
      }

      cursor = data.response_metadata?.next_cursor || undefined;
    } while (cursor);

    return results;
  }

  async listChannelMessages(
    channel: string,
    limit = 100
  ): Promise<Array<{ ts: string; text: string; user?: string }>> {
    const results: Array<{ ts: string; text: string; user?: string }> = [];
    let cursor: string | undefined;

    do {
      const params = new URLSearchParams({
        channel,
        limit: String(Math.min(200, Math.max(1, limit))),
      });
      if (cursor) {
        params.set("cursor", cursor);
      }

      const data = await this.request(`/conversations.history?${params.toString()}`, {
        method: "GET",
      }) as {
        messages?: Array<{ ts: string; text?: string; user?: string }>;
        response_metadata?: { next_cursor?: string };
      };

      const messages = Array.isArray(data.messages) ? data.messages : [];
      for (const message of messages) {
        results.push({
          ts: String(message.ts),
          text: typeof message.text === "string" ? message.text : "",
          user: typeof message.user === "string" ? message.user : undefined,
        });
      }

      cursor = data.response_metadata?.next_cursor || undefined;
    } while (cursor);

    return results;
  }
}
