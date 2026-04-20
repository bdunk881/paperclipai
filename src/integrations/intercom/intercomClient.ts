import {
  ConnectorError,
  ConnectorErrorType,
  IntercomContact,
  IntercomConversation,
} from "./types";

const MAX_RETRIES = 4;

function intercomApiBase(): string {
  return (process.env.INTERCOM_API_BASE_URL ?? "https://api.intercom.io").replace(/\/$/, "");
}

function intercomApiVersion(): string {
  return (process.env.INTERCOM_API_VERSION ?? "2.13").trim();
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

interface IntercomPagination {
  pages?: {
    next?: {
      starting_after?: string;
    };
  };
}

export class IntercomClient {
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  private async request<T>(path: string, init?: RequestInit, attempt = 0): Promise<T> {
    try {
      const response = await fetch(`${intercomApiBase()}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/json",
          "Intercom-Version": intercomApiVersion(),
          ...(init?.headers ?? {}),
        },
      });

      if (response.status === 429) {
        if (attempt >= MAX_RETRIES) {
          throw new ConnectorError("rate-limit", "Intercom API rate limit exceeded", 429);
        }

        const retryAfterSeconds = Number(response.headers.get("Retry-After") ?? "1");
        await sleep(Math.max(1, retryAfterSeconds) * 1000);
        return this.request<T>(path, init, attempt + 1);
      }

      const text = await response.text();
      if (!response.ok) {
        const type = parseErrorType(response.status, text);
        throw new ConnectorError(type, `Intercom HTTP ${response.status}: ${text || response.statusText}`, response.status);
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
        `Intercom network request failed: ${error instanceof Error ? error.message : String(error)}`,
        502
      );
    }
  }

  async viewer(): Promise<{ viewerId: string; workspaceId: string; workspaceName?: string }> {
    const data = await this.request<{
      type?: string;
      id?: string;
      app?: {
        id?: string | number;
        name?: string;
      };
      workspace?: {
        id?: string | number;
        name?: string;
      };
      name?: string;
    }>("/me");

    const workspaceId = data.workspace?.id ?? data.app?.id;
    if (workspaceId == null) {
      throw new ConnectorError("schema", "Intercom /me response missing workspace/app id", 502);
    }

    return {
      viewerId: String(data.id ?? workspaceId),
      workspaceId: String(workspaceId),
      workspaceName: data.workspace?.name ?? data.app?.name ?? data.name,
    };
  }

  async listContacts(limit = 100): Promise<IntercomContact[]> {
    const pageSize = Math.min(150, Math.max(1, limit));
    const contacts: IntercomContact[] = [];
    let startingAfter: string | undefined;

    while (contacts.length < limit) {
      const query = new URLSearchParams({ per_page: String(pageSize) });
      if (startingAfter) {
        query.set("starting_after", startingAfter);
      }

      const data = await this.request<IntercomPagination & {
        data?: Array<{
          id?: string;
          role?: string;
          email?: string;
          name?: string;
          created_at?: number;
        }>;
      }>(`/contacts?${query.toString()}`);

      const page = Array.isArray(data.data) ? data.data : [];
      for (const item of page) {
        if (!item.id) continue;
        contacts.push({
          id: String(item.id),
          email: typeof item.email === "string" ? item.email : undefined,
          name: typeof item.name === "string" ? item.name : undefined,
          role: typeof item.role === "string" ? item.role : undefined,
          createdAt: typeof item.created_at === "number"
            ? new Date(item.created_at * 1000).toISOString()
            : undefined,
        });

        if (contacts.length >= limit) {
          break;
        }
      }

      startingAfter = data.pages?.next?.starting_after;
      if (!startingAfter || page.length === 0) {
        break;
      }
    }

    return contacts;
  }

  async createContact(input: {
    email?: string;
    name?: string;
    role?: "lead" | "user";
    externalId?: string;
  }): Promise<IntercomContact> {
    const payload = {
      role: input.role ?? "user",
      email: input.email,
      name: input.name,
      external_id: input.externalId,
    };

    const created = await this.request<{
      id?: string;
      role?: string;
      email?: string;
      name?: string;
      created_at?: number;
    }>("/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!created.id) {
      throw new ConnectorError("upstream", "Intercom create contact returned no id", 502);
    }

    return {
      id: String(created.id),
      role: typeof created.role === "string" ? created.role : undefined,
      email: typeof created.email === "string" ? created.email : undefined,
      name: typeof created.name === "string" ? created.name : undefined,
      createdAt: typeof created.created_at === "number"
        ? new Date(created.created_at * 1000).toISOString()
        : undefined,
    };
  }

  async updateContact(contactId: string, input: {
    email?: string;
    name?: string;
    role?: "lead" | "user";
  }): Promise<IntercomContact> {
    const updated = await this.request<{
      id?: string;
      role?: string;
      email?: string;
      name?: string;
      created_at?: number;
    }>(`/contacts/${encodeURIComponent(contactId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        role: input.role,
        email: input.email,
        name: input.name,
      }),
    });

    if (!updated.id) {
      throw new ConnectorError("upstream", "Intercom update contact returned no id", 502);
    }

    return {
      id: String(updated.id),
      role: typeof updated.role === "string" ? updated.role : undefined,
      email: typeof updated.email === "string" ? updated.email : undefined,
      name: typeof updated.name === "string" ? updated.name : undefined,
      createdAt: typeof updated.created_at === "number"
        ? new Date(updated.created_at * 1000).toISOString()
        : undefined,
    };
  }

  async listConversations(limit = 100): Promise<IntercomConversation[]> {
    const pageSize = Math.min(150, Math.max(1, limit));
    const conversations: IntercomConversation[] = [];
    let startingAfter: string | undefined;

    while (conversations.length < limit) {
      const query = new URLSearchParams({ per_page: String(pageSize) });
      if (startingAfter) {
        query.set("starting_after", startingAfter);
      }

      const data = await this.request<IntercomPagination & {
        conversations?: Array<{
          id?: string;
          title?: string;
          state?: string;
          created_at?: number;
          updated_at?: number;
        }>;
      }>(`/conversations?${query.toString()}`);

      const page = Array.isArray(data.conversations) ? data.conversations : [];
      for (const item of page) {
        if (!item.id) continue;
        conversations.push({
          id: String(item.id),
          title: typeof item.title === "string" ? item.title : undefined,
          state: typeof item.state === "string" ? item.state : undefined,
          createdAt: typeof item.created_at === "number"
            ? new Date(item.created_at * 1000).toISOString()
            : undefined,
          updatedAt: typeof item.updated_at === "number"
            ? new Date(item.updated_at * 1000).toISOString()
            : undefined,
        });

        if (conversations.length >= limit) {
          break;
        }
      }

      startingAfter = data.pages?.next?.starting_after;
      if (!startingAfter || page.length === 0) {
        break;
      }
    }

    return conversations;
  }

  async createConversation(input: {
    fromContactId: string;
    body: string;
    messageType?: "comment" | "note";
    assigneeId?: string;
  }): Promise<{ id: string }> {
    const data = await this.request<{ id?: string }>("/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        from: {
          type: "contact",
          id: input.fromContactId,
        },
        body: input.body,
        message_type: input.messageType ?? "comment",
        assignee_id: input.assigneeId,
      }),
    });

    if (!data.id) {
      throw new ConnectorError("upstream", "Intercom create conversation returned no id", 502);
    }

    return { id: String(data.id) };
  }

  async replyToConversation(conversationId: string, input: {
    adminId: string;
    body: string;
    messageType?: "comment" | "note";
  }): Promise<{ id: string }> {
    const data = await this.request<{ conversation_id?: string; id?: string }>(
      `/conversations/${encodeURIComponent(conversationId)}/reply`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "admin",
          admin_id: input.adminId,
          body: input.body,
          message_type: input.messageType ?? "comment",
        }),
      }
    );

    const resolvedId = data.id ?? data.conversation_id ?? conversationId;
    return { id: String(resolvedId) };
  }
}
