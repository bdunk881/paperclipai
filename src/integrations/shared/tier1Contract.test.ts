import { ApolloConnectorService } from "../apollo/service";
import { GmailConnectorService } from "../gmail/service";
import {
  GmailAuthMethod,
  GmailConnectionHealth,
  GmailCredentialPublic,
} from "../gmail/types";
import { HubSpotConnectorService } from "../hubspot/service";
import {
  HubSpotAuthMethod,
  HubSpotConnectionHealth,
  HubSpotCredentialPublic,
} from "../hubspot/types";
import { LinearConnectorService } from "../linear/service";
import {
  LinearAuthMethod,
  LinearConnectionHealth,
  LinearCredentialPublic,
} from "../linear/types";
import { SentryConnectorService } from "../sentry/service";
import {
  SentryAuthMethod,
  SentryConnectionHealth,
  SentryCredentialPublic,
} from "../sentry/types";
import { SlackConnectorService } from "../slack/service";
import {
  SlackAuthMethod,
  SlackConnectionHealth,
  SlackCredentialPublic,
} from "../slack/types";
import { StripeConnectorService } from "../stripe/service";
import {
  StripeAuthMethod,
  StripeConnectionHealth,
  StripeCredentialPublic,
} from "../stripe/types";
import { TeamsConnectorService } from "../teams/service";
import {
  TeamsAuthMethod,
  TeamsConnectionHealth,
  TeamsCredentialPublic,
} from "../teams/types";
import { JiraAdapter } from "../tracker-sync/jiraAdapter";
import { TrackerHealth } from "../tracker-sync/types";
import {
  TIER1_SDK_SURFACES,
  Tier1ConnectionHealth,
  Tier1ConnectionPublic,
  Tier1OAuthStartResult,
} from "./tier1Contract";

function assertIsoTimestamp(value: string): void {
  expect(Number.isNaN(Date.parse(value))).toBe(false);
}

