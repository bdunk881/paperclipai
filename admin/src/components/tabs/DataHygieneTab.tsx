import { apiRequest } from "../../lib/apiClient";
import { ReasonPrompt } from "../ReasonPrompt";

export function DataHygieneTab({ userId }: { userId: string }) {
  return (
    <div className="card">
      <h2>Data hygiene</h2>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        <li className="field">
          <strong>GDPR export.</strong>
          <p className="muted">Queues an async job. User receives a signed download link by email.</p>
          <ReasonPrompt
            label="Queue export"
            onConfirm={(reason) =>
              apiRequest(`/api/admin-console/data-hygiene/${userId}/export`, {
                method: "POST",
                body: { reason },
              })
            }
          />
        </li>
        <li className="field">
          <strong>Anonymize.</strong>
          <p className="muted">PII scrub: display name to "Deleted User", profile data nullified.</p>
          <ReasonPrompt
            label="Anonymize"
            className="danger"
            onConfirm={(reason) =>
              apiRequest(`/api/admin-console/data-hygiene/${userId}/anonymize`, {
                method: "POST",
                body: { reason },
              })
            }
          />
        </li>
        <li className="field">
          <strong>Right-to-erasure.</strong>
          <p className="muted">
            Queues a delete that requires a different admin to confirm within 5 minutes. Hard delete in 30
            days. Audit log entries are exempt from the cascade.
          </p>
          <ReasonPrompt
            label="Queue erasure (2-person)"
            className="danger"
            onConfirm={(reason) =>
              apiRequest(`/api/admin-console/data-hygiene/${userId}/erasure`, {
                method: "POST",
                body: { reason },
              })
            }
          />
        </li>
      </ul>
    </div>
  );
}
