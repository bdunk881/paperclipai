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
  /** HEL-773: saved workflows offered by the sub_workflow picker. */
  availableWorkflows?: Array<{ id: string; name: string }>;
  availableWorkflowsLoading?: boolean;
  availableWorkflowsError?: string | null;
  /** HEL-775: saved workflow id, so the form_trigger card can show the public form URL. */
  canonicalWorkflowId?: string | null;
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
  availableWorkflows = [],
  availableWorkflowsLoading,
  availableWorkflowsError,
  canonicalWorkflowId = null,
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

      case "sub_workflow": {
        // HEL-773: the engine runs the saved workflow in config.workflowId —
        // write into step.config (merged, so __uiPosition etc. survive), NOT a
        // flat step prop.
        const selectedWorkflowId =
          typeof step.config?.["workflowId"] === "string"
            ? (step.config["workflowId"] as string)
            : "";
        return (
          <SetupCoachCard
            index={1}
            total={1}
            title="Which workflow should run here?"
            hint="Its output merges back into this run for the next steps."
          >
            {availableWorkflowsLoading ? (
              <p className="text-xs text-af2-ink-4">Loading workflows…</p>
            ) : availableWorkflowsError ? (
              <p className="text-xs text-af2-clay">{availableWorkflowsError}</p>
            ) : availableWorkflows.length === 0 ? (
              <p className="text-xs text-af2-mustard leading-relaxed">
                No other saved workflows yet — save another workflow first, then pick it here.
              </p>
            ) : (
              <select
                data-field="subWorkflowId"
                className="w-full rounded-lg border border-af2-line-2 px-3 py-2 text-sm bg-af2-card"
                value={selectedWorkflowId}
                disabled={readonly}
                onChange={(e) =>
                  onUpdateStep({
                    config: {
                      ...(step.config ?? {}),
                      workflowId: e.target.value || undefined,
                    },
                  })
                }
              >
                <option value="">Choose a workflow…</option>
                {availableWorkflows.map((wf) => (
                  <option key={wf.id} value={wf.id}>
                    {wf.name}
                  </option>
                ))}
              </select>
            )}
          </SetupCoachCard>
        );
      }

      case "filter": {
        // HEL-779: keep only the array items that pass the predicate. The engine
        // reads config.itemsKey (the array) + config.condition (falls back to
        // step.condition); both live in step.config.
        const itemsKey =
          typeof step.config?.["itemsKey"] === "string" ? (step.config["itemsKey"] as string) : "";
        const condition =
          typeof step.config?.["condition"] === "string"
            ? (step.config["condition"] as string)
            : typeof step.condition === "string"
              ? step.condition
              : "";
        return (
          <SetupCoachCard
            index={1}
            total={1}
            title="What should this filter?"
            hint="Keeps only the items that pass your rule; drops the rest."
          >
            <label className="block text-xs text-af2-ink-3">
              Array field to filter
              <input
                data-field="itemsKey"
                className="mt-1 w-full rounded-lg border border-af2-line-2 px-3 py-2 text-sm font-mono"
                placeholder="e.g. tickets"
                value={itemsKey}
                disabled={readonly}
                onChange={(e) =>
                  onUpdateStep({
                    config: { ...(step.config ?? {}), itemsKey: e.target.value || undefined },
                  })
                }
              />
            </label>
            <label className="block text-xs text-af2-ink-3">
              Keep items where…
              <input
                data-field="condition"
                className="mt-1 w-full rounded-lg border border-af2-line-2 px-3 py-2 text-sm font-mono"
                placeholder="e.g. score > 50"
                value={condition}
                disabled={readonly}
                onChange={(e) =>
                  onUpdateStep({
                    config: { ...(step.config ?? {}), condition: e.target.value || undefined },
                  })
                }
              />
            </label>
            <p className="text-[11px] leading-relaxed text-af2-ink-4">
              The rule runs once per item. Each field of the item is in scope, plus the whole row
              as <code>item</code>. No rule means every item passes through.
            </p>
          </SetupCoachCard>
        );
      }

      case "wait": {
        // HEL-779: duration / until / webhook. Engine (waitStep.ts) reads
        // config.mode + (amount+unit | until); webhook pauses with no timer.
        const mode =
          typeof step.config?.["mode"] === "string" ? (step.config["mode"] as string) : "duration";
        const amountRaw = step.config?.["amount"];
        const amount =
          typeof amountRaw === "number"
            ? String(amountRaw)
            : typeof amountRaw === "string"
              ? amountRaw
              : "";
        const unit =
          typeof step.config?.["unit"] === "string" ? (step.config["unit"] as string) : "seconds";
        const until =
          typeof step.config?.["until"] === "string" ? (step.config["until"] as string) : "";
        const patchWait = (patch: Record<string, unknown>) =>
          onUpdateStep({ config: { ...(step.config ?? {}), ...patch } });
        return (
          <SetupCoachCard
            index={1}
            total={1}
            title="How long should this wait?"
            hint="Pause the run here, then resume automatically."
          >
            <label className="block text-xs text-af2-ink-3">
              Wait mode
              <select
                data-field="waitMode"
                className="mt-1 w-full rounded-lg border border-af2-line-2 bg-af2-card px-3 py-2 text-sm"
                value={mode}
                disabled={readonly}
                onChange={(e) => patchWait({ mode: e.target.value })}
              >
                <option value="duration">For a set amount of time</option>
                <option value="until">Until a specific time</option>
                <option value="webhook">Until an external event (webhook)</option>
              </select>
            </label>
            {mode === "duration" && (
              <div className="flex gap-2">
                <input
                  data-field="waitAmount"
                  type="number"
                  min={1}
                  className="w-24 rounded-lg border border-af2-line-2 px-3 py-2 text-sm"
                  placeholder="30"
                  value={amount}
                  disabled={readonly}
                  onChange={(e) =>
                    patchWait({
                      amount: e.target.value === "" ? undefined : Number(e.target.value),
                    })
                  }
                />
                <select
                  data-field="waitUnit"
                  className="flex-1 rounded-lg border border-af2-line-2 bg-af2-card px-3 py-2 text-sm"
                  value={unit}
                  disabled={readonly}
                  onChange={(e) => patchWait({ unit: e.target.value })}
                >
                  <option value="seconds">seconds</option>
                  <option value="minutes">minutes</option>
                  <option value="hours">hours</option>
                  <option value="days">days</option>
                </select>
              </div>
            )}
            {mode === "until" && (
              <label className="block text-xs text-af2-ink-3">
                Resume at
                <input
                  data-field="waitUntil"
                  type="datetime-local"
                  className="mt-1 w-full rounded-lg border border-af2-line-2 px-3 py-2 text-sm"
                  value={until}
                  disabled={readonly}
                  onChange={(e) => patchWait({ until: e.target.value || undefined })}
                />
              </label>
            )}
            {mode === "webhook" && (
              <p className="rounded-lg border border-af2-line bg-af2-paper-3 px-3 py-2.5 text-[11px] leading-relaxed text-af2-ink-2">
                The run pauses here with no timer until an external call wakes it:{" "}
                <code>POST /api/runs/resume/:token</code>. The one-time resume token is issued when
                the run reaches this step.
              </p>
            )}
          </SetupCoachCard>
        );
      }

      case "stop_error": {
        // HEL-779: deliberately fail the run. Engine (stopErrorStep.ts) reads
        // config.message (alias errorMessage) + optional config.errorType; a blank
        // message falls back to a default, so the message is not required.
        const message =
          typeof step.config?.["message"] === "string"
            ? (step.config["message"] as string)
            : typeof step.config?.["errorMessage"] === "string"
              ? (step.config["errorMessage"] as string)
              : "";
        const errorType =
          typeof step.config?.["errorType"] === "string"
            ? (step.config["errorType"] as string)
            : "";
        return (
          <SetupCoachCard
            index={1}
            total={1}
            title="Stop the run with an error"
            hint="Reject a bad branch, or assert that something must be true."
          >
            <label className="block text-xs text-af2-ink-3">
              Failure message
              <textarea
                data-field="stopMessage"
                className="mt-1 w-full resize-none rounded-lg border border-af2-line-2 px-3 py-2 text-sm"
                rows={2}
                placeholder="e.g. No matching record for {{customerId}}"
                value={message}
                disabled={readonly}
                onChange={(e) =>
                  onUpdateStep({
                    config: { ...(step.config ?? {}), message: e.target.value || undefined },
                  })
                }
              />
            </label>
            <label className="block text-xs text-af2-ink-3">
              Error type <span className="text-af2-ink-4">(optional)</span>
              <input
                data-field="stopErrorType"
                className="mt-1 w-full rounded-lg border border-af2-line-2 px-3 py-2 text-sm font-mono"
                placeholder="e.g. not_found"
                value={errorType}
                disabled={readonly}
                onChange={(e) =>
                  onUpdateStep({
                    config: { ...(step.config ?? {}), errorType: e.target.value || undefined },
                  })
                }
              />
            </label>
            <p className="text-[11px] leading-relaxed text-af2-ink-4">
              <code>{"{{key}}"}</code> placeholders fill from the run context. A blank message uses a
              default. This always stops the run — it ignores continue-on-fail.
            </p>
          </SetupCoachCard>
        );
      }

      case "merge":
        return (
          <SetupCoachCard
            index={1}
            total={1}
            title="Merge branches"
            hint="Rejoins parallel branches before the next step."
          >
            <p className="text-xs leading-relaxed text-af2-ink-3">
              This step passes through the inputs that reached it — connect the branches you want to
              rejoin into it. Nothing to configure here; the merged data flows on to the next step.
            </p>
          </SetupCoachCard>
        );

      case "loop": {
        // HEL-781: bounded loop. The engine (loopStep.ts) jumps BACK to
        // config.loopStartStepId (an EARLIER step) up to config.maxIterations
        // times, exiting early when config.breakCondition is truthy. Targets
        // resolve by template.steps index === setupContext.steps index.
        const cfg = step.config ?? {};
        const loopStartStepId =
          typeof cfg["loopStartStepId"] === "string" ? (cfg["loopStartStepId"] as string) : "";
        const maxIterationsRaw = cfg["maxIterations"];
        const maxIterations =
          typeof maxIterationsRaw === "number"
            ? String(maxIterationsRaw)
            : typeof maxIterationsRaw === "string"
              ? maxIterationsRaw
              : "";
        const breakCondition =
          typeof cfg["breakCondition"] === "string" ? (cfg["breakCondition"] as string) : "";
        const currentIndex = setupContext.steps.findIndex((s) => s.id === step.id);
        const earlierSteps =
          currentIndex > 0 ? setupContext.steps.filter((_, i) => i < currentIndex) : [];
        const patchLoop = (patch: Record<string, unknown>) =>
          onUpdateStep({ config: { ...(step.config ?? {}), ...patch } });
        return (
          <SetupCoachCard
            index={1}
            total={1}
            title="What should repeat?"
            hint="Re-runs an earlier stretch of steps until it is done."
          >
            {earlierSteps.length === 0 ? (
              <p className="text-xs leading-relaxed text-af2-mustard">
                Add an earlier step first — a loop jumps back to a step above it to repeat.
              </p>
            ) : (
              <>
                <label className="block text-xs text-af2-ink-3">
                  Jump back to
                  <select
                    data-field="loopStartStepId"
                    className="mt-1 w-full rounded-lg border border-af2-line-2 bg-af2-card px-3 py-2 text-sm"
                    value={loopStartStepId}
                    disabled={readonly}
                    onChange={(e) => patchLoop({ loopStartStepId: e.target.value || undefined })}
                  >
                    <option value="">Choose the step to repeat from…</option>
                    {earlierSteps.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name || s.kind}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs text-af2-ink-3">
                  Max times to repeat
                  <input
                    data-field="loopMaxIterations"
                    type="number"
                    min={1}
                    className="mt-1 w-full rounded-lg border border-af2-line-2 px-3 py-2 text-sm"
                    placeholder="e.g. 10"
                    value={maxIterations}
                    disabled={readonly}
                    onChange={(e) =>
                      patchLoop({
                        maxIterations: e.target.value === "" ? undefined : Number(e.target.value),
                      })
                    }
                  />
                </label>
                <label className="block text-xs text-af2-ink-3">
                  Stop early when <span className="text-af2-ink-4">(optional)</span>
                  <input
                    data-field="loopBreakCondition"
                    className="mt-1 w-full rounded-lg border border-af2-line-2 px-3 py-2 text-sm font-mono"
                    placeholder="e.g. done === true"
                    value={breakCondition}
                    disabled={readonly}
                    onChange={(e) => patchLoop({ breakCondition: e.target.value || undefined })}
                  />
                </label>
                <p className="text-[11px] leading-relaxed text-af2-ink-4">
                  Runs at most this many times — a hard cap also guards against runaway loops. Leave
                  the stop rule blank to always run the full count.
                </p>
              </>
            )}
          </SetupCoachCard>
        );
      }

      case "switch": {
        // HEL-781: N-way route. The engine (switchStep.ts) takes the first route
        // whose condition is true and jumps FORWARD to its targetStepId, else the
        // fallbackStepId. Targets must be downstream (index > this step's index).
        const cfg = step.config ?? {};
        const routes = Array.isArray(cfg["routes"])
          ? (cfg["routes"] as Array<{ condition?: string; targetStepId?: string }>)
          : [];
        const fallbackStepId =
          typeof cfg["fallbackStepId"] === "string" ? (cfg["fallbackStepId"] as string) : "";
        const currentIndex = setupContext.steps.findIndex((s) => s.id === step.id);
        const forwardSteps =
          currentIndex >= 0 ? setupContext.steps.filter((_, i) => i > currentIndex) : [];
        const patchSwitch = (patch: Record<string, unknown>) =>
          onUpdateStep({ config: { ...(step.config ?? {}), ...patch } });
        const updateRoute = (idx: number, field: "condition" | "targetStepId", value: string) => {
          const next = routes.map((r, i) => (i === idx ? { ...r, [field]: value } : r));
          patchSwitch({ routes: next });
        };
        return (
          <SetupCoachCard
            index={1}
            total={1}
            title="Where should each case go?"
            hint="The first matching rule wins; each route jumps forward to a later step."
          >
            {forwardSteps.length === 0 ? (
              <p className="text-xs leading-relaxed text-af2-mustard">
                Add a later step first — a switch routes forward to downstream steps.
              </p>
            ) : (
              <>
                <div className="space-y-2">
                  {routes.map((route, idx) => (
                    <div key={idx} className="space-y-1.5 rounded-lg border border-af2-line-2 p-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-af2-ink-4">
                          Route {idx + 1}
                        </span>
                        <button
                          type="button"
                          disabled={readonly}
                          className="text-[10px] font-semibold uppercase tracking-wide text-af2-clay"
                          onClick={() =>
                            patchSwitch({ routes: routes.filter((_, i) => i !== idx) })
                          }
                        >
                          Remove
                        </button>
                      </div>
                      <input
                        data-field={`switchRouteCondition-${idx}`}
                        className="w-full rounded-lg border border-af2-line-2 px-3 py-2 text-sm font-mono"
                        placeholder={'e.g. urgency === "high"'}
                        value={route.condition ?? ""}
                        disabled={readonly}
                        onChange={(e) => updateRoute(idx, "condition", e.target.value)}
                      />
                      <select
                        data-field={`switchRouteTarget-${idx}`}
                        className="w-full rounded-lg border border-af2-line-2 bg-af2-card px-3 py-2 text-sm"
                        value={route.targetStepId ?? ""}
                        disabled={readonly}
                        onChange={(e) => updateRoute(idx, "targetStepId", e.target.value)}
                      >
                        <option value="">Go to…</option>
                        {forwardSteps.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name || s.kind}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  data-field="switchAddRoute"
                  disabled={readonly}
                  className="rounded-lg border border-dashed border-af2-line-2 px-3 py-1.5 text-xs font-medium text-af2-ink-3 transition hover:border-af2-clay/40 hover:text-af2-clay"
                  onClick={() =>
                    patchSwitch({ routes: [...routes, { condition: "", targetStepId: "" }] })
                  }
                >
                  + Add route
                </button>
                <label className="block text-xs text-af2-ink-3">
                  Otherwise <span className="text-af2-ink-4">(fallback)</span>
                  <select
                    data-field="switchFallback"
                    className="mt-1 w-full rounded-lg border border-af2-line-2 bg-af2-card px-3 py-2 text-sm"
                    value={fallbackStepId}
                    disabled={readonly}
                    onChange={(e) => patchSwitch({ fallbackStepId: e.target.value || undefined })}
                  >
                    <option value="">Continue to the next step</option>
                    {forwardSteps.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name || s.kind}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
          </SetupCoachCard>
        );
      }

      case "form_trigger": {
        // HEL-782: define the public form. The engine (formTriggerStep.ts) reads
        // config.formFields [{key,label,type,required,options?}] + config.formTitle
        // / config.formDescription; the public page (HEL-775) renders them.
        const cfg = step.config ?? {};
        const formTitle = typeof cfg["formTitle"] === "string" ? (cfg["formTitle"] as string) : "";
        const formDescription =
          typeof cfg["formDescription"] === "string" ? (cfg["formDescription"] as string) : "";
        const formFields = Array.isArray(cfg["formFields"])
          ? (cfg["formFields"] as Array<{
              key?: string;
              label?: string;
              type?: string;
              required?: boolean;
              options?: string[];
            }>)
          : [];
        const patchForm = (patch: Record<string, unknown>) =>
          onUpdateStep({ config: { ...(step.config ?? {}), ...patch } });
        const updateField = (idx: number, patch: Record<string, unknown>) =>
          patchForm({
            formFields: formFields.map((f, i) => (i === idx ? { ...f, ...patch } : f)),
          });
        return (
          <SetupCoachCard
            index={1}
            total={1}
            title="What should the form ask?"
            hint="Each field becomes a question on your public form."
          >
            <label className="block text-xs text-af2-ink-3">
              Form title <span className="text-af2-ink-4">(optional)</span>
              <input
                data-field="formTitle"
                className="mt-1 w-full rounded-lg border border-af2-line-2 px-3 py-2 text-sm"
                placeholder="e.g. Contact us"
                value={formTitle}
                disabled={readonly}
                onChange={(e) => patchForm({ formTitle: e.target.value || undefined })}
              />
            </label>
            <label className="block text-xs text-af2-ink-3">
              Description <span className="text-af2-ink-4">(optional)</span>
              <textarea
                data-field="formDescription"
                rows={2}
                className="mt-1 w-full resize-none rounded-lg border border-af2-line-2 px-3 py-2 text-sm"
                placeholder="Shown under the title on the form."
                value={formDescription}
                disabled={readonly}
                onChange={(e) => patchForm({ formDescription: e.target.value || undefined })}
              />
            </label>
            {formFields.length > 0 && (
              <div className="space-y-2">
                {formFields.map((field, idx) => {
                  const fieldType = typeof field.type === "string" ? field.type : "text";
                  return (
                    <div key={idx} className="space-y-1.5 rounded-lg border border-af2-line-2 p-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-af2-ink-4">
                          Field {idx + 1}
                        </span>
                        <button
                          type="button"
                          disabled={readonly}
                          className="text-[10px] font-semibold uppercase tracking-wide text-af2-clay"
                          onClick={() =>
                            patchForm({ formFields: formFields.filter((_, i) => i !== idx) })
                          }
                        >
                          Remove
                        </button>
                      </div>
                      <div className="flex gap-2">
                        <input
                          data-field={`formFieldKey-${idx}`}
                          className="w-1/2 rounded-lg border border-af2-line-2 px-2.5 py-1.5 text-xs font-mono"
                          placeholder="key (e.g. email)"
                          value={field.key ?? ""}
                          disabled={readonly}
                          onChange={(e) => updateField(idx, { key: e.target.value })}
                        />
                        <input
                          data-field={`formFieldLabel-${idx}`}
                          className="w-1/2 rounded-lg border border-af2-line-2 px-2.5 py-1.5 text-xs"
                          placeholder="Label (e.g. Your email)"
                          value={field.label ?? ""}
                          disabled={readonly}
                          onChange={(e) => updateField(idx, { label: e.target.value })}
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <select
                          data-field={`formFieldType-${idx}`}
                          className="flex-1 rounded-lg border border-af2-line-2 bg-af2-card px-2.5 py-1.5 text-xs"
                          value={fieldType}
                          disabled={readonly}
                          onChange={(e) => updateField(idx, { type: e.target.value })}
                        >
                          <option value="text">Text</option>
                          <option value="textarea">Long text</option>
                          <option value="number">Number</option>
                          <option value="email">Email</option>
                          <option value="select">Dropdown</option>
                          <option value="checkbox">Checkbox</option>
                        </select>
                        <label className="flex items-center gap-1.5 text-[11px] text-af2-ink-3">
                          <input
                            type="checkbox"
                            data-field={`formFieldRequired-${idx}`}
                            checked={field.required === true}
                            disabled={readonly}
                            onChange={(e) => updateField(idx, { required: e.target.checked })}
                          />
                          Required
                        </label>
                      </div>
                      {fieldType === "select" && (
                        <input
                          data-field={`formFieldOptions-${idx}`}
                          className="w-full rounded-lg border border-af2-line-2 px-2.5 py-1.5 text-xs font-mono"
                          placeholder="Dropdown options, comma-separated"
                          value={(field.options ?? []).join(", ")}
                          disabled={readonly}
                          onChange={(e) =>
                            updateField(idx, {
                              options: e.target.value
                                .split(",")
                                .map((o) => o.trim())
                                .filter(Boolean),
                            })
                          }
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <button
              type="button"
              data-field="formAddField"
              disabled={readonly}
              className="rounded-lg border border-dashed border-af2-line-2 px-3 py-1.5 text-xs font-medium text-af2-ink-3 transition hover:border-af2-clay/40 hover:text-af2-clay"
              onClick={() =>
                patchForm({
                  formFields: [
                    ...formFields,
                    { key: "", label: "", type: "text", required: false },
                  ],
                })
              }
            >
              + Add field
            </button>
            {canonicalWorkflowId ? (
              <div className="mt-1 rounded-lg border border-af2-line bg-af2-paper-3 px-3 py-2.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-af2-ink-4">
                  Public form link
                </p>
                <div className="mt-1.5 flex items-center gap-2">
                  <input
                    data-field="formPublicUrl"
                    readOnly
                    className="flex-1 rounded-md border border-af2-line-2 bg-af2-card px-2.5 py-1.5 text-xs font-mono text-af2-ink-2"
                    value={`${window.location.origin}/forms/${canonicalWorkflowId}`}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <button
                    type="button"
                    className="shrink-0 rounded-md border border-af2-line-2 px-2.5 py-1.5 text-[11px] font-semibold text-af2-ink-3 transition hover:border-af2-clay/40 hover:text-af2-clay"
                    onClick={() => {
                      void navigator.clipboard?.writeText(
                        `${window.location.origin}/forms/${canonicalWorkflowId}`,
                      );
                    }}
                  >
                    Copy
                  </button>
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-af2-ink-4">
                  Share this link — anyone who opens it can submit the form and start a run.
                </p>
              </div>
            ) : (
              <p className="mt-1 text-[11px] leading-relaxed text-af2-mustard">
                Save this workflow to get a shareable form link.
              </p>
            )}
          </SetupCoachCard>
        );
      }

      case "sub_workflow_trigger": {
        // HEL-785: declare the inputs this callable workflow expects. The engine
        // (subWorkflowTriggerStep.ts) reads config.inputs [{key,label,defaultValue?}]
        // and applies defaults for any the caller omits.
        const cfg = step.config ?? {};
        const inputs = Array.isArray(cfg["inputs"])
          ? (cfg["inputs"] as Array<{ key?: string; label?: string; defaultValue?: unknown }>)
          : [];
        const patchTrigger = (patch: Record<string, unknown>) =>
          onUpdateStep({ config: { ...(step.config ?? {}), ...patch } });
        const updateInput = (idx: number, field: "key" | "label" | "defaultValue", value: string) =>
          patchTrigger({
            inputs: inputs.map((it, i) =>
              i === idx
                ? { ...it, [field]: field === "defaultValue" ? value || undefined : value }
                : it,
            ),
          });
        return (
          <SetupCoachCard
            index={1}
            total={1}
            title="Inputs this sub-workflow expects"
            hint="A parent seeds these when it calls this workflow. Optional — declare the ones you depend on."
          >
            {inputs.length > 0 && (
              <div className="space-y-2">
                {inputs.map((inp, idx) => {
                  const defaultStr =
                    typeof inp.defaultValue === "string"
                      ? inp.defaultValue
                      : inp.defaultValue !== undefined
                        ? String(inp.defaultValue)
                        : "";
                  return (
                    <div key={idx} className="space-y-1.5 rounded-lg border border-af2-line-2 p-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-af2-ink-4">
                          Input {idx + 1}
                        </span>
                        <button
                          type="button"
                          disabled={readonly}
                          className="text-[10px] font-semibold uppercase tracking-wide text-af2-clay"
                          onClick={() =>
                            patchTrigger({ inputs: inputs.filter((_, i) => i !== idx) })
                          }
                        >
                          Remove
                        </button>
                      </div>
                      <div className="flex gap-2">
                        <input
                          data-field={`subWfInputKey-${idx}`}
                          className="w-1/2 rounded-lg border border-af2-line-2 px-2.5 py-1.5 text-xs font-mono"
                          placeholder="key (e.g. customerId)"
                          value={inp.key ?? ""}
                          disabled={readonly}
                          onChange={(e) => updateInput(idx, "key", e.target.value)}
                        />
                        <input
                          data-field={`subWfInputLabel-${idx}`}
                          className="w-1/2 rounded-lg border border-af2-line-2 px-2.5 py-1.5 text-xs"
                          placeholder="Label"
                          value={inp.label ?? ""}
                          disabled={readonly}
                          onChange={(e) => updateInput(idx, "label", e.target.value)}
                        />
                      </div>
                      <input
                        data-field={`subWfInputDefault-${idx}`}
                        className="w-full rounded-lg border border-af2-line-2 px-2.5 py-1.5 text-xs"
                        placeholder="Default if the caller omits it (optional)"
                        value={defaultStr}
                        disabled={readonly}
                        onChange={(e) => updateInput(idx, "defaultValue", e.target.value)}
                      />
                    </div>
                  );
                })}
              </div>
            )}
            <button
              type="button"
              data-field="subWfAddInput"
              disabled={readonly}
              className="rounded-lg border border-dashed border-af2-line-2 px-3 py-1.5 text-xs font-medium text-af2-ink-3 transition hover:border-af2-clay/40 hover:text-af2-clay"
              onClick={() => patchTrigger({ inputs: [...inputs, { key: "", label: "" }] })}
            >
              + Add input
            </button>
            <p className="text-[11px] leading-relaxed text-af2-ink-4">
              With no declared inputs, the whole parent context is still passed through.
            </p>
          </SetupCoachCard>
        );
      }

      case "chat_trigger":
        return (
          <SetupCoachCard
            index={1}
            total={1}
            title="Starts on a chat message"
            hint="Use this as the head of a chatbot workflow."
          >
            <p className="text-xs leading-relaxed text-af2-ink-3">
              A chat surface starts a run when a message arrives. The message and session are in
              context for later steps as <code>chatMessage</code>, <code>chatSessionId</code>, and{" "}
              <code>chatUserId</code>.
            </p>
          </SetupCoachCard>
        );

      case "error_trigger":
        return (
          <SetupCoachCard
            index={1}
            total={1}
            title="Runs when another workflow fails"
            hint="Use this as the head of an error-handler workflow."
          >
            <p className="text-xs leading-relaxed text-af2-ink-3">
              Point another workflow at this one as its error handler. It runs on each failure with
              the details in context: <code>failedRunId</code>, <code>failedStepId</code>,{" "}
              <code>failedTemplateName</code>, and the full <code>errorTrigger</code> object.
            </p>
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
