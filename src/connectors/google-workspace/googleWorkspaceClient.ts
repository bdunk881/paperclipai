import {
  GoogleWorkspaceAuthMethod,
  GoogleWorkspaceCredentialDecrypted,
  googleWorkspaceCredentialsStore,
} from "./credentialsStore";
import { ConnectorErrorCategory } from "./logging";

const GOOGLE_OAUTH_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_OAUTH_USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v2/userinfo";
const GOOGLE_DISCOVERY_ENDPOINT = "https://www.googleapis.com/discovery/v1/apis";
const GOOGLE_DRIVE_FILES_ENDPOINT = "https://www.googleapis.com/drive/v3/files";
const GOOGLE_CALENDAR_EVENTS_ENDPOINT = "https://www.googleapis.com/calendar/v3/calendars";
const GOOGLE_GMAIL_MESSAGES_ENDPOINT = "https://gmail.googleapis.com/gmail/v1/users";

interface TokenRefreshResult {
  accessToken: string;
  expiresAt: string | null;
  scopesGranted?: string[];
}

export interface GoogleIdentity {
  id: string;
  email: string;
  name: string;
}

export interface GoogleDriveFile {
  id: string;
  name: string;
  mimeType?: string;
  modifiedTime?: string;
}

export interface GoogleCalendarEvent {
  id: string;
  summary?: string;
  status?: string;
  htmlLink?: string;
}

export interface GoogleGmailMessage {
  id: string;
  threadId: string;
}

export class GoogleWorkspaceConnectorError extends Error {
  category: ConnectorErrorCategory;
  statusCode?: number;

  constructor(category: ConnectorErrorCategory, message: string, statusCode?: number) {
    super(message);
    this.name = "GoogleWorkspaceConnectorError";
    this.category = category;
    this.statusCode = statusCode;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function categorizeStatus(status: number): ConnectorErrorCategory {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate-limit";
  if (status >= 500) return "upstream";
  if (status >= 400) return "schema";
  return "network";
}

export class GoogleWorkspaceClient {
  private readonly maxRetries = 3;

  private async refreshAccessToken(
    credential: GoogleWorkspaceCredentialDecrypted,
    userId: string,
  ): Promise<TokenRefreshResult> {
    if (
      !credential.clientId ||
      !credential.oauthClientSecret ||
      !credential.refreshToken
    ) {
      throw new GoogleWorkspaceConnectorError(
        "auth",
        "OAuth credential missing client or refresh token for refresh flow",
      );
    }

    const response = await fetch(GOOGLE_OAUTH_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: credential.clientId,
        client_secret: credential.oauthClientSecret,
        grant_type: "refresh_token",
        refresh_token: credential.refreshToken,
      }),
    });

    if (!response.ok) {
      throw new GoogleWorkspaceConnectorError(
        categorizeStatus(response.status),
        `Google token refresh failed (${response.status})`,
        response.status,
      );
    }

    const payload = await response.json() as {
      access_token?: string;
      expires_in?: number;
      scope?: string;
    };
    if (!payload.access_token) {
      throw new GoogleWorkspaceConnectorError("schema", "Google token refresh returned no access_token");
    }

    const expiresAt = typeof payload.expires_in === "number"
      ? new Date(Date.now() + payload.expires_in * 1000).toISOString()
      : null;

    googleWorkspaceCredentialsStore.storeOAuthTokens({
      id: credential.id,
      userId,
      accessToken: payload.access_token,
      expiresAt,
      scopesGranted: typeof payload.scope === "string" ? payload.scope.split(/\s+/).filter(Boolean) : undefined,
    });

