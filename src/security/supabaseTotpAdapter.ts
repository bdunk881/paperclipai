/**
 * Supabase Auth REST adapter for TOTP factor management.
 *
 * We delegate TOTP enrollment/challenge/verify to Supabase Auth (rather than
 * implementing the OTP math ourselves) so that on successful verification
 * Supabase mints a JWT with `aal: "aal2"` + an `amr` array entry. That JWT
 * is what `requireAAL2` checks for the TOTP path.
 *
 * Endpoint reference: https://supabase.com/docs/reference/javascript/auth-mfa-enroll
 * (the SDK is a thin wrapper over POST /auth/v1/factors etc.)
 */

import { SecurityServiceError } from "./securityService";
import type { SupabaseTotpAdapter } from "./mfaService";

function firstEnv(...names: string[]): string | null {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return null;
}

function normalizeProjectUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function resolveSupabaseAuthConfig(): { authUrl: string; apiKey: string } {
  const projectUrl = normalizeProjectUrl(
    firstEnv("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "VITE_SUPABASE_URL"),
  );
  const apiKey = firstEnv(
    "SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_ANON_KEY",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "VITE_SUPABASE_PUBLISHABLE_KEY",
    "VITE_SUPABASE_ANON_KEY",
  );
  if (!projectUrl || !apiKey) {
    throw new SecurityServiceError("Supabase Auth is not configured for MFA.", 503, "auth_not_configured");
  }
  return { authUrl: `${projectUrl}/auth/v1`, apiKey };
}

async function readAuthError(response: Response): Promise<string> {
  const payload = (await response.json().catch(() => null)) as
    | { error?: string; error_description?: string; msg?: string; message?: string }
    | null;
  return (
    payload?.error_description ??
    payload?.message ??
    payload?.msg ??
    payload?.error ??
    `Supabase Auth request failed (${response.status})`
  );
}

export class SupabaseAuthTotpAdapter implements SupabaseTotpAdapter {
  async enrollTotp(accessToken: string, friendlyName: string): Promise<{
    factorId: string;
    qrCodeSvg: string;
    secret: string;
    uri: string;
  }> {
    const { authUrl, apiKey } = resolveSupabaseAuthConfig();
    const response = await fetch(`${authUrl}/factors`, {
      method: "POST",
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        factor_type: "totp",
        friendly_name: friendlyName,
      }),
    });
    if (!response.ok) {
      throw new SecurityServiceError(await readAuthError(response), response.status, "totp_enroll_failed");
    }
    const payload = (await response.json()) as {
      id: string;
      totp?: { qr_code?: string; secret?: string; uri?: string };
    };
    return {
      factorId: payload.id,
      qrCodeSvg: payload.totp?.qr_code ?? "",
      secret: payload.totp?.secret ?? "",
      uri: payload.totp?.uri ?? "",
    };
  }

  async challengeTotp(accessToken: string, factorId: string): Promise<{ challengeId: string }> {
    const { authUrl, apiKey } = resolveSupabaseAuthConfig();
    const response = await fetch(`${authUrl}/factors/${encodeURIComponent(factorId)}/challenge`, {
      method: "POST",
      headers: { apikey: apiKey, Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      throw new SecurityServiceError(await readAuthError(response), response.status, "totp_challenge_failed");
    }
    const payload = (await response.json()) as { id: string };
    return { challengeId: payload.id };
  }

  async verifyTotp(
    accessToken: string,
    factorId: string,
    challengeId: string,
    code: string,
  ): Promise<void> {
    const { authUrl, apiKey } = resolveSupabaseAuthConfig();
    const response = await fetch(`${authUrl}/factors/${encodeURIComponent(factorId)}/verify`, {
      method: "POST",
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ challenge_id: challengeId, code }),
    });
    if (!response.ok) {
      throw new SecurityServiceError(await readAuthError(response), response.status, "totp_verify_failed");
    }
  }

  async unenrollTotp(accessToken: string, factorId: string): Promise<void> {
    const { authUrl, apiKey } = resolveSupabaseAuthConfig();
    const response = await fetch(`${authUrl}/factors/${encodeURIComponent(factorId)}`, {
      method: "DELETE",
      headers: { apikey: apiKey, Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok && response.status !== 404) {
      throw new SecurityServiceError(await readAuthError(response), response.status, "totp_unenroll_failed");
    }
  }

  async listFactors(accessToken: string): Promise<Array<{ id: string; type: "totp" | "phone"; status: "verified" | "unverified" }>> {
    const { authUrl, apiKey } = resolveSupabaseAuthConfig();
    const response = await fetch(`${authUrl}/factors`, {
      headers: { apikey: apiKey, Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      throw new SecurityServiceError(await readAuthError(response), response.status, "totp_list_failed");
    }
    const payload = (await response.json()) as {
      factors?: Array<{ id: string; factor_type: string; status: string }>;
    };
    return (payload.factors ?? [])
      .filter((f) => f.factor_type === "totp" || f.factor_type === "phone")
      .map((f) => ({
        id: f.id,
        type: f.factor_type as "totp" | "phone",
        status: f.status === "verified" ? "verified" : "unverified",
      }));
  }
}
