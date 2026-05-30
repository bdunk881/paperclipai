import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import clsx from "clsx";
import { ChevronDown, ChevronRight } from "lucide-react";
import type * as Y from "yjs";
import type { LLMConfig } from "../../api/client";
import type { WorkflowStep } from "../../types/workflow";
import {
  APPROVAL_MESSAGE_TEMPLATES,
  CRON_SCHEDULE_PRESETS,
  CURATED_ACTIONS,
  LLM_PROMPT_EXAMPLES,
  type ReadinessItem,
  type StepSetupContext,
  type SuggestedNextStep,
  buildStepSetupContext,
  evaluateStepReadiness,
  getStepOutcomeSubtitle,
  getStepSuggestedNextSteps,
  stepStatusLabel,
  validateCronExpression,
  validateIntervalMinutes,
} from "../../pages/workflowStepSetup";
import { SetupCoachCard } from "./SetupCoachCard";
import { YTextInput } from "./YTextInput";

type Props = {
  step: WorkflowStep;
  setupContext: StepSetupContext;
  readonly?: boolean;
  proMode?: boolean;
  advancedExpandedDefault?: boolean;
  llmConfigs: LLMConfig[];
  llmConfigsLoading?: boolean;
  llmConfigsError?: string | null;
  timezoneOptions?: string[];
  cronValidationError?: string | null;
  cronPreview?: string | null;
  intervalValidationError?: string | null;
  nameYText?: Y.Text | null;
  onUpdateStep: (patch: Partial<WorkflowStep>) => void;
  onFocusField?: (field: string) => void;
  onSuggestedAction?: (action: SuggestedNextStep) => void;
  advancedContent: ReactNode;
};

