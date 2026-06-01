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

// Passkey sign-up intent (HEL-390). Passwordless passkey sign-up verifies the
// email via a clicked link, which often lands in a NEW tab — so we stash the
// "this person came here to make a passkey" intent in localStorage (shared
// across tabs, unlike sessionStorage) before sending the email. After the link
// signs them in, the enrollment flow consumes the flag and jumps straight to
// passkey creation instead of the generic factor chooser.
const PASSKEY_SIGNUP_INTENT_KEY = "autoflow.auth.passkeySignupIntent";
const PASSKEY_SIGNUP_INTENT_TTL_MS = 30 * 60 * 1000;

export function markPasskeySignupIntent(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PASSKEY_SIGNUP_INTENT_KEY, String(Date.now()));
  } catch {
    // Private-mode / storage-disabled: the flow still works, it just lands on
    // the factor chooser (passkey is the recommended first option anyway).
  }
}

/**
 * Reads and clears the passkey sign-up intent. Returns true only when the flag
 * was set recently (guards against a stale flag from an abandoned sign-up).
 */
export function consumePasskeySignupIntent(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(PASSKEY_SIGNUP_INTENT_KEY);
    if (!raw) return false;
    window.localStorage.removeItem(PASSKEY_SIGNUP_INTENT_KEY);
    const ts = Number(raw);
    return Number.isFinite(ts) && Date.now() - ts < PASSKEY_SIGNUP_INTENT_TTL_MS;
  } catch {
    return false;
  }
}