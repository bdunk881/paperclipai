import { Link } from "react-router-dom";
import { MfaSettingsCard } from "./security/MfaSettingsCard";

export function SettingsPage() {
  return (
    <>
      <h1 style={{ fontSize: "1.3rem", marginBottom: "1rem" }}>Settings</h1>
      <MfaSettingsCard />
      <div className="card">
        <h2>Agent webhooks</h2>
        <p className="muted">
          Configure outbound webhooks that power the "Ask agent" buttons across the Infra
          dashboard. No API keys leave AutoFlow — your receiver (Slack, n8n, Zapier, internal
          agent) owns the response.
        </p>
        <Link to="/settings/agent-webhooks">Manage agent webhooks →</Link>
      </div>
      <div className="card">
        <h2>Platform admins</h2>
        <p className="muted">
          List the accounts with platform-admin access and revoke grants when staff offboard.
          Granting new admins is intentionally <strong>not</strong> available from this UI —
          it happens out-of-band so a compromised dashboard cannot elevate accounts. Revokes
          require a passkey step-up.
        </p>
        <Link to="/settings/platform-admins">Manage platform admins →</Link>
      </div>
    </>
  );
}
