/**
 * Core type definitions for the API Integration Framework.
 *
 * An IntegrationManifest describes everything needed to connect to a
 * third-party REST/webhook service: auth requirements, available actions,
 * and trigger types.  The framework is config-driven — new integrations can
 * be registered without a code deploy.
 */

// ---------------------------------------------------------------------------
// Auth kinds
// ---------------------------------------------------------------------------

/** How the integration authenticates outbound requests. */
export type AuthKind =
  | "none"                       // No auth required
  | "api_key"                    // Static API key sent via a configured header
  | "bearer"                     // Bearer token in Authorization header
  | "basic"                      // HTTP Basic Auth (username + password)
  | "oauth2_pkce"                // OAuth2 Authorization Code + PKCE (user-facing)
  | "oauth2_client_credentials"; // OAuth2 Client Credentials (server-to-server)

/** OAuth2 endpoint configuration (used for both PKCE and client-credentials flows). */
export interface OAuth2Config {
  authorizationUrl: string; // e.g. "https://accounts.google.com/o/oauth2/v2/auth"
  tokenUrl: string;          // e.g. "https://oauth2.googleapis.com/token"
  scopes: string[];          // Default scopes to request
  /** Documentation hint about the env-var / dashboard field for the client ID */
  clientIdHint?: string;
  /** Documentation hint for the client secret */
  clientSecretHint?: string;
}

// ---------------------------------------------------------------------------
// Field schema (used for action inputs)
// ---------------------------------------------------------------------------

export type FieldType = "string" | "number" | "boolean" | "object" | "string[]";

export interface FieldSchema {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  description?: string;
  /** For string fields: restrict to these enum options */
  options?: string[];
}

// ---------------------------------------------------------------------------
// Actions — outbound REST calls
// ---------------------------------------------------------------------------

/** A single action the integration can perform (authenticated outbound call). */
export interface IntegrationAction {
  /** Dot-separated ID, e.g. "contacts.create" or "deals.update" */
  id: string;
  name: string;
  description: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /**
   * URL path template appended to the integration's baseUrl.
   * Supports {{key}} interpolation from the action input.
   * e.g. "/v1/contacts/{{contactId}}"
   */
  path: string;
  /** Fields the caller must / may supply as the request body or query params */
  inputSchema: FieldSchema[];
  /** Top-level keys present in the response JSON (informational) */
  outputKeys: string[];
}

// ---------------------------------------------------------------------------
// Triggers — inbound events that start a workflow
// ---------------------------------------------------------------------------

export type TriggerKind = "webhook" | "polling";

/** A trigger that can fire a workflow run when an external event occurs. */
export interface IntegrationTrigger {
  /** Dot-separated ID, e.g. "deal.created" or "contact.updated" */
  id: string;
  name: string;
  description: string;
  kind: TriggerKind;
  // -- Webhook-specific --
  /** Event type strings the service sends in the webhook payload */
  webhookEventTypes?: string[];
  // -- Polling-specific --
  /** Path template to poll; supports {{lastPollAt}} (ISO timestamp) */
  pollingPath?: string;
  pollingIntervalMs?: number;
}

// ---------------------------------------------------------------------------
// Integration manifest
// ---------------------------------------------------------------------------

export type IntegrationCategory =
  | "analytics"
  | "calendar"
  | "communication"
  | "crm"
  | "devtools"
  | "ecommerce"
  | "esign"
  | "finance"
  | "hr"
  | "identity"
  | "itsm"
  | "marketing"
  | "productivity"
  | "storage"
  | "support";

/** Full specification for one API integration. */
export interface IntegrationManifest {
  /** URL-safe slug used as a stable identifier, e.g. "salesforce" */
  slug: string;
  name: string;
  description: string;
  category: IntegrationCategory;
  /** Icon identifier matching the dashboard icon set */
  icon: string;
  authKind: AuthKind;
  /** Required when authKind is "oauth2_pkce" or "oauth2_client_credentials" */
  oauth2Config?: OAuth2Config;
  /** Header name used when authKind is "api_key", e.g. "X-API-Key" */
  authHeaderKey?: string;
  /**
   * Base URL for all API calls.
   * Supports {{instanceDomain}} substitution for multi-tenant services
   * (e.g. Salesforce, ServiceNow).
   */
  baseUrl: string;
  /** Alternative base URL for sandbox/test environments */
  sandboxBaseUrl?: string;
  /** Human-readable setup instructions shown in the connection wizard */
  setupInstructions: string;
  /** Available outbound actions */
  actions: IntegrationAction[];
  /** Available inbound triggers */
  triggers: IntegrationTrigger[];
  /** Whether this integration has been verified by the AutoFlow team */
  verified: boolean;
  /** Link to official API docs */
  docsUrl?: string;
}

// ---------------------------------------------------------------------------
// Runtime connection record (what gets stored per user)
// ---------------------------------------------------------------------------

/** Auth material stored in the credential vault (before encryption). */
export interface IntegrationCredentials {
  /** For api_key / bearer: the token */
  token?: string;
  /** For basic auth */
  username?: string;
  password?: string;
  /** For oauth2_pkce / oauth2_client_credentials */
  accessToken?: string;
  refreshToken?: string;
  accessTokenExpiresAt?: string; // ISO timestamp
  clientId?: string;
  clientSecret?: string;
  /** For multi-tenant services that require an instance URL */
  instanceDomain?: string;
  /** Raw extra fields (service-specific) */
  extra?: Record<string, string>;
}

/** A saved connection record (stored in the credential vault). */
export interface IntegrationConnection {
  id: string;
  userId: string;
  integrationSlug: string;
  /** Friendly label the user sets, e.g. "My HubSpot (Work)" */
  label: string;
  /** Whether this is the user's default connection for this integration */
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  /** Credentials are stored encrypted — this is the opaque ciphertext. */
  credentialsEncrypted: string;
}

/** Public view of a connection (credentials omitted). */
export type IntegrationConnectionPublic = Omit<IntegrationConnection, "credentialsEncrypted">;
