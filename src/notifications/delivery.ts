import { integrationCredentialStore } from "../integrations/integrationCredentialStore";
import { slackCredentialStore } from "../integrations/slack/credentialStore";
import { SlackClient } from "../integrations/slack/slackClient";
import { renderNotificationTemplate } from "./templateRenderer";
import { NotificationEventRecord, NotificationTransportConfig } from "./types";

function requireConnection<T>(value: T | undefined | null, message: string): T {
  if (!value) {
    throw new Error(message);
  }
  return value;
}

async function sendSlack(config: NotificationTransportConfig, text: string): Promise<void> {
  const connectionId = requireConnection(config.connectionId, "Slack connection is not configured");
  const credential = slackCredentialStore.getById(connectionId, config.ownerUserId);
  if (!credential) {
    throw new Error("Slack connection is missing or revoked");
  }

  const channelId = requireConnection(config.config.slackChannelId, "Slack channel is required");
  const client = new SlackClient(slackCredentialStore.decryptAccessToken(credential));
  await client.sendMessage(channelId, text);
}

async function sendSendGrid(config: NotificationTransportConfig, rendered: ReturnType<typeof renderNotificationTemplate>): Promise<void> {
  const connectionId = requireConnection(config.connectionId, "SendGrid connection is not configured");
  const decrypted = integrationCredentialStore.getDecrypted(connectionId, config.ownerUserId);
  if (!decrypted || decrypted.connection.integrationSlug !== "sendgrid") {
    throw new Error("SendGrid connection is missing or invalid");
  }

  const token = decrypted.credentials.accessToken ?? decrypted.credentials.token;
  const toEmail = requireConnection(config.config.recipientEmail, "Recipient email is required");
  const fromEmail = requireConnection(config.config.fromEmail, "From email is required");
  if (!token) {
    throw new Error("SendGrid token is missing");
  }

  const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: toEmail }], subject: rendered.subject }],
      from: {
        email: fromEmail,
        name: config.config.fromName ?? "AutoFlow",
      },
      content: [
        { type: "text/plain", value: rendered.text },
        { type: "text/html", value: rendered.html },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`SendGrid send failed (${response.status})`);
  }
}

async function sendTwilio(config: NotificationTransportConfig, body: string): Promise<void> {
  const connectionId = requireConnection(config.connectionId, "Twilio connection is not configured");
  const decrypted = integrationCredentialStore.getDecrypted(connectionId, config.ownerUserId);
  if (!decrypted || decrypted.connection.integrationSlug !== "twilio") {
    throw new Error("Twilio connection is missing or invalid");
  }

  const username = decrypted.credentials.username;
  const password = decrypted.credentials.password;
  const accountSid = username;
  const toPhone = requireConnection(config.config.toPhone, "Destination phone is required");
  const fromPhone = requireConnection(config.config.fromPhone, "Source phone is required");
  if (!username || !password || !accountSid) {
    throw new Error("Twilio basic auth credentials are missing");
  }

  const payload = new URLSearchParams({
    To: toPhone,
    From: fromPhone,
    Body: body,
  });

  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: payload.toString(),
  });

  if (!response.ok) {
    throw new Error(`Twilio SMS send failed (${response.status})`);
  }
}

export async function deliverNotification(input: {
  transport: NotificationTransportConfig;
  events: NotificationEventRecord[];
  cadence: "immediate" | "daily" | "weekly";
  workspaceId: string;
  kind: NotificationEventRecord["kind"];
}): Promise<void> {
  const rendered = renderNotificationTemplate({
    workspaceId: input.workspaceId,
    channel: input.transport.channel,
    kind: input.kind,
    cadence: input.cadence,
    events: input.events,
  });

  switch (input.transport.channel) {
    case "slack":
      await sendSlack(input.transport, rendered.slack);
      return;
    case "email":
      await sendSendGrid(input.transport, rendered);
      return;
    case "sms":
      await sendTwilio(input.transport, rendered.sms);
      return;
  }
}
