/**
 * Comms gateway — the single internal callsite for outbound comms.
 *
 * `comms.send(...)` resolves a transport by (kind, channel), dedups on the
 * workspace-scoped `idempotencyKey`, records the attempt in the `comms_sends`
 * ledger, invokes the transport, and returns a structured result. Delivery
 * failures are recorded and returned (`status: 'failed'`); only programmer/
 * config errors (bad input, no transport) throw.
 *
 * `deliverExisting(...)` is the per-attempt unit shared with the durable worker
 * (HEL-612): it sends an already-ledgered row and throws on failure (a
 * {@link TransportError} carries retry classification) so the worker can retry
 * or dead-letter. Concrete provider transports (SES system mailer, Telnyx,
 * Vapi) register against {@link CommsGateway.registerTransport}.
 */

import { commsSendStore } from "./commsSendStore";
import { commsSpendStore } from "./commsSpendStore";
import { estimateCommsCostUsd } from "./pricing";
import * as providerHealth from "./providerHealth";
import {
  CommsChannel,
  CommsKind,
  CommsSendInput,
  CommsSendResult,
  CommsTransport,
  TransportError,
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
  // Per (kind, channel) key → providers in priority order. Registration order
  // is failover priority: the first registered is the primary, later ones are
  // fallbacks tried on a retryable failure (HEL-617).
  private readonly transports = new Map<string, CommsTransport[]>();
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
    // Append: registration order is failover priority within a (kind, channel).
    const key = kind ? exactKey(kind, channel) : defaultKey(channel);
    const existing = this.transports.get(key);
    if (existing) {
      existing.push(transport);
    } else {
      this.transports.set(key, [transport]);
    }
    return this;
  }

  /**
   * Priority-ordered transports for a (kind, channel): the kind-specific
   * providers first, then the channel-wide defaults. {@link deliverExisting}
   * tries them in order, failing over on a retryable failure (HEL-617).
   */
  private resolveTransports(kind: CommsKind, channel: CommsChannel): CommsTransport[] {
    const all = [
      ...(this.transports.get(exactKey(kind, channel)) ?? []),
      ...(this.transports.get(defaultKey(channel)) ?? []),
    ];
    // HEL-729: skip providers whose health circuit is open (proactive failover),
    // but never refuse to send — if every provider is degraded, try them all.
    const healthy = all.filter((t) => providerHealth.isHealthy(t.id));
    return healthy.length > 0 ? healthy : all;
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
    const transports = this.resolveTransports(input.kind, input.channel);
    if (transports.length === 0) {
      throw new Error(
        `comms.send: no transport registered for ${input.kind}/${input.channel}`,
      );
    }
    const primary = transports[0];

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
      provider: primary.id,
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
      return await this.deliverExisting({
        id: record.id,
        workspaceId: input.workspaceId,
        kind: input.kind,
        channel: input.channel,
        message,
        userId: input.userId,
        agentId: input.agentId,
        missionId: input.missionId,
        transports,
      });
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : String(err);
      await this.store.markFailed(input.workspaceId, record.id, errMessage, input.userId);
      return {
        id: record.id,
        status: "failed",
        deduped: false,
        provider: primary.id,
        error: errMessage,
      };
    }
  }

  /**
   * Deliver an already-ledgered send — the durable worker's per-attempt unit.
   * Resolves the transport, sends, and marks the row `sent`. Throws on failure
   * (a {@link TransportError} carries retry classification); the caller decides
   * whether to retry, dead-letter, or record the failure.
   */
  async deliverExisting(params: {
    id: string;
    workspaceId: string;
    kind: CommsKind;
    channel: CommsChannel;
    message: TransportMessage;
    userId?: string;
    agentId?: string;
    missionId?: string;
    transports?: CommsTransport[];
  }): Promise<CommsSendResult> {
    const transports =
      params.transports ?? this.resolveTransports(params.kind, params.channel);
    if (transports.length === 0) {
      throw new TransportError(
        `comms.deliver: no transport registered for ${params.kind}/${params.channel}`,
        { retryable: false },
      );
    }
    // Try providers in priority order, failing over to the next on a *retryable*
    // failure (5xx / network). A permanent (4xx / config) failure stops here — a
    // fallback would reject the same input. Each transport is handed the owning
    // workspace so tenancy-aware transports (managed Layer-C email) can resolve
    // policy / config set / tagging (HEL-615); a suppressed recipient short-
    // circuits without failover. If every provider fails (last error retryable),
    // rethrow so the durable worker retries the whole job (HEL-617).
    const message: TransportMessage = { ...params.message, workspaceId: params.workspaceId };
    let lastError: unknown;
    for (let i = 0; i < transports.length; i++) {
      const transport = transports[i];
      try {
        const result = await transport.send(message);
        providerHealth.recordSuccess(transport.id);
        if (result.suppressed) {
          await this.store.markSuppressed(
            params.workspaceId,
            params.id,
            result.suppressedReason ?? "suppressed",
            params.userId,
          );
          return {
            id: params.id,
            status: "suppressed",
            deduped: false,
            provider: transport.id,
          };
        }
        await this.store.markSent(
          params.workspaceId,
          params.id,
          { provider: transport.id, providerMessageId: result.providerMessageId },
          params.userId,
        );
        await this.recordSpend(params, transport.id);
        return {
          id: params.id,
          status: "sent",
          deduped: false,
          provider: transport.id,
          providerMessageId: result.providerMessageId,
        };
      } catch (err) {
        lastError = err;
        const retryable = err instanceof TransportError ? err.retryable : true;
        if (retryable) {
          providerHealth.recordFailure(transport.id);
        }
        const isLast = i === transports.length - 1;
        if (!retryable || isLast) {
          throw err instanceof Error ? err : new TransportError(String(err), {});
        }
        console.warn(
          `[comms] transport '${transport.id}' failed (retryable) for ${params.id}; ` +
            `failing over to '${transports[i + 1].id}': ` +
            (err instanceof Error ? err.message : String(err)),
        );
      }
    }
    // Unreachable — the loop always returns or throws — but satisfies the checker.
    throw lastError instanceof Error
      ? lastError
      : new TransportError("comms.deliver: all transports failed", {});
  }

  /**
   * Best-effort spend attribution (HEL-611) — never fail a delivered message on
   * a spend-ledger error.
   */
  private async recordSpend(
    params: {
      id: string;
      workspaceId: string;
      channel: CommsChannel;
      userId?: string;
      agentId?: string;
      missionId?: string;
    },
    providerId: string,
  ): Promise<void> {
    try {
      await commsSpendStore.recordSpend({
        workspaceId: params.workspaceId,
        userId: params.userId,
        agentId: params.agentId,
        missionId: params.missionId,
        commsSendId: params.id,
        channel: params.channel,
        provider: providerId,
        units: 1,
        costUsd: estimateCommsCostUsd(params.channel, providerId, 1),
      });
    } catch (err) {
      console.error(
        `[comms] spend record failed for ${params.id}: ${(err as Error).message}`,
      );
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
