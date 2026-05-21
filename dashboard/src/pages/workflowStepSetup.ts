import type { Edge } from "@xyflow/react";
import type { LLMConfig } from "../api/client";
import type { StepKind, WorkflowStep, WorkflowTemplate } from "../types/workflow";
import { validateGraphTopology } from "./workflowGraph";

const TRIGGER_KINDS: ReadonlySet<StepKind> = new Set([
  "trigger",
  "cron_trigger",
  "interval_trigger",
  "file_trigger",
]);

export type StepSetupStatus = "ready" | "needs_setup" | "blocked";

export type ReadinessItem = {
  id: string;
  label: string;
  passed: boolean;
  fixLabel?: string;
  fixAction?: "focus" | "link";
  fixTarget?: string;
  focusField?: string;
};

export type SuggestedNextStep = {
  id: string;
  label: string;
  action: "add_step" | "link" | "run_test" | "copilot" | "focus_field" | "open_guidance";
  href?: string;
  stepKind?: StepKind;
  copilotPrompt?: string;
  focusField?: string;
};

export type StepSetupContext = {
  steps: WorkflowStep[];
  edges: Edge[];
  llmConfigCount: number;
  topologyError: string | null;
  kindLabel: (kind: StepKind) => string;
};

export const CRON_SCHEDULE_PRESETS: { label: string; cron: string; hint: string }[] = [
  { label: "Every weekday at 9am", cron: "0 9 * * 1-5", hint: "Mon–Fri mornings" },
  { label: "Every day at 9am", cron: "0 9 * * *", hint: "Daily" },
  { label: "Every hour", cron: "0 * * * *", hint: "On the hour" },
];

export const LLM_PROMPT_EXAMPLES: string[] = [
  "Classify this request by urgency and topic.",
  "Summarize the ticket in two sentences for the manager.",
  "Draft a friendly customer reply in our brand voice.",
];

export const APPROVAL_MESSAGE_TEMPLATES: string[] = [
  "Please review before we send this to the customer.",
  "Approve spend or discount before continuing.",
  "Sign off on the outbound message below.",
];

export const CURATED_ACTIONS: { value: string; label: string }[] = [
  { value: "support.reply.draft", label: "Draft a support reply" },
  { value: "slack.notify", label: "Send a Slack notification" },
  { value: "email.send", label: "Send an email" },
  { value: "hubspot.upsert", label: "Update HubSpot record" },
];

export function validateCronExpression(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "Add a schedule so this routine knows when to run.";

  const fields = trimmed.split(/\s+/);
  if (fields.length !== 5) return "Schedule format looks off — use five fields like 0 9 * * 1-5.";

  const validField = /^(\*|\?|[\d*/,\-A-Z]+)$/i;
  if (fields.some((field) => !validField.test(field))) {
    return "Schedule format looks off — use five fields like 0 9 * * 1-5.";
  }

  return null;
}

export function validateIntervalMinutes(value: number | undefined): string | null {
  if (!Number.isInteger(value) || (value ?? 0) <= 0) {
    return "Enter how many minutes between runs (e.g. 15).";
  }
  return null;
}

function isTriggerKind(kind: StepKind): boolean {
  return TRIGGER_KINDS.has(kind);
}

export function isDefaultStepName(step: WorkflowStep, kindLabel: string): boolean {
  const trimmed = step.name.trim();
  return trimmed === `${kindLabel} Step` || trimmed === kindLabel;
}

function hasIncomingEdge(stepId: string, edges: Edge[]): boolean {
  return edges.some((edge) => edge.target === stepId);
}

