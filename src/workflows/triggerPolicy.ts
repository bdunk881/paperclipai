import { integrationCredentialStore } from "../integrations/integrationCredentialStore";
import { TriggerPolicy, WorkflowTemplate } from "../types/workflow";

type TriggerEntrypoint = "manual_run" | "generic_webhook";

type EvaluateTriggerPolicyInput = {
  template: WorkflowTemplate;
  entrypoint: TriggerEntrypoint;
  userId?: string;
  input: Record<string, unknown>;
};

function isExternalEventPolicy(policy: TriggerPolicy | undefined): policy is TriggerPolicy {
  return policy?.mode === "external_event";
}

function devMockRunsEnabled(): boolean {
  return process.env.AUTOFLOW_ALLOW_DEV_TRIGGER_RUNS === "true";
}

function inputRequestsDevMock(input: Record<string, unknown>): boolean {
  return input["__autoflowAllowMockTrigger"] === true;
}

function ensureConnectedIntegration(userId: string, integrationSlug: string, templateName: string): void {
  if (integrationCredentialStore.list(userId, integrationSlug).length > 0) {
    return;
  }

  throw new Error(
    `${templateName} requires a connected ${integrationSlug} integration before a live trigger can start a run.`
  );
}

export function assertTriggerCanStart({
  template,
  entrypoint,
  userId,
  input,
}: EvaluateTriggerPolicyInput): void {
  const policy = template.triggerPolicy;
  if (!isExternalEventPolicy(policy)) {
    return;
  }

  if (entrypoint === "manual_run") {
    if (devMockRunsEnabled() && inputRequestsDevMock(input)) {
      if (policy.integrationSlug && userId) {
        ensureConnectedIntegration(userId, policy.integrationSlug, template.name);
      }
      return;
    }

    throw new Error(
      `${template.name} only starts from real upstream events. Manual sample runs are disabled unless AUTOFLOW_ALLOW_DEV_TRIGGER_RUNS=true and __autoflowAllowMockTrigger=true are both set.`
    );
  }

  if (!policy.allowGenericWebhook) {
    throw new Error(
      `${template.name} does not accept generic webhook starts. Use the provider-specific integration trigger instead.`
    );
  }

  if (policy.integrationSlug) {
    if (!userId) {
      throw new Error(
        `${template.name} requires X-User-Id and a connected ${policy.integrationSlug} integration for webhook starts.`
      );
    }

    ensureConnectedIntegration(userId, policy.integrationSlug, template.name);
  }
}
