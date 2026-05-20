import { slackCredentialStore } from "./credentialStore";
import { buildTier1ConnectionHealth } from "../shared/tier1Contract";
import { logSlack } from "./logger";
import { buildSlackOAuthUrl, exchangeCodeForTokens, refreshAccessToken } from "./oauth";
import { createPkceState, consumePkceState } from "./pkceStore";
import { SlackClient } from "./slackClient";
import { ConnectorError, SlackConnectionHealth, SlackCredentialPublic } from "./types";

function parseScopes(scope?: string): string[] {
  if (!scope) return [];
  return scope.split(",").map((item) => item.trim()).filter(Boolean);
}

/**
 * HEL-181: scopes the Slack connector relies on for its public service
 * methods (listChannels, listChannelMessages, sendMessage). Mirrors the
 * pattern in `shopify/service.ts` + `docusign/service.ts`.
 *
 * `chat:write`         — sendMessage
 * `channels:read`      — listChannels public
 * `groups:read`        — listChannels private (slackClient passes
 *                        `types=public_channel,private_channel`)
 * `channels:history`   — listChannelMessages public
 * `groups:history`     — listChannelMessages private
 *
 * Codex P2 on #926: the original default omitted the `groups:*` pair, so
 * health() would report `healthy` while private-channel calls failed
 * with `missing_scope`. Default now matches the full set in `oauth.ts:29`.
 *
 * Configurable via `SLACK_REQUIRED_SCOPES` (comma-separated) for ops who
 * deploy with a narrower bot integration.
 */
