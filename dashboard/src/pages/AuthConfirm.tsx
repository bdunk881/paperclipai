import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import type { EmailOtpType } from "@supabase/supabase-js";
import { writeStoredAuthUser } from "../auth/authStorage";
import {
  getSupabaseClient,
  mapSupabaseAuthError,
  sessionFromSupabaseSession,
} from "../auth/supabaseAuth";

const VALID_OTP_TYPES: ReadonlySet<EmailOtpType> = new Set<EmailOtpType>([
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
]);

function encodeErrorMessage(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, "+");
}

function sanitizeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) {
    return "/";
  }
  return raw;
}

function parseOtpType(raw: string | null): EmailOtpType | null {
  if (!raw) return null;
  return VALID_OTP_TYPES.has(raw as EmailOtpType) ? (raw as EmailOtpType) : null;
}

export default function AuthConfirm() {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  useEffect(() => {
    let cancelled = false;

    const fail = (message: string) => {
      navigate(`/login?authError=${encodeErrorMessage(message)}`, { replace: true });
    };

    const tokenHash = params.get("token_hash");
    const type = parseOtpType(params.get("type"));
    const next = sanitizeNext(params.get("next"));

    const client = getSupabaseClient();
    if (!client) {
      fail("Supabase auth is not configured for this dashboard environment.");
      return () => {
        cancelled = true;
      };
    }

    if (!tokenHash || !type) {
      fail("Confirmation link is invalid or expired.");
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      try {
        const { data, error } = await client.auth.verifyOtp({ token_hash: tokenHash, type });
        if (cancelled) return;

        if (error) {
          fail(mapSupabaseAuthError(error));
          return;
        }

        if (type === "recovery") {
          navigate("/reset-password", { replace: true });
          return;
        }

        if (data.session) {
          writeStoredAuthUser(sessionFromSupabaseSession(data.session).user);
        }

        navigate(next, { replace: true });
      } catch (verifyError) {
        if (cancelled) return;
        fail(mapSupabaseAuthError(verifyError));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [navigate, params]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-af2-paper px-6 text-af2-ink">
      <div className="flex items-center gap-3 rounded-md border border-af2-line bg-af2-card px-5 py-4 text-sm shadow-[0_18px_40px_rgba(26,20,16,0.08)]">
        <Loader2 size={18} className="animate-spin text-af2-clay" />
        <span className="font-af2-serif text-base text-af2-ink">Confirming your email…</span>
      </div>
    </div>
  );
}