export function getStepOutcomeSubtitle(step: WorkflowStep): string {
  switch (step.kind) {
    case "trigger":
      return "Starts when you run this routine manually or from a connected app.";
    case "cron_trigger":
      return step.cronExpression?.trim()
        ? `Runs on a schedule (${step.cronExpression.trim()}, ${step.timezone ?? "UTC"}).`
        : "Runs on a repeating schedule you define.";
    case "interval_trigger":
      return step.intervalMinutes
        ? `Runs every ${step.intervalMinutes} minutes.`
        : "Runs on a fixed interval you define.";
    case "file_trigger":
      return "Starts when someone uploads an accepted file type.";
    case "llm":
      return "Uses AI to read prior step data and produce a result.";
    case "approval":
      return "Pauses until a person on your team approves or rejects.";
    case "mcp":
      return step.mcpTool?.trim()
        ? `Calls ${step.mcpTool.trim()} on a connected integration.`
        : "Connects to Slack, Gmail, HubSpot, or another tool.";
    case "action":
      return step.action?.trim()
        ? `Performs: ${step.action.trim()}`
        : "Does something in one of your connected apps.";
    case "condition":
      return "Branches the routine based on a yes/no rule.";
    case "output":
      return "Final result your team or downstream systems consume.";
    case "agent":
      return "Hands work to a persistent agent on your team.";
    case "transform":
      return "Reshapes data before the next step.";
    default:
      return step.description.trim() || "Part of your routine sequence.";
  }
}

export function evaluateStepReadiness(
  step: WorkflowStep,
  ctx: StepSetupContext,
): { status: StepSetupStatus; items: ReadinessItem[] } {
  const items: ReadinessItem[] = [];
  const kindLabel = ctx.kindLabel(step.kind);

  items.push({
    id: "name",
    label: "Named clearly",
    passed: !isDefaultStepName(step, kindLabel),
    fixLabel: "Fix",
    fixAction: "focus",
    focusField: "name",
  });

  if (!isTriggerKind(step.kind)) {
    items.push({
      id: "incoming",
      label: "Receives data from a previous step",
      passed: hasIncomingEdge(step.id, ctx.edges) || ctx.steps.length <= 1,
      fixLabel: "View canvas",
      fixAction: "focus",
      focusField: "canvas",
    });
  }

  switch (step.kind) {
    case "cron_trigger": {
      const cronOk = !validateCronExpression(step.cronExpression ?? "");
      items.push({
        id: "cron",
        label: "Schedule is set",
        passed: cronOk,
        fixLabel: "Fix",
        fixAction: "focus",
        focusField: "cronExpression",
      });
      break;
    }
    case "interval_trigger": {
      const intervalOk = !validateIntervalMinutes(step.intervalMinutes);
      items.push({
        id: "interval",
        label: "Run frequency is set",
        passed: intervalOk,
        fixLabel: "Fix",
        fixAction: "focus",
        focusField: "intervalMinutes",
      });
      break;
    }
    case "llm": {
      items.push({
        id: "prompt",
        label: "AI instructions written",
        passed: Boolean(step.promptTemplate?.trim()),
        fixLabel: "Fix",
        fixAction: "focus",
        focusField: "promptTemplate",
      });
      items.push({
        id: "model",
        label: "Model available in workspace",
        passed: ctx.llmConfigCount > 0,
        fixLabel: "Connect",
        fixAction: "link",
        fixTarget: "/settings/llm-providers",
      });
      break;
    }
    case "approval": {
      items.push({
        id: "assignee",
        label: "Approver chosen",
        passed: Boolean(step.approvalAssignee?.trim()),
        fixLabel: "Fix",
        fixAction: "focus",
        focusField: "approvalAssignee",
      });
      items.push({
        id: "message",
        label: "Approval message written",
        passed: Boolean(step.approvalMessage?.trim()),
        fixLabel: "Fix",
        fixAction: "focus",
        focusField: "approvalMessage",
      });
      break;
    }
    case "mcp": {
      const configured = Boolean(step.mcpServerUrl?.trim() && step.mcpTool?.trim());
      items.push({
        id: "integration",
        label: "Tool and connection configured",
        passed: configured,
        fixLabel: "Fix",
        fixAction: "focus",
        focusField: "mcpTool",
      });
      break;
    }
    case "action": {
      items.push({
        id: "action",
        label: "Action selected",
        passed: Boolean(step.action?.trim()),
        fixLabel: "Fix",
        fixAction: "focus",
        focusField: "action",
      });
      break;
    }
    case "trigger":
    case "file_trigger":
      items.push({
        id: "desc",
        label: "Purpose described",
        passed: Boolean(step.description?.trim()),
        fixLabel: "Fix",
        fixAction: "focus",
        focusField: "description",
      });
      break;
    default:
      break;
  }

  const passedCount = items.filter((i) => i.passed).length;
  const allPassed = passedCount === items.length;
  let status: StepSetupStatus = allPassed ? "ready" : "needs_setup";

  if (ctx.topologyError && ctx.topologyError.includes(step.name)) {
    status = "blocked";
  }

  return { status, items };
}

