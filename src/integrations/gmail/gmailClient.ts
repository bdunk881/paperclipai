import { ConnectorError, ConnectorErrorType, GmailLabel, GmailMessageDetail, GmailMessageSummary, GmailWatchResponse } from "./types";
import {
  classifyStandardErrorType,
  isStandardRetryable,
  resolveRetryDelayMs,
  sleep,
} from "../shared/retryPolicy";

const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1";
const MAX_RETRIES = 3;

interface GmailMessagePart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailMessagePart[];
}

interface GmailPayload extends GmailMessagePart {
  headers?: Array<{ name?: string; value?: string }>;
}

function parseErrorType(status: number, bodyText: string): ConnectorErrorType {
  return classifyStandardErrorType(status, bodyText, /rateLimitExceeded|rate.?limit/i);
}

function decodeBase64Url(input?: string): string | undefined {
  if (!input) {
    return undefined;
  }

  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  return Buffer.from(padded, "base64").toString("utf8");
}

function headerValue(
  headers: Array<{ name?: string; value?: string }> | undefined,
  name: string
): string | undefined {
  return headers?.find((header) => header.name?.toLowerCase() === name.toLowerCase())?.value;
}

function findBody(
  payload: GmailMessagePart | undefined,
  mimeType: "text/plain" | "text/html"
): string | undefined {
  if (!payload) {
    return undefined;
  }

  if (payload.mimeType === mimeType && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  if (!Array.isArray(payload.parts)) {
    return undefined;
  }

  for (const part of payload.parts) {
    const nested = findBody(part, mimeType);
    if (nested !== undefined) {
      return nested;
    }
  }

  return undefined;
}

export class GmailClient {
  private readonly token: string;

  constructor(token: string) {
    this.token = token;
  }

  private async request<T>(path: string, init: RequestInit = {}, attempt = 0): Promise<T> {
    const url = `${GMAIL_API_BASE}${path}`;

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
          throw new ConnectorError("rate-limit", "Gmail API rate limit exceeded", 429);
        }

        await sleep(resolveRetryDelayMs({ attempt, headers: response.headers }));
        return this.request<T>(path, init, attempt + 1);
      }

      const text = await response.text();
      const data: {
        error?: {
          code?: number;
          message?: string;
          status?: string;
        };
        [key: string]: unknown;
      } = text.trim()
        ? JSON.parse(text) as {
          error?: {
            code?: number;
            message?: string;
            status?: string;
          };
          [key: string]: unknown;
        }
        : {};

      if (!response.ok) {
        const message = data.error?.message || text || response.statusText;
        const type = parseErrorType(response.status, message);

        if (isStandardRetryable(type) && attempt < MAX_RETRIES) {
          await sleep(resolveRetryDelayMs({ attempt }));
          return this.request<T>(path, init, attempt + 1);
        }

        throw new ConnectorError(type, `Gmail API error: ${message}`, response.status);
      }

      return data as T;
    } catch (error) {
      if (error instanceof ConnectorError) {
        if (isStandardRetryable(error.type) && attempt < MAX_RETRIES) {
          await sleep(resolveRetryDelayMs({ attempt }));
          return this.request<T>(path, init, attempt + 1);
        }
        throw error;
      }

      if (attempt < MAX_RETRIES) {
        await sleep(resolveRetryDelayMs({ attempt }));
        return this.request<T>(path, init, attempt + 1);
      }

      throw new ConnectorError(
        "network",
        `Gmail network request failed: ${error instanceof Error ? error.message : String(error)}`,
        502
      );
    }
  }

  async getProfile(): Promise<{ emailAddress: string; historyId?: string; messagesTotal?: number; threadsTotal?: number }> {
    const data = await this.request<{
      emailAddress: string;
      historyId?: string;
      messagesTotal?: number;
      threadsTotal?: number;
    }>("/users/me/profile", { method: "GET" });

    return {
      emailAddress: String(data.emailAddress),
      historyId: data.historyId ? String(data.historyId) : undefined,
      messagesTotal: typeof data.messagesTotal === "number" ? data.messagesTotal : undefined,
      threadsTotal: typeof data.threadsTotal === "number" ? data.threadsTotal : undefined,
    };
  }

  async listMessages(params: {
    query?: string;
    labelIds?: string[];
    maxResults?: number;
  } = {}): Promise<GmailMessageSummary[]> {
    const results: GmailMessageSummary[] = [];
    let pageToken: string | undefined;

    do {
      const query = new URLSearchParams({
        maxResults: String(Math.min(500, Math.max(1, params.maxResults ?? 100))),
      });

      if (params.query) {
        query.set("q", params.query);
      }
      if (params.labelIds?.length) {
        for (const labelId of params.labelIds) {
          query.append("labelIds", labelId);
        }
      }
      if (pageToken) {
        query.set("pageToken", pageToken);
      }

      const data = await this.request<{
        messages?: Array<{
          id: string;
          threadId: string;
        }>;
        nextPageToken?: string;
      }>(`/users/me/messages?${query.toString()}`, { method: "GET" });

      for (const message of data.messages ?? []) {
        results.push({
          id: String(message.id),
          threadId: String(message.threadId),
          labelIds: [],
        });
      }

      pageToken = data.nextPageToken;
    } while (pageToken);

    return results;
  }

  async getMessage(id: string): Promise<GmailMessageDetail> {
    const data = await this.request<{
      id: string;
      threadId: string;
      labelIds?: string[];
      snippet?: string;
      historyId?: string;
      internalDate?: string;
      payload?: GmailPayload;
    }>(`/users/me/messages/${encodeURIComponent(id)}?format=full`, { method: "GET" });

    return {
      id: String(data.id),
      threadId: String(data.threadId),
      labelIds: Array.isArray(data.labelIds) ? data.labelIds.map(String) : [],
      snippet: typeof data.snippet === "string" ? data.snippet : undefined,
      historyId: typeof data.historyId === "string" ? data.historyId : undefined,
      internalDate: typeof data.internalDate === "string" ? data.internalDate : undefined,
      subject: headerValue(data.payload?.headers, "subject"),
      from: headerValue(data.payload?.headers, "from"),
      to: headerValue(data.payload?.headers, "to"),
      cc: headerValue(data.payload?.headers, "cc"),
      date: headerValue(data.payload?.headers, "date"),
      textBody: findBody(data.payload, "text/plain"),
      htmlBody: findBody(data.payload, "text/html"),
    };
  }

  async sendMessage(input: {
    to: string;
    subject: string;
    text: string;
    html?: string;
    cc?: string[];
    bcc?: string[];
    threadId?: string;
  }): Promise<{ id: string; threadId: string; labelIds: string[] }> {
    const boundary = `autoflow-${Date.now()}`;
    const headers = [
      `To: ${input.to}`,
      ...(input.cc?.length ? [`Cc: ${input.cc.join(", ")}`] : []),
      ...(input.bcc?.length ? [`Bcc: ${input.bcc.join(", ")}`] : []),
      `Subject: ${input.subject}`,
      "MIME-Version: 1.0",
    ];

    const message = input.html
      ? [
        ...headers,
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        "",
        `--${boundary}`,
        "Content-Type: text/plain; charset=utf-8",
        "",
        input.text,
        `--${boundary}`,
        "Content-Type: text/html; charset=utf-8",
        "",
        input.html,
        `--${boundary}--`,
      ].join("\r\n")
      : [
        ...headers,
        "Content-Type: text/plain; charset=utf-8",
        "",
        input.text,
      ].join("\r\n");

    const raw = Buffer.from(message, "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");

    const data = await this.request<{
      id: string;
      threadId: string;
      labelIds?: string[];
    }>("/users/me/messages/send", {
      method: "POST",
      body: JSON.stringify({
        raw,
        ...(input.threadId ? { threadId: input.threadId } : {}),
      }),
    });

    return {
      id: String(data.id),
      threadId: String(data.threadId),
      labelIds: Array.isArray(data.labelIds) ? data.labelIds.map(String) : [],
    };
  }

  async listLabels(): Promise<GmailLabel[]> {
    const data = await this.request<{
      labels?: Array<{
        id: string;
        name: string;
        type?: string;
        messageListVisibility?: string;
        labelListVisibility?: string;
        messagesTotal?: number;
        threadsTotal?: number;
        color?: { textColor?: string; backgroundColor?: string };
      }>;
    }>("/users/me/labels", { method: "GET" });

    return (data.labels ?? []).map((label) => ({
      id: String(label.id),
      name: String(label.name),
      type: label.type,
      messageListVisibility: label.messageListVisibility,
      labelListVisibility: label.labelListVisibility,
      messagesTotal: label.messagesTotal,
      threadsTotal: label.threadsTotal,
      color: label.color,
    }));
  }

  async createLabel(input: {
    name: string;
    messageListVisibility?: string;
    labelListVisibility?: string;
    color?: {
      textColor?: string;
      backgroundColor?: string;
    };
  }): Promise<GmailLabel> {
    return this.request<GmailLabel>("/users/me/labels", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async updateLabel(
    id: string,
    input: {
      name?: string;
      messageListVisibility?: string;
      labelListVisibility?: string;
      color?: {
        textColor?: string;
        backgroundColor?: string;
      };
    }
  ): Promise<GmailLabel> {
    return this.request<GmailLabel>(`/users/me/labels/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  }

  async watchMailbox(params: {
    topicName: string;
    labelIds?: string[];
    labelFilterAction?: "include" | "exclude";
  }): Promise<GmailWatchResponse> {
    const data = await this.request<{
      historyId: string;
      expiration?: string;
    }>("/users/me/watch", {
      method: "POST",
      body: JSON.stringify({
        topicName: params.topicName,
        ...(params.labelIds?.length ? { labelIds: params.labelIds } : {}),
        ...(params.labelFilterAction ? { labelFilterAction: params.labelFilterAction } : {}),
      }),
    });

    return {
      historyId: String(data.historyId),
      expiration: data.expiration ? String(data.expiration) : undefined,
    };
  }
}
