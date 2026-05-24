/**
 * RuleDebugger — HEL-214 Pro reveal mounted on the Approvals surface.
 *
 * Lets a power user pick an existing approval rule, paste a synthetic
 * payload, and dry-run it through `POST /api/approval-rules/test` to see
 * whether the rule would have fired and which clauses matched.
 *
 * Backend is scaffold-only — the route echoes a stub trace so the UI can
 * be styled and the action plumbed without waiting on real evaluator
 * wiring. Real implementation is tracked in HEL-214's follow-up.
 */
import { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { proPost } from "./proApi";

interface RuleTestResponse {
  wouldTrigger: boolean;
  trace: Array<{ clause: string; matched: boolean; reason?: string }>;
  echo?: unknown;
}

// Hard-coded for the scaffold — real list comes from /api/approval-policies.
const SAMPLE_RULES = [
  { id: "spend.over_threshold", label: "Spend > $50" },
  { id: "risk.tier.elevated", label: "Risk tier >= medium" },
  { id: "agent.external_tool", label: "Agent uses external tool" },
];

export function RuleDebugger() {
  const { getAccessToken } = useAuth();
  const [ruleId, setRuleId] = useState(SAMPLE_RULES[0]!.id);
  const [payload, setPayload] = useState(
    JSON.stringify(
      { agentId: "ag_123", action: "send_email", spendCents: 7500 },
      null,
      2,
    ),
  );
  const [result, setResult] = useState<RuleTestResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleTest() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(payload);
      } catch {
        throw new Error("Payload must be valid JSON.");
      }
      const token = await getAccessToken();
      const data = await proPost<RuleTestResponse>(
        "/approval-rules/test",
        { ruleId, payload: parsed },
        token,
      );
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Test failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <label style={{ display: "grid", gap: 4 }}>
        <span style={{ fontSize: 11, color: "var(--af2-ink-3)" }}>Rule</span>
        <select
          value={ruleId}
          onChange={(e) => setRuleId(e.target.value)}
          className="af2-input"
          style={{ padding: "6px 8px", fontSize: 13 }}
        >
          {SAMPLE_RULES.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      </label>
      <label style={{ display: "grid", gap: 4 }}>
        <span style={{ fontSize: 11, color: "var(--af2-ink-3)" }}>
          Synthetic payload (JSON)
        </span>
        <textarea
          value={payload}
          onChange={(e) => setPayload(e.target.value)}
          rows={8}
          spellCheck={false}
          style={{
            fontFamily: "var(--af2-font-mono, ui-monospace, monospace)",
            fontSize: 12,
            padding: 8,
            border: "1px solid var(--af2-line)",
            borderRadius: 6,
            background: "var(--af2-paper)",
          }}
        />
      </label>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={() => void handleTest()}
          disabled={busy}
          className="af2-btn af2-btn-sm af2-btn-primary"
        >
          {busy ? "Testing..." : "Test"}
        </button>
      </div>
      {error ? (
        <div style={{ color: "var(--af2-clay-2)", fontSize: 12 }}>{error}</div>
      ) : null}
      {result ? (
        <div
          style={{
            padding: 10,
            borderRadius: 6,
            background: "var(--af2-paper)",
            border: "1px solid var(--af2-line)",
            fontSize: 12,
          }}
        >
          <div style={{ marginBottom: 6 }}>
            Would trigger:{" "}
            <strong
              style={{
                color: result.wouldTrigger
                  ? "var(--af2-sage)"
                  : "var(--af2-ink-3)",
              }}
            >
              {result.wouldTrigger ? "YES" : "no"}
            </strong>
          </div>
          <ol style={{ paddingLeft: 18, margin: 0 }}>
            {result.trace.map((entry, idx) => (
              <li key={idx} style={{ marginBottom: 4 }}>
                <span
                  style={{
                    color: entry.matched
                      ? "var(--af2-sage)"
                      : "var(--af2-ink-3)",
                  }}
                >
                  {entry.matched ? "Y" : "."}
                </span>{" "}
                <code>{entry.clause}</code>
                {entry.reason ? (
                  <span style={{ color: "var(--af2-ink-3)" }}>
                    {" "}
                    — {entry.reason}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}

export default RuleDebugger;
