import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import {
  beginWebauthnAuthentication,
  beginWebauthnRegistration,
  finishWebauthnAuthentication,
  finishWebauthnRegistration,
} from "../api/mfaApi";

export interface PasskeyRegistrationResult {
  credentialId: string;
}

export async function registerPasskey(deviceName: string): Promise<PasskeyRegistrationResult> {
  // @simplewebauthn/browser v10+ wraps the options under `optionsJSON`. The
  // backend still returns the bare PublicKeyCredentialCreationOptionsJSON,
  // so we adapt at the call site rather than reshaping the API response.
  const optionsJSON = (await beginWebauthnRegistration()) as Parameters<
    typeof startRegistration
  >[0]["optionsJSON"];
  const credential = await startRegistration({ optionsJSON });
  return finishWebauthnRegistration(credential, deviceName);
}

export interface PasskeyVerificationResult {
  verified: true;
  expiresAt: number;
}

export async function verifyPasskey(): Promise<PasskeyVerificationResult> {
  const optionsJSON = (await beginWebauthnAuthentication()) as Parameters<
    typeof startAuthentication
  >[0]["optionsJSON"];
  const assertion = await startAuthentication({ optionsJSON });
  return finishWebauthnAuthentication(assertion, assertion.id);
}

export async function platformAuthenticatorAvailable(): Promise<boolean> {
  if (typeof window === "undefined" || !window.PublicKeyCredential) return false;
  try {
    return await (
      window.PublicKeyCredential as unknown as {
        isUserVerifyingPlatformAuthenticatorAvailable: () => Promise<boolean>;
      }
    ).isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export function isWebauthnAvailable(): boolean {
  if (typeof window === "undefined") return false;
  if (!window.PublicKeyCredential) return false;
  if (!window.isSecureContext) return false;
  return true;
}
