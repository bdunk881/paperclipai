import { registerConnectorAction, type ConnectorActionInvocation } from "./registry";

function firstString(...values: unknown[]): string | undefined {
  for (const v of values) {
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

/**
 * HEL-656 / HEL-647: real `slack.notify` on the dynamic action library.
 *
 * Posts to a Slack channel via the run owner's connected Slack
 * (`slackConnectorService.sendMessage`, HEL-651). Honest failure (throws →
 * the step fails) when Slack isn't connected or no channel is configured —
 * never a fabricated success.
 *
 * The Slack connector is imported **lazily inside `invoke`** so registering
 * this action (at module load) stays cheap and never pulls the connector +
 * its credential vault into engine module-eval / unrelated engine tests.
 *
 * Connection selection: `invocation.connectionId` is threaded for when the
 * run owner holds several Slack teams; resolving a *specific* connection
 * (vs the active one) is a follow-up on the connector method.
 */
async function slackNotify(
  invocation: ConnectorActionInvocation,
): Promise<Record<string, unknown>> {
  const stepConfig: Record<string, unknown> = invocation.step.config ?? {};
  const channel = firstString(stepConfig["channel"], invocation.inputs["channel"]);
  const text =
    firstString(stepConfig["message"], invocation.inputs["message"], invocation.inputs["text"]) ??
    "";
  if (!channel) {
    throw new Error("slack.notify: no channel configured (set step.config.channel)");
  }
  const { slackConnectorService } = await import("../../integrations/slack/service");
  const result = await slackConnectorService.sendMessage(invocation.userId, channel, text);
  return { sent: true, channel: result.channel, ts: result.ts };
}

registerConnectorAction({
  connectorKey: "slack",
  actionId: "slack.notify",
  label: "Send a Slack notification",
  description: "Post a message to a Slack channel via your connected Slack workspace.",
  isWrite: true,
  invoke: slackNotify,
});

// Curated templates use this alias (src/templates/additional-templates.ts).
registerConnectorAction({
  connectorKey: "slack",
  actionId: "slack.dispatchNotification",
  label: "Send a Slack notification",
  description: "Post a message to a Slack channel via your connected Slack workspace.",
  isWrite: true,
  invoke: slackNotify,
});
