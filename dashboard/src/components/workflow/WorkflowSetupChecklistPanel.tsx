import { useEffect, useMemo } from "react";
import { Plug, X } from "lucide-react";
import clsx from "clsx";
import { PROVIDER_MODELS, type ProviderName } from "../../api/client";
import type { WorkflowStep } from "../../types/workflow";
import {
  STEP_KIND_COPY,
  type SuggestedNextStep,
} from "../../pages/workflowStepSetup";

/**
 * HEL-209 / PR E.2 — Guided per-kind inspector cards.
 *
 * Replaces the legacy generic checklist sidebar with guided "what does
 * this step need?" cards per `StepKind`. Each card knows the minimum
 * fields required for that kind and renders the right controls inline
 * (chips for accepted file types, dropdowns for LLM tier + model, rule
 * builder for conditions, etc.) instead of dumping a generic textarea
 * on the operator.
 *
 * Scaffold scope: the cards persist data via `onUpdateStep`, but the
 * non-typed values (`condition` rule structure, `output` destination)
 * are stored in `step.config` until the backend adds first-class fields.
 *
 * Two render modes:
 *   1. Sidebar (legacy, default export) — fixed-position drawer with
 *      workflow suggested-next-steps list, opened from header
 *      "Checklist" button.
 *   2. Inline (new, `GuidedSetupCards`) — renders the per-kind guided
 *      cards directly in the inspector column.
 */

type LegacySidebarProps = {
  onClose: () => void;
  workflowSteps: SuggestedNextStep[];
  onAction: (step: SuggestedNextStep) => void;
};

type InlineGuidedProps = {
  step: WorkflowStep;
  agents?: { id: string; name: string }[];
  integrations?: { id: string; name: string; connected: boolean }[];
  onUpdateStep: (patch: Partial<WorkflowStep>) => void;
  readonly?: boolean;
};

export function WorkflowSetupChecklistPanel(props: LegacySidebarProps) {
  return <LegacySidebar {...props} />;
}

/**
 * Per-kind guided inspector cards. Renders nothing for kinds that don't
 * have specialised cards yet — callers should still render the shared
 * setup coach above this component for generic readiness checks.
 */
export function GuidedSetupCards({
  step,
  agents,
  integrations,
  onUpdateStep,
  readonly = false,
}: InlineGuidedProps) {
  const copy = STEP_KIND_COPY[step.kind];

  switch (step.kind) {
    case "file_trigger":
      return <FileTriggerCard step={step} onUpdate={onUpdateStep} readonly={readonly} />;
    case "llm":
      return <LlmCard step={step} onUpdate={onUpdateStep} readonly={readonly} />;
    case "mcp":
    case "action":
      return (
        <ConnectIntegrationCard
          step={step}
          integrations={integrations ?? []}
          onUpdate={onUpdateStep}
          readonly={readonly}
        />
      );
    case "agent":
      return (
        <AgentPickerCard
          step={step}
          agents={agents ?? []}
          onUpdate={onUpdateStep}
          readonly={readonly}
        />
      );
    case "condition":
      return <ConditionRuleCard step={step} onUpdate={onUpdateStep} readonly={readonly} />;
    case "approval":
      return (
        <ApprovalCard
          step={step}
          agents={agents ?? []}
          onUpdate={onUpdateStep}
          readonly={readonly}
        />
      );
    case "output":
      return <OutputCard step={step} onUpdate={onUpdateStep} readonly={readonly} />;
    default:
      return (
        <SetupCardShell title={copy.displayLabel} hint={copy.subtitle}>
          <p className="text-xs text-af2-ink-4">
            No extra setup needed for this step yet.
          </p>
        </SetupCardShell>
      );
  }
}