function assertOAuthFlow(flow: Tier1OAuthStartResult, expectPkce: boolean): void {
  expect(flow.authUrl).toMatch(/^https?:\/\//);
  expect(flow.state).toBeTruthy();
  expect(flow.expiresInSeconds).toBeGreaterThan(0);
  if (expectPkce) {
    expect(flow.codeVerifier).toBeTruthy();
  } else {
    expect(flow.codeVerifier).toBeUndefined();
  }
}

function assertHealthContract(health: Tier1ConnectionHealth | TrackerHealth): void {
  expect(["healthy", "degraded", "auth_failed", "rate_limited", "provider_error", "disabled"]).toContain(health.status);
  assertIsoTimestamp(health.checkedAt);
  expect(typeof health.recommendedNextAction).toBe("string");
  expect(typeof health.details.auth).toBe("boolean");
  expect(typeof health.details.apiReachable).toBe("boolean");
  expect(typeof health.details.rateLimited).toBe("boolean");
  if (health.details.errorType) {
    expect(["auth", "rate-limit", "schema", "network", "upstream"]).toContain(health.details.errorType);
  }
}

describe("tier1 v1 contract", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      SLACK_CLIENT_ID: "client_123",
      SLACK_CLIENT_SECRET: "secret_123",
      SLACK_REDIRECT_URI: "https://autoflow.test/api/integrations/slack/oauth/callback",
      SLACK_SCOPES: "channels:read,chat:write",
      GOOGLE_CLIENT_ID: "google-client-123",
      GOOGLE_CLIENT_SECRET: "google-secret-123",
      GMAIL_REDIRECT_URI: "https://autoflow.test/api/integrations/gmail/oauth/callback",
      GMAIL_SCOPES:
        "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send",
      HUBSPOT_CLIENT_ID: "hubspot_client_123",
      HUBSPOT_CLIENT_SECRET: "hubspot_secret_123",
      HUBSPOT_REDIRECT_URI: "https://autoflow.test/api/integrations/hubspot/oauth/callback",
      HUBSPOT_SCOPES: "crm.objects.contacts.read crm.objects.contacts.write",
      STRIPE_CLIENT_ID: "ca_test_123",
      STRIPE_CLIENT_SECRET: "sk_test_platform_123",
      STRIPE_REDIRECT_URI: "https://autoflow.test/api/integrations/stripe/oauth/callback",
      STRIPE_OAUTH_SCOPE: "read_write",
      LINEAR_CLIENT_ID: "linear-client-123",
      LINEAR_CLIENT_SECRET: "linear-secret-123",
      LINEAR_REDIRECT_URI: "https://autoflow.test/api/integrations/linear/oauth/callback",
      LINEAR_SCOPES: "read write",
      SENTRY_CLIENT_ID: "sentry_client_123",
      SENTRY_CLIENT_SECRET: "sentry_secret_123",
      SENTRY_REDIRECT_URI: "https://autoflow.test/api/integrations/sentry/oauth/callback",
      SENTRY_SCOPES: "org:read project:read event:read",
      TEAMS_CLIENT_ID: "teams_client_123",
      TEAMS_CLIENT_SECRET: "teams_secret_123",
      TEAMS_REDIRECT_URI: "https://autoflow.test/api/integrations/teams/oauth/callback",
      TEAMS_SCOPES: "openid profile offline_access User.Read",
      TEAMS_TENANT_ID: "common",
    };
    jest.restoreAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("freezes exactly eight tier1 sdk surfaces for launch", () => {
    expect(TIER1_SDK_SURFACES).toEqual([
      "slack",
      "hubspot",
      "stripe",
      "gmail",
      "linear",
      "sentry",
      "microsoft-teams",
      "jira-ticket-sync",
    ]);
  });

  it.each([
    ["slack", true, () => new SlackConnectorService().beginOAuth("user-1")],
    ["hubspot", false, () => new HubSpotConnectorService().beginOAuth("user-1")],
    ["stripe", false, () => new StripeConnectorService().beginOAuth("user-1")],
    ["gmail", true, () => new GmailConnectorService().beginOAuth("user-1")],
    ["linear", true, () => new LinearConnectorService().beginOAuth("user-1")],
    ["sentry", true, () => new SentryConnectorService().beginOAuth("user-1")],
    ["microsoft-teams", true, () => new TeamsConnectorService().beginOAuth("user-1")],
  ])("keeps the %s auth lifecycle on the documented v1 shape", (_name, expectPkce, beginOAuth) => {
    assertOAuthFlow(beginOAuth(), expectPkce);
  });

  it.each([
    ["apollo", () => new ApolloConnectorService().health("missing-user")],
    ["slack", () => new SlackConnectorService().health("missing-user")],
    ["hubspot", () => new HubSpotConnectorService().health("missing-user")],
    ["stripe", () => new StripeConnectorService().health("missing-user")],
    ["gmail", () => new GmailConnectorService().health("missing-user")],
    ["linear", () => new LinearConnectorService().health("missing-user")],
    ["sentry", () => new SentryConnectorService().health("missing-user")],
    ["microsoft-teams", () => new TeamsConnectorService().health("missing-user")],
  ])("keeps the %s health reporting on the documented v1 shape", async (_name, loadHealth) => {
    const health = await loadHealth();
    assertHealthContract(health);
    expect(health.status).toBe("disabled");
    expect(health.details.auth).toBe(false);
    expect(health.recommendedNextAction).toMatch(/connect/i);
  });

  it("keeps jira ticket-sync health on the same error and health contract", async () => {
    jest.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ errorMessages: ["Unauthorized"] }), { status: 401 })
    );

    const health = await new JiraAdapter({
      site: "https://autoflow.atlassian.net",
      email: "ops@autoflow.test",
      apiToken: "jira_token",
      defaultProjectKey: "ALT",
    }).health();

    assertHealthContract(health);
    expect(health.provider).toBe("jira");
    expect(health.status).toBe("auth_failed");
    expect(health.lastErrorCategory).toBe("auth");
  });

  it("pins connector public types to the shared v1 contract", () => {
    const publicConnections = [
      {
        id: "slack-1",
        userId: "user-1",
        authMethod: "oauth2_pkce",
        tokenMasked: "****1234",
        scopes: ["chat:write"],
        teamId: "T123",
        teamName: "AutoFlow",
        createdAt: "2026-04-28T00:00:00.000Z",
      } satisfies SlackCredentialPublic satisfies Tier1ConnectionPublic<SlackAuthMethod, {
        scopes: string[];
        teamId: string;
        teamName?: string;
      }>,
      {
        id: "hubspot-1",
        userId: "user-1",
        authMethod: "oauth2",
        tokenMasked: "****1234",
        scopes: ["crm.objects.contacts.read"],
        hubId: "12345",
        createdAt: "2026-04-28T00:00:00.000Z",
      } satisfies HubSpotCredentialPublic satisfies Tier1ConnectionPublic<HubSpotAuthMethod, {
        scopes: string[];
        hubId: string;
        hubDomain?: string;
      }>,
      {
        id: "stripe-1",
        userId: "user-1",
        authMethod: "oauth2",
        tokenMasked: "****1234",
        scopes: ["read_write"],
        accountId: "acct_123",
        livemode: false,
        createdAt: "2026-04-28T00:00:00.000Z",
      } satisfies StripeCredentialPublic satisfies Tier1ConnectionPublic<StripeAuthMethod, {
        scopes: string[];
        accountId: string;
        accountName?: string;
        accountEmail?: string;
        livemode: boolean;
      }>,
      {
        id: "gmail-1",
        userId: "user-1",
        authMethod: "oauth2_pkce",
        tokenMasked: "****1234",
        scopes: ["gmail.readonly"],
        emailAddress: "ops@autoflow.test",
        createdAt: "2026-04-28T00:00:00.000Z",
      } satisfies GmailCredentialPublic satisfies Tier1ConnectionPublic<GmailAuthMethod, {
        scopes: string[];
        emailAddress: string;
      }>,
      {
        id: "linear-1",
        userId: "user-1",
        authMethod: "oauth2_pkce",
        tokenMasked: "****1234",
        scopes: ["read", "write"],
        organizationId: "org-1",
        createdAt: "2026-04-28T00:00:00.000Z",
      } satisfies LinearCredentialPublic satisfies Tier1ConnectionPublic<LinearAuthMethod, {
        scopes: string[];
        organizationId: string;
        organizationName?: string;
      }>,
      {
        id: "sentry-1",
        userId: "user-1",
        authMethod: "oauth2_pkce",
        tokenMasked: "****1234",
        scopes: ["org:read"],
        organizationId: "org-1",
        organizationSlug: "autoflow",
        createdAt: "2026-04-28T00:00:00.000Z",
      } satisfies SentryCredentialPublic satisfies Tier1ConnectionPublic<SentryAuthMethod, {
        scopes: string[];
        organizationId: string;
        organizationSlug: string;
        organizationName?: string;
      }>,
      {
        id: "teams-1",
        userId: "user-1",
        authMethod: "oauth2_pkce",
        tokenMasked: "****1234",
        scopes: ["User.Read"],
        accountId: "user-graph-1",
        createdAt: "2026-04-28T00:00:00.000Z",
      } satisfies TeamsCredentialPublic satisfies Tier1ConnectionPublic<TeamsAuthMethod, {
        scopes: string[];
        tenantId?: string;
        accountId?: string;
        accountName?: string;
      }>,
    ];

    expect(publicConnections).toHaveLength(7);
  });

  it("pins health interfaces to the shared v1 contract", () => {
    const healthShapes = [
      {
        status: "healthy",
        checkedAt: "2026-04-28T00:00:00.000Z",
        authMethod: "oauth2_pkce",
        teamId: "T123",
        recommendedNextAction: "No action required.",
        details: { auth: true, apiReachable: true, rateLimited: false },
      } satisfies SlackConnectionHealth satisfies Tier1ConnectionHealth<SlackAuthMethod, { teamId?: string }>,
      {
        status: "healthy",
        checkedAt: "2026-04-28T00:00:00.000Z",
        authMethod: "oauth2",
        hubId: "12345",
        recommendedNextAction: "No action required.",
        details: { auth: true, apiReachable: true, rateLimited: false },
      } satisfies HubSpotConnectionHealth satisfies Tier1ConnectionHealth<HubSpotAuthMethod, { hubId?: string }>,
      {
        status: "healthy",
        checkedAt: "2026-04-28T00:00:00.000Z",
        authMethod: "oauth2",
        accountId: "acct_123",
        recommendedNextAction: "No action required.",
        details: { auth: true, apiReachable: true, rateLimited: false },
      } satisfies StripeConnectionHealth satisfies Tier1ConnectionHealth<StripeAuthMethod, { accountId?: string }>,
      {
        status: "healthy",
        checkedAt: "2026-04-28T00:00:00.000Z",
        authMethod: "oauth2_pkce",
        emailAddress: "ops@autoflow.test",
        recommendedNextAction: "No action required.",
        details: { auth: true, apiReachable: true, rateLimited: false },
      } satisfies GmailConnectionHealth satisfies Tier1ConnectionHealth<GmailAuthMethod, { emailAddress?: string }>,
      {
        status: "healthy",
        checkedAt: "2026-04-28T00:00:00.000Z",
        authMethod: "oauth2_pkce",
        organizationId: "org-1",
        recommendedNextAction: "No action required.",
        details: { auth: true, apiReachable: true, rateLimited: false },
      } satisfies LinearConnectionHealth satisfies Tier1ConnectionHealth<LinearAuthMethod, { organizationId?: string }>,
      {
        status: "healthy",
        checkedAt: "2026-04-28T00:00:00.000Z",
        authMethod: "oauth2_pkce",
        organizationId: "org-1",
        organizationSlug: "autoflow",
        recommendedNextAction: "No action required.",
        details: { auth: true, apiReachable: true, rateLimited: false },
      } satisfies SentryConnectionHealth satisfies Tier1ConnectionHealth<SentryAuthMethod, {
        organizationId?: string;
        organizationSlug?: string;
      }>,
      {
        status: "healthy",
        checkedAt: "2026-04-28T00:00:00.000Z",
        authMethod: "oauth2_pkce",
        recommendedNextAction: "No action required.",
        details: { auth: true, apiReachable: true, rateLimited: false },
      } satisfies TeamsConnectionHealth satisfies Tier1ConnectionHealth<TeamsAuthMethod>,
      {
        status: "healthy",
        provider: "jira",
        checkedAt: "2026-04-28T00:00:00.000Z",
        recommendedNextAction: "No action required.",
        details: { auth: true, apiReachable: true, rateLimited: false },
      } satisfies TrackerHealth,
    ];

    healthShapes.forEach((health) => assertHealthContract(health));
    expect(healthShapes).toHaveLength(8);
  });
});
