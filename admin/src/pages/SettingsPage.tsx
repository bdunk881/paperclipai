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
    </>
  );
}
