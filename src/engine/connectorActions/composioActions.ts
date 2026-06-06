import { registerConnectorAction, type ConnectorActionInvocation } from "./registry";
import { isComposioEnabled } from "../../integrations/composio/broker/config";

function firstString(...values: unknown[]): string | undefined {
  for (const v of values) {
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

/**
 * HEL-753 / P3: the generic Composio execution action on the dynamic library.
 *
 * A workflow `action` step routes here with `action: "composio.execute"` and
 * `step.config.{toolkit, slug}` — the Composio app + tool to run. The step's
 * resolved inputs (its declared `inputKeys`) become the tool arguments; the run
 * owner's workspace scopes the connected account (Composio is workspace-scoped —
 * `userId = ws_<id>`, resolved inside the broker).
 *
 * Honest failure (throws → the step fails) when Composio is disabled, the
 * toolkit/slug is missing, no workspace is in scope, or the tool reports
 * `successful: false`. This is the REAL execution path that replaced the
 * fabricated `crm.upsertLead` / `content.publish` stubs — never a fake success.
 *
 * The broker is imported lazily inside `invoke` so registering this action at
 * module load stays cheap and never pulls the Composio SDK / stores into engine
 * module-eval or unrelated engine tests (mirrors the slack seed).
 */
async function composioExecute(
  invocation: ConnectorActionInvocation,
): Promise<Record<string, unknown>> {
  if (!isComposioEnabled()) {
    throw new Error(
      "composio.execute: Composio is not enabled (set COMPOSIO_ENABLED=true and COMPOSIO_API_KEY).",
    );
  }

  const stepConfig: Record<string, unknown> = invocation.step.config ?? {};
  const toolkit = firstString(stepConfig["toolkit"]);
  const slug = firstString(stepConfig["slug"], stepConfig["tool"]);
  if (!toolkit || !slug) {
    throw new Error(
      "composio.execute: step.config.toolkit and step.config.slug are required (the Composio app + tool to run).",
    );
  }
  if (!invocation.workspaceId) {
    throw new Error("composio.execute: a workspace is required to resolve the connected account.");
  }

  const { executeComposioTool } = await import("../../integrations/composio/broker/toolExecution");
  const result = await executeComposioTool({
    workspaceId: invocation.workspaceId,
    userId: invocation.userId,
    toolkit,
    slug,
    arguments: invocation.inputs,
    connectionId: invocation.connectionId,
  });

  if (!result.successful) {
    throw new Error(`composio.execute: ${slug} failed${result.error ? `: ${result.error}` : ""}`);
  }
  return result.data ?? {};
}

registerConnectorAction({
  connectorKey: "composio",
  actionId: "composio.execute",
  label: "Run a Composio tool",
  description:
    "Execute any connected Composio tool against this workspace's account — step.config.toolkit + step.config.slug pick the app + tool; the step's inputs are the arguments.",
  isWrite: true,
  invoke: composioExecute,
});