    return {
      accessToken: payload.access_token,
      expiresAt,
      scopesGranted: typeof payload.scope === "string" ? payload.scope.split(/\s+/).filter(Boolean) : undefined,
    };
  }

  private async resolveAuth(
    credential: GoogleWorkspaceCredentialDecrypted,
    userId: string,
  ): Promise<{ authMethod: GoogleWorkspaceAuthMethod; bearerToken?: string; apiKey?: string }> {
    if (credential.authMethod === "api_key") {
      if (!credential.apiKey || credential.apiKey.trim().length < 8) {
        throw new GoogleWorkspaceConnectorError("auth", "Missing Google API key");
      }
      return { authMethod: "api_key", apiKey: credential.apiKey };
    }

    const token = credential.accessToken;
    if (!token || token.trim().length < 8) {
      if (credential.refreshToken) {
        const refreshed = await this.refreshAccessToken(credential, userId);
        return { authMethod: "oauth_pkce", bearerToken: refreshed.accessToken };
      }
      throw new GoogleWorkspaceConnectorError("auth", "Missing OAuth access token");
    }

    const expiresAt = credential.accessTokenExpiresAt ? new Date(credential.accessTokenExpiresAt).getTime() : null;
    if (expiresAt !== null && Number.isFinite(expiresAt) && expiresAt <= Date.now() + 30_000) {
      if (credential.refreshToken) {
        const refreshed = await this.refreshAccessToken(credential, userId);
        return { authMethod: "oauth_pkce", bearerToken: refreshed.accessToken };
      }
      throw new GoogleWorkspaceConnectorError("auth", "OAuth access token expired and no refresh token available");
    }

    return { authMethod: "oauth_pkce", bearerToken: token };
  }

  private async requestJson<T>(
    url: URL,
    auth: { authMethod: GoogleWorkspaceAuthMethod; bearerToken?: string; apiKey?: string },
  ): Promise<T> {
    if (auth.authMethod === "api_key") {
      url.searchParams.set("key", auth.apiKey ?? "");
    }

    let lastNetworkError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const response = await fetch(url.toString(), {
          method: "GET",
          headers: auth.authMethod === "oauth_pkce"
            ? { authorization: `Bearer ${auth.bearerToken ?? ""}` }
            : undefined,
        });

        if (response.status === 401 || response.status === 403) {
          throw new GoogleWorkspaceConnectorError("auth", "Google rejected connector credentials", response.status);
        }

        if (response.status === 429 || response.status >= 500) {
          if (attempt < this.maxRetries) {
            await sleep(200 * (2 ** attempt));
            continue;
          }
          throw new GoogleWorkspaceConnectorError("rate-limit", "Google API rate limit or server error", response.status);
        }

        if (!response.ok) {
          throw new GoogleWorkspaceConnectorError(
            categorizeStatus(response.status),
            `Google API error ${response.status}`,
            response.status,
          );
        }

        return await response.json() as T;
      } catch (error) {
        if (error instanceof GoogleWorkspaceConnectorError) throw error;
        lastNetworkError = error;
        if (attempt < this.maxRetries) {
          await sleep(200 * (2 ** attempt));
          continue;
        }
      }
    }

    throw new GoogleWorkspaceConnectorError(
      "network",
      `Network failure while calling Google: ${
        lastNetworkError instanceof Error ? lastNetworkError.message : "unknown error"
      }`,
    );
  }

  async ping(credential: GoogleWorkspaceCredentialDecrypted): Promise<GoogleIdentity> {
    const auth = await this.resolveAuth(credential, credential.userId);

    if (auth.authMethod === "api_key") {
      const endpoint = new URL(GOOGLE_DISCOVERY_ENDPOINT);
      const discovery = await this.requestJson<{ items?: Array<{ id?: string }> }>(endpoint, auth);
      const discoveredId = discovery.items?.[0]?.id ?? "google-api";
      return { id: "api-key", email: "api-key@google.local", name: discoveredId };
    }

    const endpoint = new URL(GOOGLE_OAUTH_USERINFO_ENDPOINT);
    const profile = await this.requestJson<{ id?: string; email?: string; name?: string }>(endpoint, auth);
    if (!profile.id || !profile.email) {
      throw new GoogleWorkspaceConnectorError("schema", "Google user profile response missing id/email");
    }

    return {
      id: profile.id,
      email: profile.email,
      name: profile.name ?? profile.email,
    };
  }

  async listDriveFiles(
    credential: GoogleWorkspaceCredentialDecrypted,
    maxPages = 3,
  ): Promise<GoogleDriveFile[]> {
    const auth = await this.resolveAuth(credential, credential.userId);
    const files: GoogleDriveFile[] = [];
    let pageToken: string | null = null;
    let pages = 0;

    do {
      const endpoint = new URL(GOOGLE_DRIVE_FILES_ENDPOINT);
      endpoint.searchParams.set("pageSize", "100");
      endpoint.searchParams.set("fields", "nextPageToken,files(id,name,mimeType,modifiedTime)");
      if (pageToken) endpoint.searchParams.set("pageToken", pageToken);

      const response = await this.requestJson<{ files?: GoogleDriveFile[]; nextPageToken?: string }>(endpoint, auth);
      files.push(...(response.files ?? []));
      pageToken = response.nextPageToken ?? null;
      pages += 1;
    } while (pageToken && pages < maxPages);

    return files;
  }

  async listCalendarEvents(
    credential: GoogleWorkspaceCredentialDecrypted,
    calendarId = "primary",
    maxPages = 3,
  ): Promise<GoogleCalendarEvent[]> {
    const auth = await this.resolveAuth(credential, credential.userId);
    const events: GoogleCalendarEvent[] = [];
    let pageToken: string | null = null;
    let pages = 0;

    do {
      const endpoint = new URL(
        `${GOOGLE_CALENDAR_EVENTS_ENDPOINT}/${encodeURIComponent(calendarId)}/events`,
      );
      endpoint.searchParams.set("maxResults", "100");
      endpoint.searchParams.set("singleEvents", "true");
      endpoint.searchParams.set("orderBy", "updated");
      if (pageToken) endpoint.searchParams.set("pageToken", pageToken);

      const response = await this.requestJson<{ items?: GoogleCalendarEvent[]; nextPageToken?: string }>(
        endpoint,
        auth,
      );
      events.push(...(response.items ?? []));
      pageToken = response.nextPageToken ?? null;
      pages += 1;
    } while (pageToken && pages < maxPages);

    return events;
  }

  async listGmailMessages(
    credential: GoogleWorkspaceCredentialDecrypted,
    userEmail = "me",
    maxPages = 3,
  ): Promise<GoogleGmailMessage[]> {
    const auth = await this.resolveAuth(credential, credential.userId);
    const messages: GoogleGmailMessage[] = [];
    let pageToken: string | null = null;
    let pages = 0;

    do {
      const endpoint = new URL(`${GOOGLE_GMAIL_MESSAGES_ENDPOINT}/${encodeURIComponent(userEmail)}/messages`);
      endpoint.searchParams.set("maxResults", "100");
      if (pageToken) endpoint.searchParams.set("pageToken", pageToken);

      const response = await this.requestJson<{ messages?: GoogleGmailMessage[]; nextPageToken?: string }>(
        endpoint,
        auth,
      );
      messages.push(...(response.messages ?? []));
      pageToken = response.nextPageToken ?? null;
      pages += 1;
    } while (pageToken && pages < maxPages);

    return messages;
  }
}
