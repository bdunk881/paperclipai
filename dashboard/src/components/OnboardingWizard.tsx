import { useEffect } from "react";
import { CheckCircle2, Circle, Sparkles, X } from "lucide-react";
import { Link } from "react-router-dom";

export interface OnboardingStep {
  id: string;
  title: string;
  detail: string;
  to: string;
  cta: string;
  done: boolean;
}

export default function OnboardingWizard({
  open,
  onClose,
  steps,
}: {
  open: boolean;
  onClose: () => void;
  steps: OnboardingStep[];
}) {
  useEffect(() => {
    if (!open) return;
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
  }, [onClose, open]);

  if (!open) return null;

  const nextStep = steps.find((step) => !step.done) ?? steps[steps.length - 1];
  const completed = steps.filter((step) => step.done).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/35 p-4">
      <button className="absolute inset-0" onClick={onClose} aria-label="Close onboarding" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="First-run onboarding"
        className="relative w-full max-w-2xl overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl dark:border-surface-800 dark:bg-surface-900"
      >
        <div className="flex items-start justify-between border-b border-gray-100 bg-gradient-to-r from-brand-50 to-cyan-50 p-6 dark:border-surface-800 dark:from-surface-900 dark:to-surface-800">
          <div>
            <div className="mb-2 inline-flex items-center gap-1 rounded-full border border-brand-200 bg-white px-2 py-1 text-xs font-medium text-brand-700 dark:border-surface-700 dark:bg-surface-800 dark:text-brand-300">
              <Sparkles size={12} />
              First-run onboarding
            </div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Ship your first workflow in minutes</h2>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              Complete these steps to connect your model, launch a workflow, and review results.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-500 transition hover:bg-white hover:text-gray-800 dark:text-gray-300 dark:hover:bg-surface-800 dark:hover:text-gray-100"
            aria-label="Close onboarding"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3 p-6">
          {steps.map((step, index) => (
            <div
              key={step.id}
              className="flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-surface-800 dark:bg-surface-900"
            >
              <div className="mt-0.5">
                {step.done ? (
                  <CheckCircle2 size={18} className="text-green-600" />
                ) : (
                  <Circle size={18} className="text-brand-600" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                  Step {index + 1}
                </p>
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{step.title}</p>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{step.detail}</p>
              </div>
              {!step.done && (
                <Link
                  to={step.to}
                  className="shrink-0 rounded-lg border border-brand-200 bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-700 transition hover:bg-brand-100"
                >
                  {step.cta}
                </Link>
              )}
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between border-t border-gray-100 bg-gray-50 px-6 py-4 dark:border-surface-800 dark:bg-surface-900">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {completed}/{steps.length} steps complete
          </p>
          <Link
            to={nextStep.to}
            className="rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-brand-700"
          >
            {nextStep.done ? "Open dashboard" : `Continue: ${nextStep.cta}`}
          </Link>
        </div>
      </div>
    </div>
  );
}
