/**
 * Comms gateway — the single internal callsite for outbound comms.
 *
 * `comms.send(...)` resolves a transport by (kind, channel), dedups on the
 * workspace-scoped `idempotencyKey`, records the attempt in the `comms_sends`
 * ledger, invokes the transport, and returns a structured result. Delivery
 * failures are recorded and returned (`status: 'failed'`); only programmer/
 * config errors (bad input, no transport) throw.
 *
 * This is the foundation PR: synchronous send path only. BullMQ retry/DLQ,
 * spend attribution, inbound webhooks, and the concrete provider transports
 * (SES system mailer, Telnyx, Vapi) land in follow-up tickets and register
 * against {@link CommsGateway.registerTransport}.
 */

import { commsSendStore } from "./commsSendStore";
import {
  CommsChannel,
  CommsKind,
  CommsSendInput,
  CommsSendResult,
  CommsTransport,
  TransportMessage,
} from "./types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type CommsSendStore = typeof commsSendStore;

function exactKey(kind: CommsKind, channel: CommsChannel): string {
  return `${kind}:${channel}`;
}

function defaultKey(channel: CommsChannel): string {
  return `*:${channel}`;
}

export interface CommsGatewayDeps {
  /** Override the ledger store (test injection point). */
  store?: CommsSendStore;
}

export class CommsGateway {
  private readonly transports = new Map<string, CommsTransport>();
  private readonly store: CommsSendStore;

  constructor(deps: CommsGatewayDeps = {}) {
    this.store = deps.store ?? commsSendStore;
  }

  /**
   * Register a transport for a channel. Pass `kind` to bind it to a specific
   * reputation layer; omit `kind` to register the channel-wide default used
   * when no kind-specific transport exists. Returns `this` for chaining.
   */
  registerTransport(channel: CommsChannel, transport: CommsTransport, kind?: CommsKind): this {
    if (transport.channel !== channel) {
      throw new Error(
        `Transport ${transport.id} handles '${transport.channel}', not '${channel}'`,
      );
    }
    this.transports.set(kind ? exactKey(kind, channel) : defaultKey(channel), transport);
    return this;
  }

  private resolveTransport(kind: CommsKind, channel: CommsChannel): CommsTransport | undefined {
    return this.transports.get(exactKey(kind, channel)) ?? this.transports.get(defaultKey(channel));
  }

  async send(input: CommsSendInput): Promise<CommsSendResult> {
    // Programmer/config errors throw; delivery failures are returned below.
    if (!input.workspaceId || !UUID_RE.test(input.workspaceId)) {
      throw new Error("comms.send: a valid workspaceId is required");
    }
    if (!input.idempotencyKey || !input.idempotencyKey.trim()) {
      throw new Error("comms.send: idempotencyKey is required");
    }
    if (!input.to || !input.to.trim()) {
      throw new Error("comms.send: a recipient (to) is required");
    }
    const transport = this.resolveTransport(input.kind, input.channel);
    if (!transport) {
      throw new Error(
        `comms.send: no transport registered for ${input.kind}/${input.channel}`,
      );
    }

    // Idempotency: an existing row short-circuits before any provider call.
    const existing = await this.store.findByIdempotencyKey(
      input.workspaceId,
      input.idempotencyKey,
      input.userId,
    );
    if (existing) {
      return dedupResult(existing);
    }

    const { record, created } = await this.store.insertQueued({
      workspaceId: input.workspaceId,
      userId: input.userId,
      agentId: input.agentId,
      missionId: input.missionId,
      kind: input.kind,
      channel: input.channel,
      to: input.to,
      idempotencyKey: input.idempotencyKey,
      template: input.template,
      provider: transport.id,
    });
    // Lost the insert race against a concurrent identical send.
    if (!created) {
      return dedupResult(record);
    }

    const message: TransportMessage = {
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
      vars: input.vars,
    };

    try {
      const result = await transport.send(message);
      await this.store.markSent(
        input.workspaceId,
        record.id,
        { provider: transport.id, providerMessageId: result.providerMessageId },
        input.userId,
      );
      return {
        id: record.id,
        status: "sent",
        deduped: false,
        provider: transport.id,
        providerMessageId: result.providerMessageId,
      };
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : String(err);
      await this.store.markFailed(input.workspaceId, record.id, errMessage, input.userId);
      return {
        id: record.id,
        status: "failed",
        deduped: false,
        provider: transport.id,
        error: errMessage,
      };
    }
  }
}

function dedupResult(record: {
  id: string;
  status: CommsSendResult["status"];
  provider?: string;
  providerMessageId?: string;
  error?: string;
}): CommsSendResult {
  return {
    id: record.id,
    status: record.status,
    deduped: true,
    provider: record.provider,
    providerMessageId: record.providerMessageId,
    error: record.error,
  };
}

/** Process-wide default gateway. Transports are registered at startup. */
export const commsGateway = new CommsGateway();
