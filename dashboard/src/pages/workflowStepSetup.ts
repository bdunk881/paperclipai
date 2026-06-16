import type { Edge } from "@xyflow/react";
import type { LLMConfig } from "../api/client";
import type { StepKind, WorkflowStep, WorkflowTemplate } from "../types/workflow";
import { validateGraphTopology } from "./workflowGraph";

const TRIGGER_KINDS: ReadonlySet<StepKind> = new Set([
  "trigger",
  "cron_trigger",
  "interval_trigger",
  "file_trigger",
  // HEL-782: the Phase-1 trigger kinds. Without these, isTriggerKind() was false
  // for them, so a form/chat/error/sub-workflow trigger used as a start node
  // wrongly got the "Receives data from a previous step" readiness item.
  "form_trigger",
  "chat_trigger",
  "error_trigger",
  "sub_workflow_trigger",
]);

/**
 * HEL-209 / PR E.2 — Studio UX overhaul.
 *
 * Renamed, operator-friendly per-kind metadata used by the Studio palette,
 * canvas, and guided inspector cards. The underlying `StepKind` enum is
 * UNCHANGED — only the labels/subtitles/tones surface differently. This
 * keeps `stepHandlers.ts` and the runtime engine untouched while giving
 * users a friendlier mental model ("Ask AI" instead of "LLM",
 * "Human sign-off" instead of "Approval", etc.). Absorbs the closed
 * PR #985 prototype documented at
 * docs/design/v2/studio-ux-overhaul-prototype.html.
 */
export type StepKindTone = "sage" | "mustard" | "clay" | "plum" | "blue";

export interface StepKindCopy {
  displayLabel: string;
  subtitle: string;
  learnText: string;
  tone: StepKindTone;
}

