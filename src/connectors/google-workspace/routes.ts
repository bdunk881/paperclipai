import { Request, Response, Router } from "express";
import { googleWorkspaceCredentialsStore } from "./credentialsStore";
import { GoogleWorkspaceClient, GoogleWorkspaceConnectorError } from "./googleWorkspaceClient";
import { logGoogleWorkspaceEvent } from "./logging";

function getUserId(req: Request): string | null {
  const userId = req.headers["x-user-id"];
  if (typeof userId !== "string" || !userId.trim()) return null;
  return userId.trim();
}

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function errorStatus(error: GoogleWorkspaceConnectorError): number {
  switch (error.category) {
    case "auth":
      return 401;
    case "rate-limit":
      return 429;
    case "schema":
      return 422;
    case "network":
      return 503;
    case "upstream":
    default:
      return 502;
  }
}

const DEFAULT_SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/spreadsheets.readonly",
];

const client = new GoogleWorkspaceClient();
const router = Router();

router.post("/credentials", (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "X-User-Id header is required" });
    return;
  }

  const {
    authMethod,
    label,
    clientId,
    clientSecret,
    redirectUri,
    scopesRequested,
    apiKey,
    webhookSigningSecret,
  } = req.body as Record<string, unknown>;

  if (authMethod !== "oauth_pkce" && authMethod !== "api_key") {
    res.status(400).json({ error: "authMethod must be one of: oauth_pkce, api_key" });
    return;
  }

  if (typeof label !== "string" || !label.trim()) {
    res.status(400).json({ error: "label is required" });
    return;
  }

  if (typeof webhookSigningSecret !== "undefined") {
    if (typeof webhookSigningSecret !== "string" || webhookSigningSecret.trim().length < 8) {
      res.status(400).json({ error: "webhookSigningSecret must be at least 8 chars when provided" });
      return;
    }
  }

  if (authMethod === "oauth_pkce") {
    if (typeof clientId !== "string" || clientId.trim().length < 3) {
      res.status(400).json({ error: "clientId is required" });
      return;
    }

    if (typeof clientSecret !== "string" || clientSecret.trim().length < 8) {
      res.status(400).json({ error: "clientSecret is required (minimum 8 chars)" });
      return;
    }

    if (typeof redirectUri !== "string" || !isValidUrl(redirectUri)) {
      res.status(400).json({ error: "redirectUri must be a valid URL" });
      return;
    }

    const normalizedScopes = Array.isArray(scopesRequested)
      ? scopesRequested.filter((scope): scope is string => typeof scope === "string" && scope.trim().length > 0)
      : DEFAULT_SCOPES;

    const created = googleWorkspaceCredentialsStore.createOAuth({
      userId,
      label: label.trim(),
      clientId: clientId.trim(),
      clientSecret: clientSecret.trim(),
      redirectUri: redirectUri.trim(),
      scopesRequested: normalizedScopes,
      webhookSigningSecret: typeof webhookSigningSecret === "string" ? webhookSigningSecret.trim() : undefined,
    });

    logGoogleWorkspaceEvent({
      connector: "google_workspace",
      event: "connect.created",
      userId,
      credentialId: created.id,
    });
    res.status(201).json(created);
    return;
  }

  if (typeof apiKey !== "string" || apiKey.trim().length < 8) {
    res.status(400).json({ error: "apiKey is required (minimum 8 chars)" });
    return;
  }

  const created = googleWorkspaceCredentialsStore.createApiKey({
    userId,
    label: label.trim(),
    apiKey: apiKey.trim(),
    webhookSigningSecret: typeof webhookSigningSecret === "string" ? webhookSigningSecret.trim() : undefined,
  });

  logGoogleWorkspaceEvent({
    connector: "google_workspace",
    event: "connect.created",
    userId,
    credentialId: created.id,
  });
  res.status(201).json(created);
});

router.post("/credentials/:id/oauth/tokens", (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "X-User-Id header is required" });
    return;
  }

  const {
    accessToken,
    refreshToken,
    expiresAt,
    scopesGranted,
  } = req.body as Record<string, unknown>;

  if (typeof accessToken !== "string" || accessToken.trim().length < 8) {
    res.status(400).json({ error: "accessToken is required (minimum 8 chars)" });
    return;
  }

  const updated = googleWorkspaceCredentialsStore.storeOAuthTokens({
    id: req.params.id,
    userId,
    accessToken: accessToken.trim(),
    refreshToken: typeof refreshToken === "string" && refreshToken.trim().length > 0 ? refreshToken.trim() : undefined,
    expiresAt: typeof expiresAt === "string" && expiresAt.trim().length > 0 ? expiresAt : null,
    scopesGranted: Array.isArray(scopesGranted)
      ? scopesGranted.filter((scope): scope is string => typeof scope === "string" && scope.trim().length > 0)
      : undefined,
  });

  if (!updated) {
    res.status(404).json({ error: `Google Workspace credential not found: ${req.params.id}` });
    return;
  }

  logGoogleWorkspaceEvent({
    connector: "google_workspace",
    event: "oauth.tokens_stored",
    userId,
    credentialId: req.params.id,
  });

  res.json(updated);
});

router.get("/credentials", (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "X-User-Id header is required" });
    return;
  }

  const credentials = googleWorkspaceCredentialsStore.list(userId);
  res.json({ credentials, total: credentials.length });
});

