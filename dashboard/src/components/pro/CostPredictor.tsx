/**
 * CostPredictor — HEL-214 Pro reveal mounted on Budget Dashboard.
 *
 * Pro users can sketch a hypothetical mission and get a cost range back
 * from `POST /api/budgets/predict`. The scaffold endpoint returns a
 * static range so the UI plumbing is fully wired before the real
 * estimator lands.
 */
import { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { proPost } from "./proApi";

interface PredictResponse {
  lowCents: number;
  midCents: number;
  highCents: number;
  notes?: string;
}

function fmtCents(c: number): string {
  return `$${(c / 100).toFixed(2)}`;
}

export function CostPredictor() {
  const { getAccessToken } = useAuth();
  const [statement, setStatement] = useState("Launch a paid-search funnel for our new SKU.");
  const [agents, setAgents] = useState(3);
  const [durationDays, setDurationDays] = useState(14);
  const [result, setResult] = useState<PredictResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handlePredict() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const token = await getAccessToken();
      const data = await proPost<PredictResponse>(
        "/budgets/predict",
        { statement, agents, durationDays },
        token,
      );
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Predict failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <label style={{ display: "grid", gap: 4 }}>
        <span style={{ fontSize: 11, color: "var(--af2-ink-3)" }}>
          Mission statement
        </span>
        <textarea
          value={statement}
          onChange={(e) => setStatement(e.target.value)}
          rows={3}
          style={{
            fontSize: 13,
            padding: 8,
            border: "1px solid var(--af2-line)",
            borderRadius: 6,
            background: "var(--af2-paper)",
          }}
        />
      </label>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <label style={{ display: "grid", gap: 4 }}>
          <span style={{ fontSize: 11, color: "var(--af2-ink-3)" }}>
            # agents
          </span>
          <input
            type="number"
            min={1}
            value={agents}
            onChange={(e) => setAgents(Math.max(1, Number(e.target.value) || 1))}
            className="af2-input"
            style={{ padding: "6px 8px", fontSize: 13, width: 80 }}
          />
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span style={{ fontSize: 11, color: "var(--af2-ink-3)" }}>
            Duration (days)
          </span>
          <input
            type="number"
            min={1}
            value={durationDays}
            onChange={(e) =>
              setDurationDays(Math.max(1, Number(e.target.value) || 1))
            }
            className="af2-input"
            style={{ padding: "6px 8px", fontSize: 13, width: 100 }}
          />
        </label>
      </div>
      <div>
        <button
          type="button"
          onClick={() => void handlePredict()}
          disabled={busy}
          className="af2-btn af2-btn-sm af2-btn-primary"
        >
          {busy ? "Predicting..." : "Predict"}
        </button>
      </div>
      {error ? (
        <div style={{ color: "var(--af2-clay-2)", fontSize: 12 }}>{error}</div>
      ) : null}
      {result ? (
        <div
          style={{
            display: "flex",
            gap: 16,
            padding: 10,
            border: "1px solid var(--af2-line)",
            borderRadius: 6,
            background: "var(--af2-paper)",
            fontSize: 13,
          }}
        >
          <div>
            <div style={{ fontSize: 11, color: "var(--af2-ink-3)" }}>Low</div>
            <div>{fmtCents(result.lowCents)}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "var(--af2-ink-3)" }}>Mid</div>
            <div>
              <strong>{fmtCents(result.midCents)}</strong>
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "var(--af2-ink-3)" }}>High</div>
            <div>{fmtCents(result.highCents)}</div>
          </div>
          {result.notes ? (
            <div
              style={{
                marginLeft: "auto",
                fontSize: 12,
                color: "var(--af2-ink-3)",
                maxWidth: 320,
              }}
            >
              {result.notes}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default CostPredictor;
