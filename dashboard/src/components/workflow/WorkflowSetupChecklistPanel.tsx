import { useEffect } from "react";
import { X } from "lucide-react";
import type { SuggestedNextStep } from "../../pages/workflowStepSetup";

type Props = {
  onClose: () => void;
  workflowSteps: SuggestedNextStep[];
  onAction: (step: SuggestedNextStep) => void;
};

export function WorkflowSetupChecklistPanel({ onClose, workflowSteps, onAction }: Props) {
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
            <p className="text-xs font-semibold uppercase tracking-wide text-af2-clay">Routine checklist</p>
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