// ──────────────────────────────────────────────────────────────────────
// Legacy sidebar (Workflow-level checklist, opened from header button).
// Kept so the existing "Checklist" CTA in WorkflowBuilder still works.
// ──────────────────────────────────────────────────────────────────────
function LegacySidebar({ onClose, workflowSteps, onAction }: LegacySidebarProps) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-af2-paper-3/35">
      <button className="flex-1" onClick={onClose} aria-label="Close routine checklist" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Routine setup checklist"
        className="w-full max-w-md overflow-y-auto border-l border-af2-line bg-af2-card p-6 shadow-xl"
      >
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-af2-clay">
              Routine checklist
            </p>
            <h2 className="mt-1 text-lg font-semibold text-af2-ink">What to do next</h2>
            <p className="mt-1 text-sm text-af2-ink-3">
              Based on your canvas and workspace — not generic tips.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-af2-ink-3 transition hover:bg-af2-paper-2 hover:text-af2-ink"
            aria-label="Close checklist"
          >
            <X size={16} />
          </button>
        </div>

        <ul className="space-y-2">
          {workflowSteps.map((step, index) => (
            <li key={step.id}>
              <button
                type="button"
                className="flex w-full items-start gap-3 rounded-lg border border-af2-line bg-af2-paper-2 p-4 text-left transition hover:border-af2-clay/30"
                onClick={() => {
                  onAction(step);
                  onClose();
                }}
              >
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-af2-clay-soft text-xs font-bold text-af2-clay">
                  {index + 1}
                </span>
                <span className="text-sm text-af2-ink">{step.label}</span>
              </button>
            </li>
          ))}
        </ul>

        {workflowSteps.length === 0 && (
          <p className="rounded-lg border border-af2-sage/30 bg-af2-sage/10 p-4 text-sm text-af2-sage">
            This routine looks ready. Run a test from the header when you are satisfied.
          </p>
        )}
      </aside>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Shared shell + helpers
// ──────────────────────────────────────────────────────────────────────
function SetupCardShell({
  title,
  hint,
  eyebrow,
  children,
}: {
  title: string;
  hint?: string;
  eyebrow?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-3 rounded-xl border border-af2-line bg-af2-paper-2 px-4 py-3">
      {eyebrow && (
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-af2-ink-4">
          {eyebrow}
        </p>
      )}
      <h4 className="mt-1 text-sm font-semibold text-af2-ink">{title}</h4>
      {hint && <p className="mt-1 text-xs leading-snug text-af2-ink-4">{hint}</p>}
      <div className="mt-3">{children}</div>
    </div>
  );
}

function ChipToggle({
  label,
  active,
  onClick,
  disabled,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        "mb-1.5 mr-1.5 inline-block rounded-full border px-3 py-1 text-xs transition",
        active
          ? "border-af2-clay bg-af2-clay-soft text-af2-clay"
          : "border-af2-line-2 bg-af2-card text-af2-ink-2 hover:border-af2-clay/40",
      )}
    >
      {label}
    </button>
  );
}

// Tier → suggested provider mapping for the LLM "tier" dropdown.
const LLM_TIERS = [
  { value: "standard", label: "Standard — workspace default", provider: "anthropic" as ProviderName },
  { value: "lite", label: "Lite — fast & cheap", provider: "openai" as ProviderName },
  { value: "power", label: "Power — complex reasoning", provider: "anthropic" as ProviderName },
];

// ──────────────────────────────────────────────────────────────────────
// File trigger
// ──────────────────────────────────────────────────────────────────────
const ACCEPTED_FILE_PRESETS: { value: string; label: string }[] = [
  { value: "pdf", label: "PDF" },
  { value: "image", label: "Image (PNG/JPG)" },
  { value: "doc", label: "Document (DOCX)" },
  { value: "json", label: "JSON" },
];

function FileTriggerCard({
  step,
  onUpdate,
  readonly,
}: {
  step: WorkflowStep;
  onUpdate: (patch: Partial<WorkflowStep>) => void;
  readonly?: boolean;
}) {
  const accepted = step.acceptedFileTypes ?? [];
  const toggle = (value: string) => {
    if (readonly) return;
    const set = new Set(accepted);
    if (set.has(value)) set.delete(value);
    else set.add(value);
    onUpdate({ acceptedFileTypes: Array.from(set) });
  };

  return (
    <SetupCardShell
      eyebrow="1 of 1"
      title="What file types are accepted?"
      hint="Pick at least one. Users uploading at run time will be filtered to these."
    >
      <div className="flex flex-wrap">
        {ACCEPTED_FILE_PRESETS.map((preset) => (
          <ChipToggle
            key={preset.value}
            label={preset.label}
            active={accepted.includes(preset.value)}
            onClick={() => toggle(preset.value)}
            disabled={readonly}
          />
        ))}
      </div>
    </SetupCardShell>
  );
}

