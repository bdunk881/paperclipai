import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Integration SDK v1",
};

export default function IntegrationSdkV1Page() {
  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-2">Integration SDK v1 Contract</h1>
      <p className="text-lg text-gray-500 mb-8">
        AutoFlow launch freezes the Tier 1 connector surface as <code>v1</code>. New connector work
        should target these lifecycle hooks, auth abstractions, error semantics, and health reporting
        rules without needing ad hoc clarification.
      </p>

      <h2 id="scope" className="text-xl font-semibold text-gray-900 mb-3">
        Covered connectors
      </h2>
      <ul className="list-disc pl-5 text-gray-600 space-y-1 mb-8">
        <li>Slack</li>
        <li>HubSpot</li>
        <li>Stripe</li>
        <li>Gmail</li>
        <li>Linear</li>
        <li>Sentry</li>
        <li>Microsoft Teams</li>
        <li>Jira ticket-sync</li>
      </ul>

      <h2 id="lifecycle" className="text-xl font-semibold text-gray-900 mb-3">
        Lifecycle hooks
      </h2>
      <p className="text-gray-600 mb-3">
        Tier 1 services expose a common execution lifecycle. OAuth-based connectors must support auth
        flow initialization and completion; all connectors must support connection testing, health
        reporting, listing active connections, and revocation.
      </p>
      <pre className="mb-8">{`type Tier1OAuthStartResult = {
  authUrl: string;
  state: string;
  expiresInSeconds: number;
  codeVerifier?: string; // PKCE connectors only
};

interface Tier1ConnectorLifecycle<CredentialPublic, Health> {
  beginOAuth(userId: string): Tier1OAuthStartResult;
  completeOAuth(params: { code: string; state: string }): Promise<CredentialPublic>;
  connectApiKey(params: { userId: string; apiKey?: string; accessToken?: string }): Promise<CredentialPublic>;
  listConnections(userId: string): Promise<CredentialPublic[]> | CredentialPublic[];
  testConnection(userId: string): Promise<Record<string, string | undefined>>;
  health(userId: string): Promise<Health>;
  disconnect(userId: string, credentialId: string): Promise<boolean> | boolean;
}`}</pre>

      <h2 id="auth" className="text-xl font-semibold text-gray-900 mb-3">
        Auth abstractions
      </h2>
      <p className="text-gray-600 mb-3">
        Each connector stores a provider-specific public connection shape, but the shared contract
        freezes the common fields: <code>id</code>, <code>userId</code>, <code>authMethod</code>,
        <code>tokenMasked</code>, <code>createdAt</code>, and optional <code>revokedAt</code>.
      </p>
      <pre className="mb-8">{`interface Tier1ConnectionPublic<TAuthMethod extends string, TMetadata> {
  id: string;
  userId: string;
  authMethod: TAuthMethod;
  tokenMasked: string;
  createdAt: string;
  revokedAt?: string;
} & TMetadata

// Examples:
// Slack -> { scopes, teamId, teamName? }
// Gmail -> { scopes, emailAddress }
// Stripe -> { scopes, accountId, accountName?, accountEmail?, livemode }`}</pre>

      <h2 id="errors" className="text-xl font-semibold text-gray-900 mb-3">
        Error contract and retry classification
      </h2>
      <p className="text-gray-600 mb-3">
        Tier 1 connectors and Jira ticket-sync share the same error taxonomy. This taxonomy is the
        launch contract and should not change without a major version bump.
      </p>
      <ul className="list-disc pl-5 text-gray-600 space-y-1 mb-4">
        <li><code>auth</code>: invalid credentials, revoked scopes, forbidden access</li>
        <li><code>rate-limit</code>: provider throttling and <code>429</code> responses</li>
        <li><code>schema</code>: malformed request payloads and permanent <code>4xx</code> errors</li>
        <li><code>network</code>: transport failure before a usable response</li>
        <li><code>upstream</code>: transient provider-side failures and retriable <code>5xx</code> errors</li>
      </ul>
      <p className="text-gray-600 mb-3">
        Automatic retries are allowed only for <code>rate-limit</code>, <code>network</code>, and
        <code>upstream</code>. Auth and schema failures fail fast.
      </p>
      <p className="text-gray-600 mb-8">
        Retry budgets and recovery expectations for each Tier 1 connector are documented in{" "}
        <code>docs/integrations/tier1-retry-policy.md</code>.
      </p>

      <h2 id="health" className="text-xl font-semibold text-gray-900 mb-3">
        Health reporting interface
      </h2>
      <p className="text-gray-600 mb-3">
        All Tier 1 connectors surface the same health envelope so QA, dashboards, and operational
        runbooks can rely on one shape.
      </p>
      <pre className="mb-8">{`interface Tier1ConnectionHealth<TAuthMethod extends string, TMetadata> {
  status: "ok" | "degraded" | "down";
  checkedAt: string; // ISO-8601
  authMethod?: TAuthMethod;
  tokenRefreshStatus?: "not_applicable" | "healthy" | "failed";
  details: {
    auth: boolean;
    apiReachable: boolean;
    rateLimited: boolean;
    errorType?: "auth" | "rate-limit" | "schema" | "network" | "upstream";
    message?: string;
  };
} & TMetadata`}</pre>

      <h2 id="examples" className="text-xl font-semibold text-gray-900 mb-3">
        Examples
      </h2>
      <p className="text-gray-600 mb-3">
        Start an OAuth flow:
      </p>
      <pre className="mb-6">{`POST /api/integrations/slack/oauth/start
Authorization: Bearer <user-jwt>

{
  "authUrl": "https://slack.com/oauth/v2/authorize?...",
  "state": "slack_pkce_state",
  "expiresInSeconds": 600,
  "codeVerifier": "pkce_verifier"
}`}</pre>
      <p className="text-gray-600 mb-3">
        Consume a health response:
      </p>
      <pre className="mb-6">{`GET /api/integrations/stripe/health

{
  "status": "degraded",
  "checkedAt": "2026-04-28T14:05:12.001Z",
  "authMethod": "oauth2",
  "accountId": "acct_123",
  "details": {
    "auth": true,
    "apiReachable": true,
    "rateLimited": true,
    "errorType": "rate-limit",
    "message": "Stripe API rate limit exceeded"
  }
}`}</pre>
      <p className="text-gray-600 mb-8">
        Version migration policy:
      </p>
      <pre className="mb-8">{`v1 -> v2 rules
1. Additive fields or new endpoints may ship in minor releases.
2. Renaming or removing contract fields requires a major version bump.
3. Every breaking change must ship with migration notes and updated examples.
4. Tier 1 contract tests must pass before a new major version is published.`}</pre>

      <div className="mt-10 rounded-xl border border-indigo-100 bg-indigo-50 px-5 py-4">
        <p className="text-sm font-semibold text-indigo-800">
          Verification: Tier 1 contract tests live in{" "}
          <code>src/integrations/shared/tier1Contract.test.ts</code>.
        </p>
      </div>
    </div>
  );
}
