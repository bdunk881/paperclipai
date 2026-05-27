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
  const options = (await beginWebauthnRegistration()) as Parameters<typeof startRegistration>[0];
  const credential = await startRegistration(options);
  return finishWebauthnRegistration(credential, deviceName);
}

export interface PasskeyVerificationResult {
  verified: true;
  expiresAt: number;
}

export async function verifyPasskey(): Promise<PasskeyVerificationResult> {
  const options = (await beginWebauthnAuthentication()) as Parameters<typeof startAuthentication>[0];
  const assertion = await startAuthentication(options);
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
