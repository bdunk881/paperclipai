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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-af2-ink/35 p-4">
      <button className="absolute inset-0" onClick={onClose} aria-label="Close onboarding" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="First-run onboarding"
        className="relative w-full max-w-2xl overflow-hidden rounded-xl border border-af2-line bg-af2-card shadow-[0_18px_40px_rgba(26,20,16,0.10)]"
      >
        <div className="flex items-start justify-between border-b border-af2-line bg-af2-paper p-6">
          <div>
            <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-af2-line bg-af2-card px-2.5 py-1 text-[11px] font-medium text-af2-clay">
              <Sparkles size={12} />
              First-run onboarding
            </div>
            <h2 className="font-af2-serif text-2xl font-medium tracking-[-0.015em] text-af2-ink">
              Ship your first workflow in minutes
            </h2>
            <p className="mt-2 text-sm leading-6 text-af2-ink-2">
              Complete these steps to connect your model, launch a workflow, and review results.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-af2-ink-3 transition hover:bg-af2-paper-2 hover:text-af2-ink"
            aria-label="Close onboarding"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3 p-6">
          {steps.map((step, index) => (
            <div
              key={step.id}
              className="flex items-start gap-3 rounded-md border border-af2-line bg-af2-card p-4"
            >
              <div className="mt-0.5">
                {step.done ? (
                  <CheckCircle2 size={18} className="text-af2-sage" />
                ) : (
                  <Circle size={18} className="text-af2-clay" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10.5px] font-medium uppercase tracking-[0.12em] text-af2-ink-3">
                  Step {index + 1}
                </p>
                <p className="font-af2-serif text-base font-medium text-af2-ink">{step.title}</p>
                <p className="mt-1 text-sm leading-6 text-af2-ink-2">{step.detail}</p>
              </div>
              {!step.done && (
                <Link
                  to={step.to}
                  className="shrink-0 rounded-md border border-af2-clay/30 bg-af2-clay-soft/40 px-3 py-1.5 text-xs font-medium text-af2-clay transition hover:bg-af2-clay-soft/60"
                >
                  {step.cta}
                </Link>
              )}
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between border-t border-af2-line bg-af2-paper px-6 py-4">
          <p className="text-xs text-af2-ink-3">
            {completed}/{steps.length} steps complete
          </p>
          <Link
            to={nextStep.to}
            className="rounded-md bg-af2-clay px-3.5 py-2 text-sm font-medium text-white transition hover:bg-af2-clay-2"
          >
            {nextStep.done ? "Open dashboard" : `Continue: ${nextStep.cta}`}
          </Link>
        </div>
      </div>
    </div>
  );
}
