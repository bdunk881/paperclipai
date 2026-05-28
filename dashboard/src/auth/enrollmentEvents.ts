/**
 * Bus that signals "the user needs to enroll an MFA factor" so the global
 * `<MfaEnrollmentSheet>` can pop over the dashboard (HEL-281).
 *
 * Mirrors the `stepUpEvents.ts` pattern. The enforcement gate
 * (`MfaEnforcementGate`) emits when policy says enrollment is required
 * instead of `<Navigate>`-ing to a full-page wizard, so the dashboard
 * stays visible behind a scrim while the user enrolls.
 */

export interface EnrollmentRequiredDetail {
  /** Where the user was headed when the gate intercepted them. */
  from?: string;
}

export const ENROLLMENT_REQUIRED_EVENT = "autoflow:mfa:enrollment-required";
export const ENROLLMENT_COMPLETED_EVENT = "autoflow:mfa:enrollment-completed";

export function emitEnrollmentRequired(detail: EnrollmentRequiredDetail = {}): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<EnrollmentRequiredDetail>(ENROLLMENT_REQUIRED_EVENT, { detail }),
  );
}

export function emitEnrollmentCompleted(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(ENROLLMENT_COMPLETED_EVENT));
}
