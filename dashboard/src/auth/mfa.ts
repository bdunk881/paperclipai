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
  beginWebauthnLogin,
  beginWebauthnRegistration,
  finishWebauthnAuthentication,
  finishWebauthnLogin,
  finishWebauthnRegistration,
  type WebauthnLoginResult,
} from "../api/mfaApi";

export interface PasskeyRegistrationResult {
  credentialId: string;
}

export async function registerPasskey(
  accessToken: string,
  deviceName: string,
): Promise<PasskeyRegistrationResult> {
  // @simplewebauthn/browser v10+ wraps the options under `optionsJSON`. The
  // backend still returns the bare PublicKeyCredentialCreationOptionsJSON,
  // so we adapt at the call site rather than reshaping the API response.
  const optionsJSON = (await beginWebauthnRegistration(accessToken)) as Parameters<
    typeof startRegistration
  >[0]["optionsJSON"];
  const credential = await startRegistration({ optionsJSON });
  return finishWebauthnRegistration(accessToken, credential, deviceName);
}

export interface PasskeyVerificationResult {
  verified: true;
  expiresAt: number;
}

export async function verifyPasskey(accessToken: string): Promise<PasskeyVerificationResult> {
  const optionsJSON = (await beginWebauthnAuthentication(accessToken)) as Parameters<
    typeof startAuthentication
  >[0]["optionsJSON"];
  const assertion = await startAuthentication({ optionsJSON });
  return finishWebauthnAuthentication(accessToken, assertion, assertion.id);
}

/**
 * Passwordless first-factor sign-in with a discoverable passkey. Runs the
 * WebAuthn assertion ceremony against the backend's pre-auth challenge (no
 * `allowCredentials`, so the authenticator offers its resident keys), then
 * exchanges the assertion for a freshly-minted Supabase session. Unlike
 * `verifyPasskey`, there is no access token in play — the assertion itself
 * proves identity.
 */
export async function loginWithPasskey(): Promise<WebauthnLoginResult> {
  const { loginId, options } = await beginWebauthnLogin();
  const assertion = await startAuthentication({
    optionsJSON: options as Parameters<typeof startAuthentication>[0]["optionsJSON"],
  });
  return finishWebauthnLogin(loginId, assertion, assertion.id);
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
