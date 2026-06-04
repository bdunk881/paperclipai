/**
 * Comms gateway — shared types (project "Comms gateway + managed comms").
 *
 * The gateway is the single internal callsite for outbound comms. Callers
 * describe *what* to send (kind/channel/recipient/template); the gateway
 * resolves *how* (which provider transport), dedups on `idempotencyKey`,
 * records every attempt in the `comms_sends` ledger, and returns a structured
 * result. Provider transports plug in behind {@link CommsTransport}.
 *
 * Layer A/B system mail (SES + Supabase-Auth-on-Resend) is owned by the
 * sibling "Internal mailer on SES" project; this gateway treats that mailer as
 * one injected transport once it lands. Layer D BYOC (per-workspace
 * SendGrid/Twilio) continues to flow through src/notifications/delivery.ts.
 */

/** Which reputation layer a send belongs to — drives transport resolution. */
export type CommsKind = "auth" | "system" | "customer";

/** Delivery channel. `voice` is reserved for the Vapi transport (later ticket). */
export type CommsChannel = "email" | "sms" | "voice";

/** Lifecycle of a single ledgered send attempt. */
export type CommsSendStatus = "queued" | "sent" | "failed" | "suppressed";

/** Input to {@link CommsGateway.send}. */
export interface CommsSendInput {
  /** Owning workspace (tenant). Required for every send. */
  workspaceId: string;
  /** Acting user, when user-initiated. System sends omit this. */
  userId?: string;
  /** Attribution: the agent on whose behalf the send happens. */
  agentId?: string;
  /** Attribution: the mission this send belongs to. */
  missionId?: string;
  kind: CommsKind;
  channel: CommsChannel;
  /** Recipient — an email address or E.164 phone number, per channel. */
  to: string;
  /** Caller-supplied dedup key, unique within a workspace. */
  idempotencyKey: string;
  /** Optional template identifier (free-form until the template registry lands). */
  template?: string;
  /** Pre-rendered subject (email). */
  subject?: string;
  /** Pre-rendered plain-text body. */
  text?: string;
  /** Pre-rendered HTML body (email). */
  html?: string;
  /** Template variables, when a transport renders server-side. */
  vars?: Record<string, unknown>;
}

/**
 * Result of {@link CommsGateway.send}. Delivery failures are returned with
 * `status: 'failed'`, not thrown — only programmer/config errors throw.
 */
export interface CommsSendResult {
  /** `comms_sends` row id. */
  id: string;
  status: CommsSendStatus;
  /** True when an existing row matched `idempotencyKey` and no new send happened. */
  deduped: boolean;
  /** Id of the transport that handled it. */
  provider?: string;
  /** Provider-side message id, when the transport returned one. */
  providerMessageId?: string;
  /** Failure detail when `status === 'failed'`. */
  error?: string;
}

/** Normalized message handed to a transport. */
export interface TransportMessage {
  to: string;
  subject?: string;
  text?: string;
  html?: string;
  vars?: Record<string, unknown>;
}

/** Outcome of a transport send. Transports throw on failure. */
export interface TransportResult {
  /** Provider-side message id, when available. */
  providerMessageId?: string;
}

/** A provider-pluggable delivery transport for one channel. */
export interface CommsTransport {
  /** Stable provider id recorded on the ledger row, e.g. 'ses' | 'resend' | 'telnyx'. */
  readonly id: string;
  /** Channel this transport handles. */
  readonly channel: CommsChannel;
  /** Deliver the message. Resolve on success; reject (throw) on failure. */
  send(message: TransportMessage): Promise<TransportResult>;
}

/** A persisted `comms_sends` ledger row. */
export interface CommsSendRecord {
  id: string;
  workspaceId: string;
  agentId?: string;
  missionId?: string;
  kind: CommsKind;
  channel: CommsChannel;
  to: string;
  template?: string;
  provider?: string;
  idempotencyKey: string;
  status: CommsSendStatus;
  providerMessageId?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  sentAt?: string;
}
