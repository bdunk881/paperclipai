/**
 * MFA enrollment wizard route (HEL-mfa; enforcement hardened in HEL-389).
 *
 * Mounted at /onboarding/mfa under `AuthOnlyRoute` (no `<Layout/>`). This is
 * the enforcement surface: `MfaEnforcementGate` hard-redirects any
 * authenticated user who requires app MFA but has no factor here, so the
 * dashboard (and its global Ctrl/⌘+K command palette) never mounts until
 * enrollment completes. Also reached by:
 *   - Users who deliberately navigate to /onboarding/mfa.
 *   - SecuritySettings' "Set up MFA now" / "Add a passkey" CTAs.
 *
 * On completion we navigate back to `state.from` (the route the gate
 * intercepted, defaulting to "/"). The step machine itself lives in
 * `auth/MfaEnrollmentFlow`.
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
        title="Secure your account"
        subtitle="AutoFlow secures every account with a phish-resistant key. Add a passkey (recommended) — your fingerprint, face, or device PIN — then save your recovery codes."
      />
      <MfaEnrollmentFlow onComplete={() => navigate(fromUrl, { replace: true })} />
    </Af2Page>
  );
}
