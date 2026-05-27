/**
 * Bus that lets any API call signal "the backend says I need a fresh AAL2"
 * (HEL-mfa).
 *
 * Why an event bus rather than a Promise return? Most API client modules
 * already throw `Error` on non-2xx — making them all aware of step-up
 * would require touching every helper. Instead, the few callers that
 * notice the `mfa_step_up_required` shape fire a window event; the
 * top-level `<MfaStepUpModal>` listens, opens the challenge, and (on
 * success) emits a resolution event so the caller can retry.
 */

export interface StepUpRequiredDetail {
  reason?: string;
}

export const STEP_UP_REQUIRED_EVENT = "autoflow:mfa:step-up-required";
export const STEP_UP_SATISFIED_EVENT = "autoflow:mfa:step-up-satisfied";

export function emitStepUpRequired(detail: StepUpRequiredDetail = {}): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<StepUpRequiredDetail>(STEP_UP_REQUIRED_EVENT, { detail }));
}

export function emitStepUpSatisfied(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(STEP_UP_SATISFIED_EVENT));
}

/**
 * Returns a Promise that resolves when the user completes the next step-up
 * challenge (or rejects if the modal is dismissed). Pairs with
 * `MfaStepUpModal`. Callers can wrap a failed request:
 *
 *   try { await op(); }
 *   catch (err) {
 *     if (isStepUpRequired(err)) {
 *       await awaitStepUp();
 *       return op(); // retry once
 *     }
 *     throw err;
 *   }
 */
export function awaitStepUp(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("step-up unsupported"));
  return new Promise((resolve, reject) => {
    const onSatisfied = () => {
      cleanup();
      resolve();
    };
    const onCancelled = () => {
      cleanup();
      reject(new Error("Step-up cancelled"));
    };
    const cleanup = () => {
      window.removeEventListener(STEP_UP_SATISFIED_EVENT, onSatisfied);
      window.removeEventListener("autoflow:mfa:step-up-cancelled", onCancelled);
    };
    window.addEventListener(STEP_UP_SATISFIED_EVENT, onSatisfied);
    window.addEventListener("autoflow:mfa:step-up-cancelled", onCancelled);
  });
}

export function emitStepUpCancelled(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("autoflow:mfa:step-up-cancelled"));
}

export function isStepUpRequired(err: unknown): boolean {
  if (!err) return false;
  const message = err instanceof Error ? err.message : String(err);
  return /mfa_step_up_required|staff_requires_passkey/i.test(message);
}