router.post("/credentials/:id/test-connection", async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "X-User-Id header is required" });
    return;
  }

  const decrypted = googleWorkspaceCredentialsStore.getDecrypted(req.params.id, userId);
  if (!decrypted) {
    res.status(404).json({ error: `Google Workspace credential not found: ${req.params.id}` });
    return;
  }

  try {
    const account = await client.ping(decrypted);
    const updated = googleWorkspaceCredentialsStore.markValidated(req.params.id, userId);

    logGoogleWorkspaceEvent({
      connector: "google_workspace",
      event: "connect.validated",
      userId,
      credentialId: req.params.id,
      detail: { accountId: account.id },
    });

    res.json({
      status: "ok",
      connector: "google_workspace",
      credential: updated,
      account,
    });
  } catch (error) {
    if (error instanceof GoogleWorkspaceConnectorError) {
      googleWorkspaceCredentialsStore.recordTokenRefreshFailure(req.params.id, userId);
      logGoogleWorkspaceEvent({
        connector: "google_workspace",
        event: "error.test_connection",
        userId,
        credentialId: req.params.id,
        category: error.category,
        message: error.message,
      });

      res.status(errorStatus(error)).json({ error: error.message, category: error.category });
      return;
    }

    res.status(500).json({ error: "Unknown connector test failure", category: "network" });
  }
});

router.get("/drive/files", async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "X-User-Id header is required" });
    return;
  }

  const credentialId = typeof req.query.credentialId === "string" ? req.query.credentialId : null;
  if (!credentialId) {
    res.status(400).json({ error: "credentialId query parameter is required" });
    return;
  }

  const decrypted = googleWorkspaceCredentialsStore.getDecrypted(credentialId, userId);
  if (!decrypted) {
    res.status(404).json({ error: `Google Workspace credential not found: ${credentialId}` });
    return;
  }

  try {
    const files = await client.listDriveFiles(decrypted);
    logGoogleWorkspaceEvent({
      connector: "google_workspace",
      event: "sync.drive_files",
      userId,
      credentialId,
      detail: { total: files.length },
    });
    res.json({ files, total: files.length });
  } catch (error) {
    if (error instanceof GoogleWorkspaceConnectorError) {
      logGoogleWorkspaceEvent({
        connector: "google_workspace",
        event: "error.sync_drive_files",
        userId,
        credentialId,
        category: error.category,
        message: error.message,
      });
      res.status(errorStatus(error)).json({ error: error.message, category: error.category });
      return;
    }
    res.status(500).json({ error: "Unknown drive sync failure", category: "network" });
  }
});

router.get("/calendar/events", async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "X-User-Id header is required" });
    return;
  }

  const credentialId = typeof req.query.credentialId === "string" ? req.query.credentialId : null;
  if (!credentialId) {
    res.status(400).json({ error: "credentialId query parameter is required" });
    return;
  }

  const calendarId = typeof req.query.calendarId === "string" && req.query.calendarId.trim()
    ? req.query.calendarId
    : "primary";

  const decrypted = googleWorkspaceCredentialsStore.getDecrypted(credentialId, userId);
  if (!decrypted) {
    res.status(404).json({ error: `Google Workspace credential not found: ${credentialId}` });
    return;
  }

  try {
    const events = await client.listCalendarEvents(decrypted, calendarId);
    logGoogleWorkspaceEvent({
      connector: "google_workspace",
      event: "sync.calendar_events",
      userId,
      credentialId,
      detail: { total: events.length, calendarId },
    });
    res.json({ events, total: events.length });
  } catch (error) {
    if (error instanceof GoogleWorkspaceConnectorError) {
      logGoogleWorkspaceEvent({
        connector: "google_workspace",
        event: "error.sync_calendar_events",
        userId,
        credentialId,
        category: error.category,
        message: error.message,
      });
      res.status(errorStatus(error)).json({ error: error.message, category: error.category });
      return;
    }
    res.status(500).json({ error: "Unknown calendar sync failure", category: "network" });
  }
});

router.get("/gmail/messages", async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "X-User-Id header is required" });
    return;
  }

  const credentialId = typeof req.query.credentialId === "string" ? req.query.credentialId : null;
  if (!credentialId) {
    res.status(400).json({ error: "credentialId query parameter is required" });
    return;
  }

  const mailbox = typeof req.query.mailbox === "string" && req.query.mailbox.trim()
    ? req.query.mailbox
    : "me";

  const decrypted = googleWorkspaceCredentialsStore.getDecrypted(credentialId, userId);
  if (!decrypted) {
    res.status(404).json({ error: `Google Workspace credential not found: ${credentialId}` });
    return;
  }

  try {
    const messages = await client.listGmailMessages(decrypted, mailbox);
    logGoogleWorkspaceEvent({
      connector: "google_workspace",
      event: "sync.gmail_messages",
      userId,
      credentialId,
      detail: { total: messages.length },
    });
    res.json({ messages, total: messages.length });
  } catch (error) {
    if (error instanceof GoogleWorkspaceConnectorError) {
      logGoogleWorkspaceEvent({
        connector: "google_workspace",
        event: "error.sync_gmail_messages",
        userId,
        credentialId,
        category: error.category,
        message: error.message,
      });
      res.status(errorStatus(error)).json({ error: error.message, category: error.category });
      return;
    }
    res.status(500).json({ error: "Unknown Gmail sync failure", category: "network" });
  }
});

router.delete("/credentials/:id", (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "X-User-Id header is required" });
    return;
  }

  const revoked = googleWorkspaceCredentialsStore.revoke(req.params.id, userId);
  if (!revoked) {
    res.status(404).json({ error: `Google Workspace credential not found: ${req.params.id}` });
    return;
  }

  logGoogleWorkspaceEvent({
    connector: "google_workspace",
    event: "disconnect",
    userId,
    credentialId: req.params.id,
  });
  res.json(revoked);
});

router.get("/health", (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "X-User-Id header is required" });
    return;
  }

  res.json(googleWorkspaceCredentialsStore.health(userId));
});

export default router;