function requiredScopes(): string[] {
  return (
    process.env.SLACK_REQUIRED_SCOPES ??
    "channels:read,chat:write,groups:read,channels:history,groups:history"
  )
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function missingRequiredScopes(granted: string[]): string[] {
  const available = new Set(granted);
  return requiredScopes().filter((scope) => !available.has(scope));
}

export class SlackConnectorService {
  beginOAuth(userId: string): {
    authUrl: string;
    state: string;
    codeVerifier: string;
    expiresInSeconds: number;
  } {
    const pkce = createPkceState(userId);
    const authUrl = buildSlackOAuthUrl({
      state: pkce.state,
      codeChallenge: pkce.challenge,
    });

    logSlack({
      event: "connect",
      level: "info",
      connector: "slack",
      userId,
      message: "Slack OAuth flow initialized",
      metadata: { authMethod: "oauth2_pkce" },
    });

    return {
      authUrl,
      state: pkce.state,
      codeVerifier: pkce.verifier,
      expiresInSeconds: pkce.expiresInSeconds,
    };
  }

  async completeOAuth(params: { code: string; state: string }): Promise<SlackCredentialPublic> {
    const state = consumePkceState(params.state);
    if (!state) {
      throw new ConnectorError("auth", "OAuth state is invalid or expired", 401);
    }

    const tokenSet = await exchangeCodeForTokens({
      code: params.code,
      codeVerifier: state.verifier,
    });

    const scopes = parseScopes(tokenSet.scope);

    const credential = await slackCredentialStore.saveOAuth({
      userId: state.userId,
      accessToken: tokenSet.accessToken,
      refreshToken: tokenSet.refreshToken,
      scopes,
      teamId: tokenSet.teamId,
      teamName: tokenSet.teamName,
      metadata: tokenSet.expiresAt ? { expiresAt: tokenSet.expiresAt } : undefined,
    });

    // HEL-181: warn at OAuth completion if the workspace granted fewer
    // scopes than the connector needs. Surfaces in `health()` too so the
    // ConnectorHealth dashboard (HEL-179 Gap 2) shows "degraded" with
    // the missing-scopes list and prompts re-consent.
    const missingScopes = missingRequiredScopes(scopes);
    logSlack({
      event: missingScopes.length > 0 ? "error" : "connect",
      level: missingScopes.length > 0 ? "warn" : "info",
      connector: "slack",
      userId: state.userId,
      teamId: tokenSet.teamId,
      message:
        missingScopes.length > 0
          ? "Slack OAuth connection completed with missing required scopes"
          : "Slack OAuth connection completed",
      metadata: {
        authMethod: "oauth2_pkce",
        ...(missingScopes.length > 0 ? { missingScopes } : {}),
      },
    });

    return credential;
  }

  async connectApiKey(params: {
    userId: string;
    botToken: string;
  }): Promise<SlackCredentialPublic> {
    const client = new SlackClient(params.botToken);
    const auth = await client.authTest();

    const credential = await slackCredentialStore.saveApiKey({
      userId: params.userId,
      botToken: params.botToken,
      teamId: auth.teamId,
      teamName: auth.teamName,
      metadata: auth.botUserId ? { botUserId: auth.botUserId } : undefined,
    });

    logSlack({
      event: "connect",
      level: "info",
      connector: "slack",
      userId: params.userId,
      teamId: auth.teamId,
      message: "Slack API-key fallback connection completed",
      metadata: { authMethod: "api_key" },
    });

    return credential;
  }

  async listConnections(userId: string): Promise<SlackCredentialPublic[]> {
    // HEL-180: async so Postgres-backed credentials surface after restart
    // even when nothing has touched this process's local bucket yet.
    return slackCredentialStore.getPublicByUserAsync(userId);
  }

  async testConnection(userId: string): Promise<{ teamId: string; teamName?: string }> {
    const credential = await this.ensureValidCredential(userId);
    const token = slackCredentialStore.decryptAccessToken(credential);
    const client = new SlackClient(token);

    const auth = await client.authTest();
    logSlack({
      event: "sync",
      level: "info",
      connector: "slack",
      userId,
      teamId: auth.teamId,
      message: "Slack test connection succeeded",
    });

    return { teamId: auth.teamId, teamName: auth.teamName };
  }

  async health(userId: string): Promise<SlackConnectionHealth> {
    const checkedAt = new Date().toISOString();
    // HEL-180: hydrate from Postgres so the ConnectorHealth dashboard
    // (HEL-179 Gap 2) doesn't show every Slack workspace as "disabled"
    // immediately after an API restart.
    //
    // Codex P1 round 5 on #926: a transient Postgres failure on this
    // hydration call would otherwise bubble out of `health()` as a
    // rejected promise instead of returning a structured Tier1 health
    // payload. Catch it explicitly and surface as a provider_error.
    let credential: Awaited<ReturnType<typeof slackCredentialStore.getActiveByUserAsync>>;
    try {
      credential = await slackCredentialStore.getActiveByUserAsync(userId);
    } catch (error) {
      return buildTier1ConnectionHealth({
        connector: "slack",
        subject: userId,
        checkedAt,
        status: "provider_error",
        recommendedNextAction: "Retry shortly — credential store is temporarily unavailable.",
        details: {
          auth: false,
          apiReachable: false,
          rateLimited: false,
          errorType: "upstream",
          message:
            error instanceof Error
              ? `Credential store unavailable: ${error.message}`
              : "Credential store unavailable",
        },
      });
    }

    if (!credential) {
      return buildTier1ConnectionHealth({
        connector: "slack",
        subject: userId,
        checkedAt,
        status: "disabled",
        recommendedNextAction: "Connect a Slack credential from the dashboard to enable syncs.",
        details: {
          auth: false,
          apiReachable: false,
          rateLimited: false,
          message: "No Slack credential is connected",
        },
      });
    }

    try {
      const token = slackCredentialStore.decryptAccessToken(credential);
      const client = new SlackClient(token);
      await client.authTest();

      // HEL-181: degrade to "needs reconnect with more scopes" when the
      // granted set is missing anything the connector needs. The dashboard
      // ConnectorHealth.tsx (HEL-179 Gap 2) renders the message + the
      // Reconnect CTA.
      //
      // Codex P2 on #926: API-key (bot-token) connections never persist
      // scopes — `connectApiKey()` saves with `scopes: []` because Slack
      // doesn't return the bot scopes on the API-key save path. Without
      // this skip, every API-key connection would report degraded with
      // every required scope missing, even when `auth.test` succeeded.
      // Bot-token scope discovery happens at API-call time, not here.
      const missingScopes =
        credential.authMethod === "api_key"
          ? []
          : missingRequiredScopes(credential.scopes);
      const health: SlackConnectionHealth = buildTier1ConnectionHealth({
        connector: "slack",
        subject: userId,
        checkedAt,
        authMethod: credential.authMethod,
        tokenRefreshStatus:
          credential.authMethod === "oauth2_pkce"
            ? credential.refreshTokenEncrypted
              ? "healthy"
              : "failed"
            : "not_applicable",
        ...(missingScopes.length > 0
          ? {
              status: "degraded" as const,
              recommendedNextAction:
                "Reconnect Slack with the required scopes: " + missingScopes.join(", "),
            }
          : {}),
        metadata: {
          teamId: credential.teamId,
          ...(missingScopes.length > 0 ? { missingScopes } : {}),
        },
        details: {
          auth: true,
          apiReachable: true,
          rateLimited: false,
          ...(missingScopes.length > 0
            ? {
                errorType: "schema" as const,
                message: `Missing required scopes: ${missingScopes.join(", ")}`,
              }
            : {}),
        },
      });

      logSlack({
        event: "health",
        level: "info",
        connector: "slack",
        userId,
        teamId: credential.teamId,
        message: "Slack health check passed",
      });

      return health;
    } catch (error) {
      const connectorError = error instanceof ConnectorError
        ? error
        : new ConnectorError("upstream", error instanceof Error ? error.message : String(error), 502);

      logSlack({
        event: "error",
        level: "error",
        connector: "slack",
        userId,
        teamId: credential.teamId,
        message: connectorError.message,
        errorType: connectorError.type,
      });

      return buildTier1ConnectionHealth({
        connector: "slack",
        subject: userId,
        checkedAt,
        authMethod: credential.authMethod,
        metadata: {
          teamId: credential.teamId,
        },
        details: {
          auth: connectorError.type !== "auth",
          apiReachable: connectorError.type !== "network",
          rateLimited: connectorError.type === "rate-limit",
          errorType: connectorError.type,
          message: connectorError.message,
        },
      });
    }
  }

  async disconnect(userId: string, credentialId: string): Promise<boolean> {
    // HEL-180: async so disconnect can find + revoke a credential that
    // was saved in a different process (only persisted in Postgres).
    const revoked = await slackCredentialStore.revokeAsync(credentialId, userId);

    if (revoked) {
      logSlack({
        event: "disconnect",
        level: "info",
        connector: "slack",
        userId,
        message: "Slack credential revoked",
        metadata: { credentialId },
      });
    }

    return revoked;
  }

  async listChannels(userId: string): Promise<Array<{ id: string; name: string; isPrivate: boolean }>> {
    const credential = await this.ensureValidCredential(userId);
    const client = new SlackClient(slackCredentialStore.decryptAccessToken(credential));
    return client.listConversations();
  }

  async listChannelMessages(
    userId: string,
    channel: string
  ): Promise<Array<{ ts: string; text: string; user?: string }>> {
    const credential = await this.ensureValidCredential(userId);
    const client = new SlackClient(slackCredentialStore.decryptAccessToken(credential));
    return client.listChannelMessages(channel);
  }

  private async ensureValidCredential(userId: string) {
    // HEL-180: hydrate from Postgres if the local bucket is empty
    // (post-restart / multi-worker). Sync `getActiveByUser` would only
    // see the in-process Map and return null after every Fly restart.
    const credential = await slackCredentialStore.getActiveByUserAsync(userId);
    if (!credential) {
      throw new ConnectorError("auth", "Slack connector is not configured", 404);
    }

    if (credential.authMethod === "oauth2_pkce" && credential.refreshTokenEncrypted) {
      const expiresAt = credential.metadata?.expiresAt;
      if (expiresAt && Date.now() >= Date.parse(expiresAt) - 60_000) {
        try {
          const refreshToken = slackCredentialStore.decryptRefreshToken(credential);
          if (!refreshToken) {
            throw new ConnectorError("auth", "Missing refresh token", 401);
          }

          const refreshed = await refreshAccessToken(refreshToken);
          // Codex P2 round 5 on #926: Slack token-refresh responses can
          // legally omit the `scope` field. Without this guard, the
          // refresh would overwrite the credential's persisted scopes
          // with `[]`, and the next `health()` would mark a perfectly
          // healthy workspace as missing every required scope.
          //
          // Only override scopes when the refresh response actually
          // includes them; otherwise rotateToken keeps the existing set
          // (it treats undefined `scopes` as "no change" — see
          // credentialStore.rotateToken).
          const refreshedScopes = parseScopes(refreshed.scope);
          slackCredentialStore.rotateToken({
            credentialId: credential.id,
            accessToken: refreshed.accessToken,
            refreshToken: refreshed.refreshToken,
            scopes: refreshedScopes.length > 0 ? refreshedScopes : undefined,
          });
          credential.metadata = {
            ...(credential.metadata ?? {}),
            ...(refreshed.expiresAt ? { expiresAt: refreshed.expiresAt } : {}),
          };
        } catch (error) {
          logSlack({
            event: "error",
            level: "error",
            connector: "slack",
            userId,
            teamId: credential.teamId,
            message: `Slack token refresh failed: ${error instanceof Error ? error.message : String(error)}`,
            errorType: "auth",
          });
          throw new ConnectorError("auth", "Slack token refresh failed", 401);
        }
      }
    }

    return credential;
  }
}

export const slackConnectorService = new SlackConnectorService();
