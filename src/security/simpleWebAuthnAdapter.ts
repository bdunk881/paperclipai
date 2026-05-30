/**
 * Concrete WebAuthn adapter backed by `@simplewebauthn/server`.
 *
 * The adapter interface (`WebauthnAdapter` in `mfaService.ts`) is the seam
 * that lets unit tests stub WebAuthn without pulling the heavy crypto
 * library. Real production code passes the SimpleWebAuthn implementation
 * defined here.
 */

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type { AuthenticatorTransportFuture } from "@simplewebauthn/types";
import type {
  WebauthnAdapter,
  WebauthnAuthenticationOptions,
  WebauthnRegistrationOptions,
  WebauthnVerifyAuthenticationInput,
  WebauthnVerifyAuthenticationResult,
  WebauthnVerifyRegistrationInput,
  WebauthnVerifyRegistrationResult,
} from "./mfaService";

const VALID_TRANSPORTS: ReadonlySet<AuthenticatorTransportFuture> = new Set([
  "ble",
  "cable",
  "hybrid",
  "internal",
  "nfc",
  "smart-card",
  "usb",
]);

function normalizeTransports(
  transports: string[] | undefined,
): AuthenticatorTransportFuture[] | undefined {
  if (!transports || transports.length === 0) return undefined;
  const filtered = transports.filter((t): t is AuthenticatorTransportFuture =>
    VALID_TRANSPORTS.has(t as AuthenticatorTransportFuture),
  );
  return filtered.length > 0 ? filtered : undefined;
}

function base64urlToBuffer(b64url: string): Buffer {
  const pad = "=".repeat((4 - (b64url.length % 4)) % 4);
  const normalized = b64url.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return Buffer.from(normalized, "base64");
}

function bufferToBase64Url(buf: Buffer | Uint8Array): string {
  return Buffer.from(buf).toString("base64url");
}

export class SimpleWebAuthnAdapter implements WebauthnAdapter {
  // HEL-337: `generateRegistrationOptions` is ASYNC in @simplewebauthn/server@11
  // (returns a Promise). It MUST be awaited — reading `.challenge` off the
  // unawaited Promise yields `undefined`, which we then stored as the challenge,
  // producing the long-standing "Registration challenge expired or missing".
  async generateRegistrationOptions(input: {
    rpName: string;
    rpID: string;
    userID: string;
    userName: string;
    userDisplayName: string;
    excludeCredentials: Array<{ id: string; type: "public-key"; transports?: string[] }>;
  }): Promise<WebauthnRegistrationOptions> {
    const options = await generateRegistrationOptions({
      rpName: input.rpName,
      rpID: input.rpID,
      userID: Buffer.from(input.userID),
      userName: input.userName,
      userDisplayName: input.userDisplayName,
      attestationType: "none",
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "required",
      },
      excludeCredentials: input.excludeCredentials.map((c) => ({
        id: c.id,
        transports: normalizeTransports(c.transports),
      })),
    });
    return options as unknown as WebauthnRegistrationOptions;
  }

  // HEL-337: async in v11 — see generateRegistrationOptions note above.
  async generateAuthenticationOptions(input: {
    rpID: string;
    allowCredentials: Array<{ id: string; type: "public-key"; transports?: string[] }>;
  }): Promise<WebauthnAuthenticationOptions> {
    const options = await generateAuthenticationOptions({
      rpID: input.rpID,
      userVerification: "required",
      allowCredentials: input.allowCredentials.map((c) => ({
        id: c.id,
        transports: normalizeTransports(c.transports),
      })),
    });
    return options as unknown as WebauthnAuthenticationOptions;
  }

  async verifyRegistrationResponse(
    input: WebauthnVerifyRegistrationInput,
  ): Promise<WebauthnVerifyRegistrationResult> {
    const verification = await verifyRegistrationResponse({
      response: input.response as Parameters<typeof verifyRegistrationResponse>[0]["response"],
      expectedChallenge: input.expectedChallenge,
      expectedOrigin: input.expectedOrigin,
      expectedRPID: input.expectedRPID,
      requireUserVerification: true,
    });
    const info = verification.registrationInfo;
    if (!verification.verified || !info) {
      return {
        verified: false,
        credentialId: "",
        publicKey: Buffer.alloc(0),
        signCount: 0n,
        transports: [],
        aaguid: null,
        backedUp: false,
      };
    }
    // SimpleWebAuthn v11 wraps these under `info.credential`. Read both
    // shapes defensively so a minor library bump can't silently strip the
    // public key.
    const credential = (info as unknown as {
      credential?: {
        id?: string;
        publicKey?: Uint8Array;
        counter?: number;
        transports?: string[];
      };
    }).credential;
    const credentialID =
      credential?.id ??
      ((info as unknown as { credentialID?: Uint8Array }).credentialID
        ? bufferToBase64Url((info as unknown as { credentialID: Uint8Array }).credentialID)
        : "");
    const credentialPublicKey =
      credential?.publicKey ?? (info as unknown as { credentialPublicKey?: Uint8Array }).credentialPublicKey;
    const counter = credential?.counter ?? (info as unknown as { counter?: number }).counter ?? 0;
    const aaguid = (info as unknown as { aaguid?: string }).aaguid ?? null;
    const backedUp = Boolean((info as unknown as { credentialBackedUp?: boolean }).credentialBackedUp);
    const responseTransports = credential?.transports ?? [];
    return {
      verified: true,
      credentialId: credentialID,
      publicKey: credentialPublicKey ? Buffer.from(credentialPublicKey) : Buffer.alloc(0),
      signCount: BigInt(counter),
      transports: responseTransports,
      aaguid: aaguid && aaguid !== "00000000-0000-0000-0000-000000000000" ? aaguid : null,
      backedUp,
    };
  }

  async verifyAuthenticationResponse(
    input: WebauthnVerifyAuthenticationInput,
  ): Promise<WebauthnVerifyAuthenticationResult> {
    const verification = await verifyAuthenticationResponse({
      response: input.response as Parameters<typeof verifyAuthenticationResponse>[0]["response"],
      expectedChallenge: input.expectedChallenge,
      expectedOrigin: input.expectedOrigin,
      expectedRPID: input.expectedRPID,
      requireUserVerification: true,
      credential: {
        id: input.authenticator.credentialId,
        publicKey: new Uint8Array(input.authenticator.publicKey),
        counter: Number(input.authenticator.signCount),
      },
    } as Parameters<typeof verifyAuthenticationResponse>[0]);
    return {
      verified: verification.verified,
      newSignCount: BigInt(verification.authenticationInfo?.newCounter ?? Number(input.authenticator.signCount)),
    };
  }
}

// Re-export the helper so other modules can convert raw base64url IDs without
// importing the simplewebauthn types directly.
export { base64urlToBuffer };
