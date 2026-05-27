import { useState } from "react";
import { apiRequest } from "../../lib/apiClient";

export function BillingTab({
  userId,
}: {
  userId: string;
  workspaces: Array<{ workspace_id: string; name: string }>;
}) {
  const [chargeId, setChargeId] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [out, setOut] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submitRefund() {
    setBusy(true);
    setError(null);
    setOut(null);
    try {
      const body: Record<string, unknown> = { charge_id: chargeId.trim(), reason: reason.trim() };
      if (amount.trim()) body.amount_cents = Math.round(Number(amount) * 100);
      body.target_user_id = userId;
      const r = await apiRequest("/api/admin-console/billing/refund", {
        method: "POST",
        body,
      });
      setOut(r);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>Refund</h2>
      <p className="muted">Hard-capped at $100/transaction without second-admin approval.</p>
      <div className="field">
        <label>Stripe charge ID (ch_… or py_…)</label>
        <input value={chargeId} onChange={(e) => setChargeId(e.target.value)} placeholder="ch_…" />
      </div>
      <div className="field">
        <label>Amount (USD, leave blank for full)</label>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="20.00" />
      </div>
      <div className="field">
        <label>Reason</label>
        <input value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <button
        className="danger"
        disabled={busy || !chargeId.trim() || !reason.trim()}
        onClick={submitRefund}
      >
        Issue refund
      </button>
      {out !== null && (
        <pre className="card" style={{ marginTop: "1rem" }}>
          {JSON.stringify(out, null, 2)}
        </pre>
      )}
      {error && (
        <div className="banner danger" style={{ marginTop: "1rem" }}>
          {error}
        </div>
      )}
    </div>
  );
}