export const STEP_KIND_COPY: Record<StepKind, StepKindCopy> = {
  trigger: {
    displayLabel: "Manual start",
    subtitle: "Runs when you click Run or an app sends data here",
    learnText:
      "Use this when a person or another system kicks off the routine on demand. The description is for your team — it does not change runtime behavior.",
    tone: "mustard",
  },
  error_trigger: {
    displayLabel: "On workflow error",
    subtitle: "Starts this workflow when another workflow fails",
    learnText:
      "Make this the head of an error-handler workflow. Point another workflow's \"on error\" at this one; it runs on each failure with the failure details (failedRunId, failedStepId, errorMessage) in context.",
    tone: "clay",
  },
  chat_trigger: {
    displayLabel: "On chat message",
    subtitle: "Starts the workflow when a chat message arrives",
    learnText:
      "Make this the head of a chatbot workflow. A chat surface starts a run with the message; downstream Ask AI / agent steps answer it. The message, session, and user are in context as {{chatMessage}} / {{chatSessionId}} / {{chatUserId}}.",
    tone: "sage",
  },
  sub_workflow_trigger: {
    displayLabel: "Called as sub-workflow",
    subtitle: "Entry point when another workflow runs this one",
    learnText:
      "Make this the head of a reusable workflow that others call via a Run-a-sub-workflow step. Declare the inputs it expects (with optional defaults); the caller's values arrive in context as {{key}}.",
    tone: "plum",
  },
  form_trigger: {
    displayLabel: "On form submission",
    subtitle: "Starts the workflow when someone submits a hosted form",
    learnText:
      "Define the form fields here; a public form at /api/forms/<workflow-id> renders them. A submission starts a run with the values in context (e.g. {{name}}, {{email}}) and as a nested `form` object.",
    tone: "sage",
  },
  cron_trigger: {
    displayLabel: "Scheduled start",
    subtitle: "Runs on a calendar schedule (Mon 9am, daily, etc.)",
    learnText:
      "In production, schedules run via Routines. This step documents intent and can auto-create a Routine when you launch a team.",
    tone: "sage",
  },
  interval_trigger: {
    displayLabel: "Repeating start",
    subtitle: "Runs every N minutes while the routine is active",
    learnText:
      "Good for inbox polling or periodic check-ins. Pair with Launch team to keep agents working autonomously.",
    tone: "sage",
  },
  file_trigger: {
    displayLabel: "File upload start",
    subtitle: "Runs when someone uploads a PDF, image, or document",
    learnText:
      "At run time, the engine expects parsed file content. Configure accepted types here; users upload when they click Run.",
    tone: "mustard",
  },
  llm: {
    displayLabel: "Ask AI",
    subtitle: "Have AI read prior data and write a response or decision",
    learnText:
      "Your prompt is sent to the model with {{variables}} from earlier steps. Pick a tier or specific model.",
    tone: "clay",
  },
  knowledge: {
    displayLabel: "Recall knowledge",
    subtitle: "Retrieve relevant facts from your workspace knowledge base",
    learnText:
      "Semantic search over your connected knowledge bases; the matched passages are passed to later steps (e.g. an Ask AI step) as context.",
    tone: "plum",
  },
  transform: {
    displayLabel: "Shape data",
    subtitle: "Rename, filter, or reformat fields before the next step",
    learnText:
      "Pick what to change — not just a description. Downstream steps only see the fields you pass through.",
    tone: "clay",
  },
  merge: {
    displayLabel: "Merge paths",
    subtitle: "Rejoin two or more branches back into a single path",
    learnText:
      "Lets branches that split earlier (e.g. from a Condition) flow back together. Both branches' data is already available to steps after the merge.",
    tone: "sage",
  },
  loop: {
    displayLabel: "Loop / repeat",
    subtitle: "Repeat earlier steps a bounded number of times",
    learnText:
      "Jumps back to an earlier step and re-runs up to a max-iterations cap (or until a break condition). The cap guarantees it always stops.",
    tone: "mustard",
  },
  wait: {
    displayLabel: "Wait / delay",
    subtitle: "Pause the run for a duration or until a set time",
    learnText:
      "Pauses here, then resumes the rest of the workflow — durably (the run is re-queued with a delay), so a long wait does not hold a worker. Set a duration (amount + unit) or an until-time.",
    tone: "sage",
  },
  switch: {
    displayLabel: "Switch / route",
    subtitle: "Send the run down one of several paths by rule",
    learnText:
      "Evaluates rules in order and routes to the first match (or a fallback). Like Condition, but with more than two branches.",
    tone: "mustard",
  },
  filter: {
    displayLabel: "Filter items",
    subtitle: "Keep only the list items that match a rule",
    learnText:
      "Drops the items in a list that fail the rule and passes the rest on. The rule is evaluated per item with the item's fields in scope.",
    tone: "clay",
  },
  stop_error: {
    displayLabel: "Stop & Error",
    subtitle: "Halt the run with an error message you choose",
    learnText:
      "Deliberately fails the run with your message — use it to reject a bad branch or assert a precondition. The opposite of Continue-on-fail: it always stops, even when upstream steps allow continue-on-fail.",
    tone: "clay",
  },
  action: {
    displayLabel: "App action",
    subtitle: "Do something in Slack, email, CRM, or another connected app",
    learnText:
      "Choose from registered actions or describe what you want — AI maps it to the right integration call.",
    tone: "clay",
  },
  mcp: {
    displayLabel: "Connected app",
    subtitle: "Call a tool from a workspace integration you've connected",
    learnText:
      "Connect inline — no need to leave Studio. Then pick the tool and parameters.",
    tone: "blue",
  },
  agent: {
    displayLabel: "Assign to agent",
    subtitle: "Hand this work to a persistent agent on your team",
    learnText:
      "Pick an existing agent or create one. They run autonomously, respect budgets, and show up in Assignments + Activity.",
    tone: "clay",
  },
  sub_workflow: {
    displayLabel: "Run a sub-workflow",
    subtitle: "Call another saved workflow, then continue with its result",
    learnText:
      "Runs a saved workflow as one step — its output merges back into this run. Reuse a workflow across many parents and edit it once. Nesting is depth-capped and cycle-guarded.",
    tone: "plum",
  },
  condition: {
    displayLabel: "If / then",
    subtitle: "Send the routine down different paths based on a rule",
    learnText:
      "Build rules from upstream fields — not free-text descriptions. Yes/No paths appear on the canvas.",
    tone: "mustard",
  },
  approval: {
    displayLabel: "Human sign-off",
    subtitle: "Pause until someone on your team approves or rejects",
    learnText:
      "Show approvers exactly what they're signing off on. Choose what happens after approve, reject, or timeout.",
    tone: "plum",
  },
  output: {
    displayLabel: "Deliver result",
    subtitle: "Package the final result for your team or downstream systems",
    learnText:
      "Pick which fields to deliver and where — Activity feed, Assignment, webhook, or return to caller.",
    tone: "sage",
  },
};