function ReadinessList({
  items,
  readonly,
  onFix,
}: {
  items: ReadinessItem[];
  readonly?: boolean;
  onFix: (item: ReadinessItem) => void;
}) {
  return (
    <ul className="space-y-1.5">
      {items.map((item) => (
        <li key={item.id} className="flex items-center gap-2 text-xs text-af2-ink-2">
          <span
            className={clsx(
              "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
              item.passed ? "bg-af2-sage/15 text-af2-sage" : "bg-af2-clay/10 text-af2-clay"
            )}
            aria-hidden
          >
            {item.passed ? "✓" : "○"}
          </span>
          <span className="min-w-0 flex-1">{item.label}</span>
          {!item.passed && item.fixLabel && !readonly && (
            <button
              type="button"
              className="shrink-0 rounded-md border border-af2-line px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-af2-ink-3 transition hover:border-af2-clay/40 hover:text-af2-clay"
              onClick={() => onFix(item)}
            >
              {item.fixLabel}
            </button>
          )}
          {!item.passed && item.fixAction === "link" && item.fixTarget && (
            <Link
              to={item.fixTarget}
              className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-af2-clay underline"
            >
              {item.fixLabel ?? "Open"}
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}

export function StepSetupCoach({
  step,
  setupContext,
  readonly = false,
  proMode = false,
  advancedExpandedDefault = false,
  llmConfigs,
  llmConfigsLoading,
  llmConfigsError,
  timezoneOptions = ["UTC"],
  cronValidationError = null,
  cronPreview = null,
  intervalValidationError = null,
  nameYText = null,
  onUpdateStep,
  onFocusField,
  onSuggestedAction,
  advancedContent,
}: Props) {
  const [advancedOpen, setAdvancedOpen] = useState(proMode || advancedExpandedDefault);

  const { status, items } = useMemo(
    () => evaluateStepReadiness(step, setupContext),
    [step, setupContext]
  );

  const nextSteps = useMemo(
    () => getStepSuggestedNextSteps(step, setupContext),
    [step, setupContext]
  );

  const passed = items.filter((i) => i.passed).length;
  const subtitle = getStepOutcomeSubtitle(step);

  function handleReadinessFix(item: ReadinessItem) {
    if (item.fixAction === "link" && item.fixTarget) return;
    if (item.focusField) onFocusField?.(item.focusField);
  }

  function renderGuidedCards(): ReactNode {
    switch (step.kind) {
      case "cron_trigger":
        return (
          <SetupCoachCard
            index={1}
            total={1}
            title="When should this run?"
            hint="Pick a common schedule or enter a custom one under Advanced."
          >
            <div className="flex flex-wrap gap-2">
              {CRON_SCHEDULE_PRESETS.map((preset) => (
                <button
                  key={preset.cron}
                  type="button"
                  disabled={readonly}
                  className={clsx(
                    "rounded-full border px-3 py-1.5 text-xs transition",
                    step.cronExpression === preset.cron
                      ? "border-af2-clay bg-af2-clay-soft text-af2-ink"
                      : "border-af2-line-2 bg-af2-card text-af2-ink-3 hover:border-af2-clay/40"
                  )}
                  onClick={() =>
                    onUpdateStep({ cronExpression: preset.cron, timezone: step.timezone ?? "UTC" })
                  }
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <input
              data-field="cronExpression"
              className="w-full rounded-lg border border-af2-line-2 px-3 py-2 text-sm font-mono"
              placeholder="0 9 * * 1-5"
              value={step.cronExpression ?? ""}
              disabled={readonly}
              onChange={(e) => onUpdateStep({ cronExpression: e.target.value })}
            />
            {(cronValidationError ?? validateCronExpression(step.cronExpression ?? "")) && (
              <p className="text-xs text-af2-clay">
                {cronValidationError ?? validateCronExpression(step.cronExpression ?? "")}
              </p>
            )}
            {cronPreview && !cronValidationError && (
              <p className="text-xs text-af2-ink-4">{cronPreview}</p>
            )}
            <label className="block text-xs text-af2-ink-3">
              Timezone
              <input
                list="setup-coach-timezones"
                className="mt-1 w-full rounded-lg border border-af2-line-2 px-3 py-2 text-sm"
                value={step.timezone ?? "UTC"}
                disabled={readonly}
                onChange={(e) => onUpdateStep({ timezone: e.target.value || "UTC" })}
              />
              <datalist id="setup-coach-timezones">
                {timezoneOptions.map((tz) => (
                  <option key={tz} value={tz} />
                ))}
              </datalist>
            </label>
          </SetupCoachCard>
        );

      case "interval_trigger":
        return (
          <SetupCoachCard index={1} total={1} title="How often should this run?" hint="Minutes between each run.">
            <input
              data-field="intervalMinutes"
              type="number"
              min={1}
              className="w-full rounded-lg border border-af2-line-2 px-3 py-2 text-sm"
              value={step.intervalMinutes ?? ""}
              disabled={readonly}
              onChange={(e) =>
                onUpdateStep({
                  intervalMinutes: e.target.value === "" ? undefined : Number(e.target.value),
                })
              }
            />
            {(intervalValidationError ?? validateIntervalMinutes(step.intervalMinutes)) && (
              <p className="text-xs text-af2-clay">
                {intervalValidationError ?? validateIntervalMinutes(step.intervalMinutes)}
              </p>
            )}
          </SetupCoachCard>
        );

      case "llm":
        return (
          <>
            <SetupCoachCard
              index={1}
              total={2}
              title="What should the AI do?"
              hint="Describe the outcome in plain English — not code."
            >
              <div className="flex flex-wrap gap-2">
                {LLM_PROMPT_EXAMPLES.map((example) => (
                  <button
                    key={example}
                    type="button"
                    disabled={readonly}
                    className="rounded-full border border-af2-line-2 bg-af2-card px-2.5 py-1 text-[11px] text-af2-ink-3 transition hover:border-af2-clay/40"
                    onClick={() => onUpdateStep({ promptTemplate: example })}
                  >
                    {example.slice(0, 42)}…
                  </button>
                ))}
              </div>
              <textarea
                data-field="promptTemplate"
                className="w-full resize-none rounded-lg border border-af2-line-2 px-3 py-2 text-sm"
                rows={4}
                placeholder="e.g. Classify urgency and topic, then summarize for the team."
                value={step.promptTemplate ?? ""}
                disabled={readonly}
                onChange={(e) => onUpdateStep({ promptTemplate: e.target.value })}
              />
            </SetupCoachCard>
            <SetupCoachCard index={2} total={2} title="Which model?" hint="Uses your workspace default unless you pick one.">
              {llmConfigsLoading ? (
                <p className="text-xs text-af2-ink-4">Loading models…</p>
              ) : llmConfigsError ? (
                <p className="text-xs text-af2-clay">{llmConfigsError}</p>
              ) : llmConfigs.length === 0 ? (
                <p className="text-xs text-af2-mustard leading-relaxed">
                  No models connected yet.{" "}
                  <Link to="/settings/llm-providers" className="font-medium underline">
                    Connect in Settings
                  </Link>
                </p>
              ) : (
                <select
                  data-field="llmConfigId"
                  className="w-full rounded-lg border border-af2-line-2 px-3 py-2 text-sm bg-af2-card"
                  value={step.llmConfigId ?? ""}
                  disabled={readonly}
                  onChange={(e) => onUpdateStep({ llmConfigId: e.target.value || undefined })}
                >
                  <option value="">Workspace default</option>
                  {llmConfigs.map((cfg) => (
                    <option key={cfg.id} value={cfg.id}>
                      {cfg.label} ({cfg.provider})
                    </option>
                  ))}
                </select>
              )}
            </SetupCoachCard>
          </>
        );

      case "approval":
        return (
          <>
            <SetupCoachCard index={1} total={2} title="Who signs off?" hint="Email or role name.">
              <input
                data-field="approvalAssignee"
                className="w-full rounded-lg border border-af2-line-2 px-3 py-2 text-sm"
                placeholder="manager@company.com"
                value={step.approvalAssignee ?? ""}
                disabled={readonly}
                onChange={(e) => onUpdateStep({ approvalAssignee: e.target.value })}
              />
            </SetupCoachCard>
            <SetupCoachCard index={2} total={2} title="What are they approving?" hint="Shown in their inbox or ticket.">
              <div className="flex flex-wrap gap-2">
                {APPROVAL_MESSAGE_TEMPLATES.map((template) => (
                  <button
                    key={template}
                    type="button"
                    disabled={readonly}
                    className="rounded-full border border-af2-line-2 bg-af2-card px-2.5 py-1 text-[11px] text-af2-ink-3"
                    onClick={() => onUpdateStep({ approvalMessage: template })}
                  >
                    Use template
                  </button>
                ))}
              </div>
              <textarea
                data-field="approvalMessage"
                className="w-full resize-none rounded-lg border border-af2-line-2 px-3 py-2 text-sm"
                rows={3}
                value={step.approvalMessage ?? ""}
                disabled={readonly}
                onChange={(e) => onUpdateStep({ approvalMessage: e.target.value })}
              />
            </SetupCoachCard>
          </>
        );

      case "action":
        return (
          <SetupCoachCard index={1} total={1} title="What should happen?" hint="Pick an action your team uses often.">
            <select
              data-field="action"
              className="w-full rounded-lg border border-af2-line-2 px-3 py-2 text-sm bg-af2-card"
              value={step.action ?? ""}
              disabled={readonly}
              onChange={(e) => onUpdateStep({ action: e.target.value })}
            >
              <option value="">Choose an action…</option>
              {CURATED_ACTIONS.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </select>
          </SetupCoachCard>
        );

      case "mcp":
        return (
          <SetupCoachCard
            index={1}
            total={1}
            title="Which tool should this call?"
            hint="Connect Slack, Gmail, or HubSpot under Integrations, then name the tool here."
          >
            <input
              data-field="mcpTool"
              className="w-full rounded-lg border border-af2-line-2 px-3 py-2 text-sm"
              placeholder="e.g. post_message"
              value={step.mcpTool ?? ""}
              disabled={readonly}
              onChange={(e) => onUpdateStep({ mcpTool: e.target.value })}
            />
            <Link to="/integrations" className="text-xs font-medium text-af2-clay underline">
              Open Integrations
            </Link>
          </SetupCoachCard>
        );

      case "trigger":
      case "file_trigger":
        return (
          <SetupCoachCard index={1} total={1} title="What starts this routine?" hint="One sentence your team will understand.">
            <textarea
              data-field="description"
              className="w-full resize-none rounded-lg border border-af2-line-2 px-3 py-2 text-sm"
              rows={3}
              placeholder="e.g. When a customer emails support, or when I click Run."
              value={step.description}
              disabled={readonly}
              onChange={(e) => onUpdateStep({ description: e.target.value })}
            />
          </SetupCoachCard>
        );

      default:
        return (
          <SetupCoachCard index={1} total={1} title="Describe this step" hint="Helps your team understand the routine later.">
            <textarea
              data-field="description"
              className="w-full resize-none rounded-lg border border-af2-line-2 px-3 py-2 text-sm"
              rows={3}
              value={step.description}
              disabled={readonly}
              onChange={(e) => onUpdateStep({ description: e.target.value })}
            />
          </SetupCoachCard>
        );
    }
  }

  return (
    <div className="space-y-5 p-5" data-testid="step-setup-coach">
      <div>
        <div className="af2-eyebrow">Setup this step</div>
        <div className="mt-2 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <YTextInput
              yText={nameYText}
              data-field="name"
              className="w-full border-0 bg-transparent font-af2-serif text-lg font-medium text-af2-ink outline-none"
              value={step.name}
              disabled={readonly}
              aria-label="Step name"
              onChangeValue={(nextName) => onUpdateStep({ name: nextName })}
            />
            <p className="mt-1 text-xs leading-relaxed text-af2-ink-3">{subtitle}</p>
          </div>
          <span
            className={clsx(
              "shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide",
              status === "ready"
                ? "border-af2-sage/30 bg-af2-sage/10 text-af2-sage"
                : status === "blocked"
                  ? "border-af2-clay/40 bg-af2-clay/10 text-af2-clay"
                  : "border-af2-mustard/30 bg-af2-mustard/10 text-af2-mustard"
            )}
          >
            {stepStatusLabel(status)}
          </span>
        </div>
      </div>

      <section aria-label="Step readiness">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold uppercase tracking-wide text-af2-ink-3">Readiness</span>
          <span className="font-mono text-af2-ink-4">
            {passed}/{items.length}
          </span>
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-af2-line">
          <div
            className="h-full bg-af2-sage transition-all duration-200"
            style={{ width: items.length ? `${(passed / items.length) * 100}%` : "0%" }}
          />
        </div>
        <div className="mt-3">
          <ReadinessList items={items} readonly={readonly} onFix={handleReadinessFix} />
        </div>
      </section>

      {!readonly && <div className="space-y-3">{renderGuidedCards()}</div>}

      {nextSteps.length > 0 && (
        <section aria-label="Suggested next steps">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-af2-ink-3">Suggested next steps</p>
          <ul className="mt-2 divide-y divide-af2-line rounded-lg border border-af2-line">
            {nextSteps.map((next) => (
              <li key={next.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs text-af2-ink-2 transition hover:bg-af2-paper-2"
                  onClick={() => onSuggestedAction?.(next)}
                >
                  <span className="text-af2-clay">→</span>
                  {next.label}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="border-t border-af2-line pt-2">
        <button
          type="button"
          className="flex w-full items-center gap-2 py-2 text-left text-xs font-medium text-af2-ink-3"
          onClick={() => setAdvancedOpen((o) => !o)}
          aria-expanded={advancedOpen}
        >
          {advancedOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          Advanced (kind, I/O keys, technical fields)
        </button>
        {advancedOpen && <div className="mt-3 space-y-5 border-t border-af2-line pt-4">{advancedContent}</div>}
      </div>
    </div>
  );
}

export { buildStepSetupContext };
