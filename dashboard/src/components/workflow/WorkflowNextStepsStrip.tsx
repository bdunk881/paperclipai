import clsx from "clsx";
import type { SuggestedNextStep } from "../../pages/workflowStepSetup";

type Props = {
  steps: SuggestedNextStep[];
  className?: string;
  onAction: (step: SuggestedNextStep) => void;
  templateName?: string;
};

export function WorkflowNextStepsStrip({ steps, className, onAction, templateName }: Props) {
  if (steps.length === 0) return null;

  return (
    <div
      data-testid="workflow-next-steps-strip"
      className={clsx(
        "mx-4 mb-3 rounded-xl border border-af2-clay/25 bg-gradient-to-r from-af2-clay/[0.06] to-af2-mustard/[0.04] px-4 py-3 shadow-sm",
        className
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-af2-clay">
          {templateName ? `Next for ${templateName}` : "Suggested next steps"}
        </span>
        <span className="hidden text-af2-ink-4 sm:inline">·</span>
        <ul className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {steps.map((step) => (
            <li key={step.id}>
              <button
                type="button"
                className="rounded-full border border-af2-line bg-af2-card/90 px-3 py-1.5 text-xs text-af2-ink-2 transition hover:border-af2-clay/40 hover:text-af2-clay"
                onClick={() => onAction(step)}
              >
                → {step.label}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