/**
 * Three-section palette grouping used by the Studio left rail. Matches the
 * prototype's "When to start" / "What to do" / "Control flow" layout —
 * easier to scan than a flat list of 12 kinds.
 */
export const STEP_PALETTE_SECTIONS: Array<{
  title: string;
  kinds: StepKind[];
}> = [
  {
    title: "When to start",
    // HEL-780: surface every trigger kind. chat/form/error/sub_workflow are the
    // entrypoints shipped this cycle — they already have KIND_META + STEP_KIND_COPY
    // but were missing from the side-rail palette.
    kinds: [
      "trigger",
      "cron_trigger",
      "interval_trigger",
      "file_trigger",
      "chat_trigger",
      "form_trigger",
      "error_trigger",
      "sub_workflow_trigger",
    ],
  },
  {
    title: "What to do",
    kinds: ["llm", "knowledge", "transform", "action", "mcp", "agent", "sub_workflow"],
  },
  {
    title: "Control flow",
    // HEL-780: the flow-logic kinds (switch/filter/loop/merge/wait/stop_error)
    // now have inspector cards (HEL-779/HEL-781), so make them addable here too.
    kinds: [
      "condition",
      "switch",
      "filter",
      "loop",
      "merge",
      "wait",
      "approval",
      "stop_error",
      "output",
    ],
  },
];

export function getStepKindDisplayLabel(kind: StepKind): string {
  return STEP_KIND_COPY[kind]?.displayLabel ?? kind;
}

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

// ---------------------------------------------------------------------------
// HEL-241A — Schema-driven inspector field manifests.
//
// Each entry below replaces a `selectedStep.kind === "..."` JSX branch
// in WorkflowBuilder.tsx with a flat field manifest the NodeConfigForm
// component can render generically. Keys must match WorkflowStep
// members so the form reads/writes the right slot. Migrating one kind
// at a time keeps the diff reviewable — only the four small kinds
// land in this PR (`condition`, `approval`, `mcp`, `file_trigger`);
// the larger `agent` + `llm` setups follow.
// ---------------------------------------------------------------------------

import type { FieldDef } from "../components/workflow/NodeConfigForm";

