/**
 * MFA enrollment wizard route (HEL-mfa, refactored in HEL-281).
 *
 * Mounted at /onboarding/mfa as a deep-link fallback. The default
 * post-signin enrollment surface is now the global
 * `<MfaEnrollmentSheet>` overlay — this page is only reached by:
 *   - Users who deliberately navigate to /onboarding/mfa.
 *   - SecuritySettings' "Set up MFA now" / "Add a passkey" CTAs.
 *
 * The step machine itself lives in `auth/MfaEnrollmentFlow` so the
 * sheet and the page share the same logic.
 */

import { useLocation, useNavigate } from "react-router-dom";
import { Af2Page, Af2PageHead } from "../components/af2";
import { MfaEnrollmentFlow } from "../auth/MfaEnrollmentFlow";

interface LocationState {
  from?: string;
}

export default function MfaEnrollmentWizard() {
  const navigate = useNavigate();
  const location = useLocation();
  const fromUrl = (location.state as LocationState | null)?.from ?? "/";

  return (
    <Af2Page>
      <Af2PageHead
        eyebrow="Account · Security"
        title="Set up two-factor authentication"
        subtitle="AutoFlow protects every account with a phish-resistant second factor. Use a passkey (recommended) or an authenticator app, then save your recovery codes."
      />
      <MfaEnrollmentFlow onComplete={() => navigate(fromUrl, { replace: true })} />
    </Af2Page>
  );
}
