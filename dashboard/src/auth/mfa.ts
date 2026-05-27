/**
 * Browser-side MFA orchestration (HEL-mfa).
 *
 * Bridges between:
 *   - `@simplewebauthn/browser` for the WebAuthn ceremony
 *     (`startRegistration` / `startAuthentication`).
 *   - `api/mfaApi` for the backend round-trips (options + verify).
 *
 * Keeps the rest of the dashboard ignorant of the WebAuthn protocol so the
 * enrollment wizard, the step-up modal, and the login challenge step all
 * call a single `registerPasskey()` / `verifyPasskey()` pair.
 */

import {
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import {
  beginWebauthnAuthentication,
  beginWebauthnRegistration,
  finishWebauthnAuthentication,
  finishWebauthnRegistration,
} from "../api/mfaApi";

export interface PasskeyRegistrationResult {
  credentialId: string;
}

export async function registerPasskey(
  accessToken: string,
  deviceName: string,
): Promise<PasskeyRegistrationResult> {
  const options = (await beginWebauthnRegistration(accessToken)) as Parameters<typeof startRegistration>[0];
  const credential = await startRegistration(options);
  return finishWebauthnRegistration(accessToken, credential, deviceName);
}

export interface PasskeyVerificationResult {
  verified: true;
  expiresAt: number;
}

export async function verifyPasskey(accessToken: string): Promise<PasskeyVerificationResult> {
  const options = (await beginWebauthnAuthentication(accessToken)) as Parameters<typeof startAuthentication>[0];
  const assertion = await startAuthentication(options);
  return finishWebauthnAuthentication(accessToken, assertion, assertion.id);
}

/**
 * The browser exposes `PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable`
 * for "can this device do platform-bound passkeys (Touch ID / Windows Hello)
 * out of the box?" — we surface that so the enrollment wizard can recommend
 * the right factor type.
 */
export async function platformAuthenticatorAvailable(): Promise<boolean> {
  if (typeof window === "undefined" || !window.PublicKeyCredential) return false;
  try {
    return await (window.PublicKeyCredential as unknown as {
      isUserVerifyingPlatformAuthenticatorAvailable: () => Promise<boolean>;
    }).isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/**
 * `WebAuthn` requires a secure origin (HTTPS or `localhost`). The dashboard
 * shells the check so we can hide passkey options behind a "Passkeys not
 * supported on this connection" notice in mixed-content environments.
 */
export function isWebauthnAvailable(): boolean {
  if (typeof window === "undefined") return false;
  if (!window.PublicKeyCredential) return false;
  if (!window.isSecureContext) return false;
  return true;
}