export const STEP_FIELD_MANIFEST: Partial<Record<StepKind, FieldDef[]>> = {
  condition: [
    {
      widget: "text",
      key: "condition",
      label: "Condition expression",
      mono: true,
      placeholder: 'e.g. urgency === "high"',
      help: "Evaluated against the run context. Branches whose expression is true follow the condition's edge.",
    },
  ],
  approval: [
    {
      widget: "number",
      key: "approvalTimeoutMinutes",
      label: "Timeout (minutes)",
      placeholder: "60",
      min: 1,
      defaultValue: 60,
    },
    {
      widget: "info",
      key: "approval-callout",
      tone: "mustard",
      text: "Workflow will pause at this step until the assignee approves or rejects. On timeout, the workflow escalates or continues based on your escalation policy.",
    },
  ],
  mcp: [
    {
      widget: "text",
      key: "mcpServerUrl",
      label: "Integration server URL",
      mono: true,
      placeholder: "https://mcp.example.com/sse",
    },
  ],
  file_trigger: [
    {
      widget: "string-array",
      key: "acceptedFileTypes",
      label: "Accepted file types (comma-separated)",
      placeholder: ".pdf, .png, .jpg, .mp3, .wav",
      separator: "comma",
    },
  ],
};

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
    case "sub_workflow": {
      // HEL-773: the engine requires config.workflowId (the saved workflow to run).
      items.push({
        id: "subWorkflow",
        label: "A workflow is selected to run",
        passed: typeof step.config?.["workflowId"] === "string" && step.config["workflowId"] !== "",
        fixLabel: "Pick",
        fixAction: "focus",
        focusField: "subWorkflowId",
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
    case "filter": {
      // HEL-779: a Filter needs the array field it runs over. The predicate is
      // optional — no predicate is a safe passthrough — so only itemsKey gates.
      const itemsKey = step.config?.["itemsKey"];
      items.push({
        id: "filterItems",
        label: "An array field is set to filter",
        passed: typeof itemsKey === "string" && itemsKey !== "",
        fixLabel: "Set",
        fixAction: "focus",
        focusField: "itemsKey",
      });
      break;
    }
    case "wait": {
      // HEL-779: a Wait needs a resolvable time — a positive duration, an "until"
      // target, or webhook mode (which pauses with no timer).
      const cfg = (step.config ?? {}) as Record<string, unknown>;
      const mode = typeof cfg["mode"] === "string" ? cfg["mode"] : "duration";
      let hasTime: boolean;
      if (mode === "webhook") {
        hasTime = true;
      } else if (mode === "until") {
        hasTime = typeof cfg["until"] === "string" && cfg["until"] !== "";
      } else {
        const amountRaw = cfg["amount"];
        const amount =
          typeof amountRaw === "number"
            ? amountRaw
            : typeof amountRaw === "string"
              ? Number(amountRaw)
              : NaN;
        const durationMs = typeof cfg["durationMs"] === "number" ? cfg["durationMs"] : 0;
        hasTime = (Number.isFinite(amount) && amount > 0) || durationMs > 0;
      }
      items.push({
        id: "waitTime",
        label: "A wait time is set",
        passed: hasTime,
        fixLabel: "Set",
        fixAction: "focus",
        focusField: "waitMode",
      });
      break;
    }
    case "loop": {
      // HEL-781: a Loop needs the earlier step it jumps back to. maxIterations
      // is optional (defaults to 1 = run once) so only the target gates.
      const startId = step.config?.["loopStartStepId"];
      items.push({
        id: "loopStart",
        label: "A step to repeat from is set",
        passed: typeof startId === "string" && startId !== "",
        fixLabel: "Set",
        fixAction: "focus",
        focusField: "loopStartStepId",
      });
      break;
    }
    case "switch": {
      // HEL-781: a Switch needs at least one complete route (condition + target)
      // or a fallback — otherwise it just falls through to the next step.
      const cfg = (step.config ?? {}) as Record<string, unknown>;
      const routes = Array.isArray(cfg["routes"])
        ? (cfg["routes"] as Array<{ condition?: unknown; targetStepId?: unknown }>)
        : [];
      const hasRoute = routes.some(
        (r) =>
          r &&
          typeof r.condition === "string" &&
          r.condition !== "" &&
          typeof r.targetStepId === "string" &&
          r.targetStepId !== "",
      );
      const hasFallback =
        typeof cfg["fallbackStepId"] === "string" && cfg["fallbackStepId"] !== "";
      items.push({
        id: "switchRoutes",
        label: "At least one route or a fallback is set",
        passed: hasRoute || hasFallback,
        fixLabel: "Add",
        fixAction: "focus",
        focusField: "switchAddRoute",
      });
      break;
    }
    case "form_trigger": {
      // HEL-782: a form needs at least one field with a key to render anything.
      const formFields = Array.isArray(step.config?.["formFields"])
        ? (step.config["formFields"] as Array<{ key?: unknown }>)
        : [];
      const hasField = formFields.some(
        (f) => f && typeof f.key === "string" && f.key.trim() !== "",
      );
      items.push({
        id: "formFields",
        label: "At least one form field is defined",
        passed: hasField,
        fixLabel: "Add",
        fixAction: "focus",
        focusField: "formAddField",
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

/**
 * HEL-688: the wired trigger step-kinds offered in the trigger-picker catalog,
 * in display order. Each has KIND_META + STEP_KIND_COPY. App-event (Composio)
 * triggers live in the Connections panel, not here.
 */
export const TRIGGER_PICKER_KINDS: StepKind[] = [
  "trigger",
  "cron_trigger",
  "interval_trigger",
  "form_trigger",
  "chat_trigger",
  "error_trigger",
  "sub_workflow_trigger",
  "file_trigger",
];