export function getStepSuggestedNextSteps(
  step: WorkflowStep,
  ctx: StepSetupContext,
): SuggestedNextStep[] {
  const steps: SuggestedNextStep[] = [];
  const { items } = evaluateStepReadiness(step, ctx);

  for (const item of items.filter((i) => !i.passed)) {
    if (item.id === "model" && item.fixTarget) {
      steps.push({
        id: `fix-${item.id}`,
        label: "Connect a model before testing",
        action: "link",
        href: item.fixTarget,
      });
    } else if (item.id === "integration") {
      steps.push({
        id: `fix-${item.id}`,
        label: "Connect an integration in Settings",
        action: "link",
        href: "/integrations",
      });
    }
  }

  if (step.kind === "llm" && !steps.some((s) => s.id === "add-reply")) {
    steps.push({
      id: "add-reply",
      label: "Add a step after this to draft or send a reply",
      action: "add_step",
      stepKind: "action",
      copilotPrompt: `Add an action step after "${step.name}" to draft a customer reply`,
    });
  }

  if (step.kind === "approval") {
    steps.push({
      id: "approval-timeout",
      label: "If approvals time out, increase the wait time below",
      action: "focus_field",
      focusField: "approvalTimeoutMinutes",
    });
  }

  if (items.every((i) => i.passed)) {
    steps.push({
      id: "run-test",
      label: "Run a test with sample data",
      action: "run_test",
    });
  }

  return steps.slice(0, 3);
}

export function getWorkflowSuggestedNextSteps(
  template: WorkflowTemplate,
  edges: Edge[],
  llmConfigCount: number,
): SuggestedNextStep[] {
  const steps: SuggestedNextStep[] = [];
  const topologyError = validateGraphTopology(template.steps, edges);
  const hasTrigger = template.steps.some((s) => isTriggerKind(s.kind));

  if (topologyError) {
    steps.push({
      id: "topology",
      label: humanizeTopologyError(topologyError),
      action: "open_guidance",
    });
    return steps.slice(0, 3);
  }

  if (!hasTrigger) {
    steps.push({
      id: "add-trigger",
      label: "Start with what kicks this routine off",
      action: "add_step",
      stepKind: "trigger",
    });
    return steps;
  }

  if (template.steps.length === 1) {
    steps.push({
      id: "add-process",
      label: "Add what happens next (AI, approval, or tool)",
      action: "add_step",
      stepKind: "llm",
    });
  }

  const hasLlm = template.steps.some((s) => s.kind === "llm");
  if (hasLlm && llmConfigCount === 0) {
    steps.push({
      id: "connect-llm",
      label: "Connect a model before testing AI steps",
      action: "link",
      href: "/settings/llm-providers",
    });
  }

  if (steps.length === 0) {
    steps.push({
      id: "run-test",
      label: "Routine looks ready — run a test",
      action: "run_test",
    });
  }

  return steps.slice(0, 3);
}

function humanizeTopologyError(message: string): string {
  if (message.includes("Trigger step is required")) {
    return "Add a trigger so the routine knows when to start.";
  }
  if (message.includes("not reachable")) {
    return "Connect every step to your trigger — one step is stranded.";
  }
  if (message.includes("incoming edge")) {
    return "Link each middle step to the one before it.";
  }
  return message;
}

export function buildStepSetupContext(
  template: WorkflowTemplate,
  edges: Edge[],
  llmConfigs: LLMConfig[],
  kindLabel: (kind: StepKind) => string,
): StepSetupContext {
  return {
    steps: template.steps,
    edges,
    llmConfigCount: llmConfigs.length,
    topologyError: validateGraphTopology(template.steps, edges),
    kindLabel,
  };
}

export function stepStatusLabel(status: StepSetupStatus): string {
  switch (status) {
    case "ready":
      return "Ready";
    case "blocked":
      return "Blocked";
    default:
      return "Needs setup";
  }
}
