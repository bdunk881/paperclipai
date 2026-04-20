import { ConnectorError, ConnectorErrorType } from "./types";

const GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0";
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

interface GraphApiErrorPayload {
  error?: {
    code?: string;
    message?: string;
  };
}

interface GraphCollection<T> {
  value?: T[];
  "@odata.nextLink"?: string;
}

export class TeamsClient {
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  private async request<T>(pathOrUrl: string, attempt = 0): Promise<T> {
    const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${GRAPH_BASE_URL}${pathOrUrl}`;

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
          throw new ConnectorError("rate-limit", "Microsoft Graph rate limit exceeded", 429);
        }

        const retryAfterSeconds = Number(response.headers.get("Retry-After") ?? "1");
        await sleep(Math.max(1, retryAfterSeconds) * 1000);
        return this.request<T>(pathOrUrl, attempt + 1);
      }

      const text = await response.text();
      let json: T & GraphApiErrorPayload = {} as T & GraphApiErrorPayload;
      if (text.trim()) {
        json = JSON.parse(text) as T & GraphApiErrorPayload;
      }

      if (!response.ok) {
        const type = parseErrorType(response.status, text);
        const graphMessage = json.error?.message;
        throw new ConnectorError(type, graphMessage || `Microsoft Graph HTTP ${response.status}`, response.status);
      }

      return json as T;
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
        `Microsoft Graph request failed: ${error instanceof Error ? error.message : String(error)}`,
        502
      );
    }
  }

  private async listAllPages<T>(path: string): Promise<T[]> {
    const results: T[] = [];
    let next: string | undefined = path;

    while (next) {
      const page: GraphCollection<T> = await this.request<GraphCollection<T>>(next);
      for (const item of page.value ?? []) {
        results.push(item);
      }
      next = page["@odata.nextLink"];
    }

    return results;
  }

  async me(): Promise<{ id: string; displayName?: string; userPrincipalName?: string }> {
    const data = await this.request<{ id: string; displayName?: string; userPrincipalName?: string }>(
      "/me?$select=id,displayName,userPrincipalName"
    );

    return {
      id: String(data.id),
      displayName: typeof data.displayName === "string" ? data.displayName : undefined,
      userPrincipalName: typeof data.userPrincipalName === "string" ? data.userPrincipalName : undefined,
    };
  }

  async listTeams(): Promise<Array<{ id: string; displayName?: string; description?: string }>> {
    const teams = await this.listAllPages<{ id: string; displayName?: string; description?: string }>(
      "/me/joinedTeams?$select=id,displayName,description"
    );

    return teams.map((team) => ({
      id: String(team.id),
      displayName: typeof team.displayName === "string" ? team.displayName : undefined,
      description: typeof team.description === "string" ? team.description : undefined,
    }));
  }

  async listChats(): Promise<Array<{ id: string; topic?: string; chatType?: string }>> {
    const chats = await this.listAllPages<{ id: string; topic?: string; chatType?: string }>(
      "/me/chats?$select=id,topic,chatType"
    );

    return chats.map((chat) => ({
      id: String(chat.id),
      topic: typeof chat.topic === "string" ? chat.topic : undefined,
      chatType: typeof chat.chatType === "string" ? chat.chatType : undefined,
    }));
  }

  async listChannelMessages(
    teamId: string,
    channelId: string
  ): Promise<Array<{ id: string; summary?: string; createdDateTime?: string }>> {
    const messages = await this.listAllPages<{
      id: string;
      summary?: string;
      createdDateTime?: string;
    }>(`/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages?$top=50`);

    return messages.map((message) => ({
      id: String(message.id),
      summary: typeof message.summary === "string" ? message.summary : undefined,
      createdDateTime: typeof message.createdDateTime === "string" ? message.createdDateTime : undefined,
    }));
  }
}
