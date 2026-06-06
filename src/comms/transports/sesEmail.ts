/**
 * Managed Layer-C customer-facing email transport (HEL-615).
 *
 * The comms gateway's `kind:'customer'` email sender. Sends through AWS SES v2
 * from the Layer-C identity (`via.helloautoflow.com`, `AUTOFLOW_CUSTOMER_EMAIL_FROM`)
 * using a **per-tier configuration set** — SES binds a dedicated IP pool to the
 * config set, so this is how per-tier pools + reputation isolation from Layer
 * A/B system mail are achieved. Honors suppression + the managed-email opt-in
 * policy (opt-out ⇒ `{suppressed}`; BYOC routing for opted-out tenants is HEL-716).
 *
 * The SES SDK call sits behind a DI seam (`sendEmail`) so the transport is
 * unit-testable without the AWS SDK, mirroring `src/mailer/sesMailer.ts`.
 */

import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import {
  TransportError,
  type CommsTransport,
  type TransportMessage,
  type TransportResult,
} from "../types";
import {
  evaluateManagedEmail,
  type ManagedEmailPolicyDeps,
} from "../customerEmailPolicy";

function normalizeEnv(name: string): string | undefined {
  const raw = process.env[name];
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  return trimmed.length > 0 ? trimmed : undefined;
}

export interface SesEmailSendArgs {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  workspaceId: string;
  configurationSet: string | undefined;
}

let _client: SESv2Client | null = null;
function sesClient(): SESv2Client {
  if (!_client) {
    const region = normalizeEnv("SES_REGION") ?? normalizeEnv("AWS_REGION") ?? "us-east-1";
    _client = new SESv2Client({ region });
  }
  return _client;
}

async function defaultSesEmailSend(args: SesEmailSendArgs): Promise<{ messageId?: string }> {
  const command = new SendEmailCommand({
    FromEmailAddress: args.from,
    Destination: { ToAddresses: [args.to] },
    ConfigurationSetName: args.configurationSet,
    EmailTags: [{ Name: "workspace_id", Value: args.workspaceId }],
    Content: {
      Simple: {
        Subject: { Data: args.subject, Charset: "UTF-8" },
        Body: {
          Html: { Data: args.html, Charset: "UTF-8" },
          Text: { Data: args.text, Charset: "UTF-8" },
        },
      },
    },
  });
  try {
    const result = await sesClient().send(command);
    return { messageId: result.MessageId };
  } catch (err) {
    // Map SES errors to TransportError so the durable worker retries 5xx /
    // dead-letters 4xx (TransportError classifies on status).
    const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata
      ?.httpStatusCode;
    throw new TransportError(`SES send failed: ${(err as Error).message}`, { status });
  }
}

/** True when the Layer-C customer-email identity is configured. */
export function isSesCustomerEmailConfigured(): boolean {
  return Boolean(normalizeEnv("AUTOFLOW_CUSTOMER_EMAIL_FROM"));
}

export interface SesEmailTransportDeps {
  /** Low-level SES send (test injection). Defaults to the SESv2 SDK. */
  sendEmail?: (args: SesEmailSendArgs) => Promise<{ messageId?: string }>;
  /** From identity override (else `AUTOFLOW_CUSTOMER_EMAIL_FROM`). */
  from?: string;
  /** Managed-email policy dep injection (suppression / plan / override). */
  policy?: ManagedEmailPolicyDeps;
  /** Full decision override (test). Defaults to `evaluateManagedEmail`. */
  evaluate?: typeof evaluateManagedEmail;
}

export class SesEmailTransport implements CommsTransport {
  readonly id = "ses";
  readonly channel = "email" as const;
  private readonly sendEmail: (args: SesEmailSendArgs) => Promise<{ messageId?: string }>;
  private readonly fromOverride?: string;
  private readonly policyDeps?: ManagedEmailPolicyDeps;
  private readonly evaluate: typeof evaluateManagedEmail;

  constructor(deps: SesEmailTransportDeps = {}) {
    this.sendEmail = deps.sendEmail ?? defaultSesEmailSend;
    this.fromOverride = deps.from;
    this.policyDeps = deps.policy;
    this.evaluate = deps.evaluate ?? evaluateManagedEmail;
  }

  async send(message: TransportMessage): Promise<TransportResult> {
    const workspaceId = message.workspaceId;
    if (!workspaceId) {
      // The gateway always sets workspaceId for a ledgered send — its absence
      // is a programmer error, not a retryable delivery failure.
      throw new TransportError("managed email: workspaceId missing on message", {
        retryable: false,
      });
    }

    const decision = await this.evaluate(workspaceId, message.to, this.policyDeps);
    if (decision.action === "suppressed") {
      return { suppressed: true, suppressedReason: decision.reason };
    }

    const from = this.fromOverride ?? normalizeEnv("AUTOFLOW_CUSTOMER_EMAIL_FROM");
    if (!from) {
      throw new TransportError("AUTOFLOW_CUSTOMER_EMAIL_FROM is not configured", {
        retryable: false,
      });
    }

    const result = await this.sendEmail({
      from,
      to: message.to,
      subject: message.subject ?? "",
      html: message.html ?? "",
      text: message.text ?? "",
      workspaceId,
      configurationSet: decision.configurationSet,
    });
    return { providerMessageId: result.messageId };
  }
}
