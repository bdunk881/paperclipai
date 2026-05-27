/**
 * Step-up event bus mirroring `dashboard/src/auth/stepUpEvents.ts`. Lets
 * any admin API call signal "the backend wants a fresh AAL2" without each
 * caller importing the modal directly.
 */

export interface StepUpRequiredDetail {
  reason?: string;
}

export const STEP_UP_REQUIRED_EVENT = "autoflow:mfa:step-up-required";
export const STEP_UP_SATISFIED_EVENT = "autoflow:mfa:step-up-satisfied";
export const STEP_UP_CANCELLED_EVENT = "autoflow:mfa:step-up-cancelled";

export function emitStepUpRequired(detail: StepUpRequiredDetail = {}): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<StepUpRequiredDetail>(STEP_UP_REQUIRED_EVENT, { detail }));
}

export function emitStepUpSatisfied(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(STEP_UP_SATISFIED_EVENT));
}

export function emitStepUpCancelled(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(STEP_UP_CANCELLED_EVENT));
}

export function awaitStepUp(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("step-up unsupported"));
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      window.removeEventListener(STEP_UP_SATISFIED_EVENT, onSatisfied);
      window.removeEventListener(STEP_UP_CANCELLED_EVENT, onCancelled);
    };
    const onSatisfied = () => {
      cleanup();
      resolve();
    };
    const onCancelled = () => {
      cleanup();
      reject(new Error("Step-up cancelled"));
    };
    window.addEventListener(STEP_UP_SATISFIED_EVENT, onSatisfied);
    window.addEventListener(STEP_UP_CANCELLED_EVENT, onCancelled);
  });
}

export function isStepUpRequired(err: unknown): boolean {
  if (!err) return false;
  const message = err instanceof Error ? err.message : String(err);
  return /mfa_step_up_required|staff_requires_passkey/i.test(message);
}