// ──────────────────────────────────────────────────────────────────────
// LLM
// ──────────────────────────────────────────────────────────────────────
function LlmCard({
  step,
  onUpdate,
  readonly,
}: {
  step: WorkflowStep;
  onUpdate: (patch: Partial<WorkflowStep>) => void;
  readonly?: boolean;
}) {
  const config = (step.config ?? {}) as Record<string, unknown>;
  const tier = (typeof config.llmTier === "string" ? config.llmTier : "standard") as string;
  const provider = (LLM_TIERS.find((t) => t.value === tier)?.provider ?? "anthropic") as ProviderName;
  const availableModels = PROVIDER_MODELS[provider] ?? [];
  const currentModel = step.llmConfigId ?? availableModels[0] ?? "";

  const setTier = (value: string) => {
    if (readonly) return;
    const newProvider = LLM_TIERS.find((t) => t.value === value)?.provider ?? "anthropic";
    const newModels = PROVIDER_MODELS[newProvider] ?? [];
    onUpdate({
      config: { ...(step.config ?? {}), llmTier: value },
      llmConfigId: newModels[0] ?? step.llmConfigId,
    });
  };

  return (
    <>
      <SetupCardShell
        eyebrow="1 of 2"
        title="Which model?"
        hint="Pick a tier — workspace defaults the model. Override below for a specific one."
      >
        <label className="mb-3 block">
          <span className="mb-1 block text-[11px] font-medium text-af2-ink-3">Tier</span>
          <select
            className="w-full rounded-lg border border-af2-line-2 bg-af2-card px-3 py-2 text-sm text-af2-ink focus:outline-none focus:ring-2 focus:ring-af2-clay/30"
            value={tier}
            onChange={(event) => setTier(event.target.value)}
            disabled={readonly}
          >
            {LLM_TIERS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-af2-ink-3">Model</span>
          <select
            className="w-full rounded-lg border border-af2-line-2 bg-af2-card px-3 py-2 text-sm text-af2-ink focus:outline-none focus:ring-2 focus:ring-af2-clay/30"
            value={currentModel}
            onChange={(event) => onUpdate({ llmConfigId: event.target.value })}
            disabled={readonly || availableModels.length === 0}
          >
            {availableModels.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        </label>
      </SetupCardShell>

      <SetupCardShell
        eyebrow="2 of 2"
        title="What should the AI do?"
        hint="Use {{field}} to reference output from earlier steps."
      >
        <textarea
          rows={5}
          className="w-full resize-y rounded-lg border border-af2-line-2 bg-af2-card px-3 py-2 text-sm text-af2-ink focus:outline-none focus:ring-2 focus:ring-af2-clay/30"
          placeholder="Read the ticket and return urgency (low/medium/high), topic, and a two-sentence summary."
          value={step.promptTemplate ?? ""}
          onChange={(event) => onUpdate({ promptTemplate: event.target.value })}
          disabled={readonly}
        />
      </SetupCardShell>
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────
// MCP / Action — connect integration
// ──────────────────────────────────────────────────────────────────────
function ConnectIntegrationCard({
  step,
  integrations,
  onUpdate,
  readonly,
}: {
  step: WorkflowStep;
  integrations: { id: string; name: string; connected: boolean }[];
  onUpdate: (patch: Partial<WorkflowStep>) => void;
  readonly?: boolean;
}) {
  const config = (step.config ?? {}) as Record<string, unknown>;
  const selectedId = typeof config.integrationId === "string" ? config.integrationId : "";
  const selected = integrations.find((i) => i.id === selectedId);

  return (
    <SetupCardShell title="Pick a connected app" hint="Connect inline — no need to leave Studio.">
      {integrations.length === 0 && (
        <p className="rounded-md border border-af2-mustard/30 bg-af2-mustard/10 px-3 py-2 text-xs text-af2-mustard">
          No integrations available. Add one from Settings → Integrations.
        </p>
      )}
      {integrations.map((integration) => {
        const active = integration.id === selectedId;
        return (
          <div
            key={integration.id}
            className={clsx(
              "mb-2 flex items-center gap-3 rounded-lg border px-3 py-2",
              active ? "border-af2-clay bg-af2-clay-soft/30" : "border-af2-line bg-af2-card",
            )}
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-af2-line bg-af2-paper-2 text-af2-ink-3">
              <Plug size={14} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-af2-ink">{integration.name}</p>
              <p className="text-xs text-af2-ink-4">
                {integration.connected ? "Connected" : "Not connected"}
              </p>
            </div>
            {integration.connected ? (
              <button
                type="button"
                onClick={() =>
                  !readonly &&
                  onUpdate({
                    config: { ...(step.config ?? {}), integrationId: integration.id },
                  })
                }
                className={clsx(
                  "rounded-full border px-3 py-1 text-xs font-semibold transition",
                  active
                    ? "border-af2-clay bg-af2-clay text-white"
                    : "border-af2-line-2 text-af2-ink-2 hover:border-af2-clay/40 hover:text-af2-clay",
                )}
                disabled={readonly}
              >
                {active ? "Selected" : "Select"}
              </button>
            ) : (
              <button
                type="button"
                disabled
                title="TODO: inline OAuth connect — HEL-209 follow-up"
                className="cursor-not-allowed rounded-full border border-af2-line-2 bg-af2-paper-2 px-3 py-1 text-xs font-semibold text-af2-ink-4"
              >
                Connect
              </button>
            )}
          </div>
        );
      })}
      {selected && step.kind === "mcp" && (
        <label className="mt-2 block">
          <span className="mb-1 block text-[11px] font-medium text-af2-ink-3">Tool</span>
          <input
            type="text"
            className="w-full rounded-lg border border-af2-line-2 bg-af2-card px-3 py-2 text-sm text-af2-ink focus:outline-none focus:ring-2 focus:ring-af2-clay/30"
            placeholder="e.g. post_message"
            value={step.mcpTool ?? ""}
            onChange={(event) => onUpdate({ mcpTool: event.target.value })}
            disabled={readonly}
          />
        </label>
      )}
      {selected && step.kind === "action" && (
        <label className="mt-2 block">
          <span className="mb-1 block text-[11px] font-medium text-af2-ink-3">Action</span>
          <input
            type="text"
            className="w-full rounded-lg border border-af2-line-2 bg-af2-card px-3 py-2 text-sm text-af2-ink focus:outline-none focus:ring-2 focus:ring-af2-clay/30"
            placeholder="e.g. slack.notify"
            value={step.action ?? ""}
            onChange={(event) => onUpdate({ action: event.target.value })}
            disabled={readonly}
          />
        </label>
      )}
    </SetupCardShell>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Agent
// ──────────────────────────────────────────────────────────────────────
function AgentPickerCard({
  step,
  agents,
  onUpdate,
  readonly,
}: {
  step: WorkflowStep;
  agents: { id: string; name: string }[];
  onUpdate: (patch: Partial<WorkflowStep>) => void;
  readonly?: boolean;
}) {
  return (
    <SetupCardShell title="Which agent should do this?" hint="Assign to an existing agent on your team.">
      <label className="block">
        <span className="mb-1 block text-[11px] font-medium text-af2-ink-3">Agent</span>
        <select
          className="w-full rounded-lg border border-af2-line-2 bg-af2-card px-3 py-2 text-sm text-af2-ink focus:outline-none focus:ring-2 focus:ring-af2-clay/30"
          value={step.agentRoleKey ?? ""}
          onChange={(event) => onUpdate({ agentRoleKey: event.target.value })}
          disabled={readonly}
        >
          <option value="">Select an agent…</option>
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </select>
      </label>
      {agents.length === 0 && (
        <p className="mt-2 text-xs text-af2-ink-4">
          No agents in this workspace yet — create one from the Agents page.
        </p>
      )}
    </SetupCardShell>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Condition — structured rule builder
// ──────────────────────────────────────────────────────────────────────
const CONDITION_OPERATORS: { value: string; label: string }[] = [
  { value: "==", label: "equals" },
  { value: "!=", label: "not equals" },
  { value: ">", label: "greater than" },
  { value: "<", label: "less than" },
  { value: "contains", label: "contains" },
];

function ConditionRuleCard({
  step,
  onUpdate,
  readonly,
}: {
  step: WorkflowStep;
  onUpdate: (patch: Partial<WorkflowStep>) => void;
  readonly?: boolean;
}) {
  const config = (step.config ?? {}) as Record<string, unknown>;
  const field = typeof config.conditionField === "string" ? config.conditionField : "";
  const operator = typeof config.conditionOperator === "string" ? config.conditionOperator : "==";
  const value = typeof config.conditionValue === "string" ? config.conditionValue : "";

  const updateRule = (patch: Record<string, string>) => {
    const next = { ...(step.config ?? {}), ...patch };
    const conditionExpr = `${next.conditionField ?? ""} ${next.conditionOperator ?? "=="} ${JSON.stringify(next.conditionValue ?? "")}`;
    onUpdate({ config: next, condition: conditionExpr });
  };

  return (
    <SetupCardShell title="Build your rule" hint="Reference a field from an upstream step.">
      <div className="grid grid-cols-3 gap-2">
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-af2-ink-3">Field</span>
          <input
            type="text"
            className="w-full rounded-lg border border-af2-line-2 bg-af2-card px-2 py-2 text-sm text-af2-ink focus:outline-none focus:ring-2 focus:ring-af2-clay/30"
            placeholder="urgency"
            value={field}
            onChange={(event) => updateRule({ conditionField: event.target.value })}
            disabled={readonly}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-af2-ink-3">Op</span>
          <select
            className="w-full rounded-lg border border-af2-line-2 bg-af2-card px-2 py-2 text-sm text-af2-ink focus:outline-none focus:ring-2 focus:ring-af2-clay/30"
            value={operator}
            onChange={(event) => updateRule({ conditionOperator: event.target.value })}
            disabled={readonly}
          >
            {CONDITION_OPERATORS.map((op) => (
              <option key={op.value} value={op.value}>
                {op.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-af2-ink-3">Value</span>
          <input
            type="text"
            className="w-full rounded-lg border border-af2-line-2 bg-af2-card px-2 py-2 text-sm text-af2-ink focus:outline-none focus:ring-2 focus:ring-af2-clay/30"
            placeholder="high"
            value={value}
            onChange={(event) => updateRule({ conditionValue: event.target.value })}
            disabled={readonly}
          />
        </label>
      </div>
      <p className="mt-2 text-xs text-af2-sage">
        Preview: IF <code>{field || "field"}</code> {operator} <code>{value || "value"}</code> → Yes path
      </p>
    </SetupCardShell>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Approval
// ──────────────────────────────────────────────────────────────────────
const APPROVAL_DESTS = ["Continue to next step", "Stop run", "Escalate to manager"];

function ApprovalCard({
  step,
  agents,
  onUpdate,
  readonly,
}: {
  step: WorkflowStep;
  agents: { id: string; name: string }[];
  onUpdate: (patch: Partial<WorkflowStep>) => void;
  readonly?: boolean;
}) {
  const config = (step.config ?? {}) as Record<string, unknown>;
  const onApprove = typeof config.onApprove === "string" ? config.onApprove : APPROVAL_DESTS[0];
  const onReject = typeof config.onReject === "string" ? config.onReject : APPROVAL_DESTS[1];
  const onTimeout = typeof config.onTimeout === "string" ? config.onTimeout : APPROVAL_DESTS[2];

  const setDest = (patch: Record<string, string>) =>
    onUpdate({ config: { ...(step.config ?? {}), ...patch } });

  return (
    <>
      <SetupCardShell eyebrow="1 of 2" title="Who signs off?">
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-af2-ink-3">Approver</span>
          <select
            className="w-full rounded-lg border border-af2-line-2 bg-af2-card px-3 py-2 text-sm text-af2-ink focus:outline-none focus:ring-2 focus:ring-af2-clay/30"
            value={step.approvalAssignee ?? ""}
            onChange={(event) => onUpdate({ approvalAssignee: event.target.value })}
            disabled={readonly}
          >
            <option value="">Select approver…</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
        </label>
      </SetupCardShell>
      <SetupCardShell eyebrow="2 of 2" title="After they decide">
        <ApprovalDestField
          label="If approved"
          value={onApprove}
          onChange={(v) => setDest({ onApprove: v })}
          readonly={readonly}
        />
        <ApprovalDestField
          label="If rejected"
          value={onReject}
          onChange={(v) => setDest({ onReject: v })}
          readonly={readonly}
        />
        <ApprovalDestField
          label="If timeout"
          value={onTimeout}
          onChange={(v) => setDest({ onTimeout: v })}
          readonly={readonly}
        />
      </SetupCardShell>
    </>
  );
}

function ApprovalDestField({
  label,
  value,
  onChange,
  readonly,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  readonly?: boolean;
}) {
  return (
    <label className="mb-2 block">
      <span className="mb-1 block text-[11px] font-medium text-af2-ink-3">{label}</span>
      <select
        className="w-full rounded-lg border border-af2-line-2 bg-af2-card px-3 py-2 text-sm text-af2-ink focus:outline-none focus:ring-2 focus:ring-af2-clay/30"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={readonly}
      >
        {APPROVAL_DESTS.map((dest) => (
          <option key={dest} value={dest}>
            {dest}
          </option>
        ))}
      </select>
    </label>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Output
// ──────────────────────────────────────────────────────────────────────
const OUTPUT_DESTS = [
  { value: "activity", label: "Activity feed" },
  { value: "assignment", label: "Assignment" },
  { value: "webhook", label: "Webhook" },
  { value: "caller", label: "Return to caller" },
];

function OutputCard({
  step,
  onUpdate,
  readonly,
}: {
  step: WorkflowStep;
  onUpdate: (patch: Partial<WorkflowStep>) => void;
  readonly?: boolean;
}) {
  const config = (step.config ?? {}) as Record<string, unknown>;
  const destination =
    typeof config.outputDestination === "string" ? config.outputDestination : "activity";
  const includeFields = Array.isArray(config.outputFields)
    ? (config.outputFields as string[])
    : (step.outputKeys ?? []);

  // Build a candidate field list from the step's `outputKeys` — this is a
  // scaffold: production version derives from upstream step outputs.
  const candidates = useMemo(() => {
    const seen = new Set<string>(step.outputKeys ?? []);
    ["summary", "urgency", "draft_reply", "approval_status"].forEach((c) => seen.add(c));
    return Array.from(seen);
  }, [step.outputKeys]);

  const toggleField = (value: string) => {
    if (readonly) return;
    const next = new Set(includeFields);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onUpdate({
      config: { ...(step.config ?? {}), outputFields: Array.from(next) },
    });
  };

  return (
    <>
      <SetupCardShell eyebrow="1 of 2" title="Where should the result go?">
        <div className="space-y-1.5">
          {OUTPUT_DESTS.map((dest) => (
            <label
              key={dest.value}
              className={clsx(
                "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition",
                destination === dest.value
                  ? "border-af2-clay bg-af2-clay-soft/30 text-af2-ink"
                  : "border-af2-line-2 bg-af2-card text-af2-ink-2 hover:border-af2-clay/40",
              )}
            >
              <input
                type="radio"
                name={`output-dest-${step.id}`}
                value={dest.value}
                checked={destination === dest.value}
                onChange={() =>
                  onUpdate({
                    config: { ...(step.config ?? {}), outputDestination: dest.value },
                  })
                }
                disabled={readonly}
                className="accent-af2-clay"
              />
              {dest.label}
            </label>
          ))}
        </div>
      </SetupCardShell>
      <SetupCardShell eyebrow="2 of 2" title="Include these fields">
        <div className="flex flex-wrap">
          {candidates.map((field) => (
            <ChipToggle
              key={field}
              label={field}
              active={includeFields.includes(field)}
              onClick={() => toggleField(field)}
              disabled={readonly}
            />
          ))}
        </div>
      </SetupCardShell>
    </>
  );
}
