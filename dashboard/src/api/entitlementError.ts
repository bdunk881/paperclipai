/**
 * Typed error thrown by API client functions when the server returns 402 with
 * code: "entitlement_exceeded". Preserves the full payload so the caller can
 * render a contextual upgrade CTA.
 */

export interface EntitlementErrorPayload {
  code: "entitlement_exceeded";
  feature: string;
  limit: number | boolean;
  current?: number;
  currentTier: string;
  upgradeTo: string | null;
}

export class EntitlementError extends Error {
  readonly payload: EntitlementErrorPayload;

  constructor(payload: EntitlementErrorPayload) {
    super(`Plan limit reached: ${payload.feature}`);
    this.name = "EntitlementError";
    this.payload = payload;
  }

  static isEntitlementError(err: unknown): err is EntitlementError {
    return err instanceof EntitlementError;
  }

  /** Attempt to parse a raw API response body as an EntitlementError. */
  static fromBody(body: unknown): EntitlementError | null {
    if (
      body &&
      typeof body === "object" &&
      !Array.isArray(body) &&
      (body as Record<string, unknown>)["code"] === "entitlement_exceeded"
    ) {
      return new EntitlementError(body as EntitlementErrorPayload);
    }
    return null;
  }
}
