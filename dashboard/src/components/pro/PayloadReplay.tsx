/**
 * PayloadReplay — HEL-214 Pro reveal mounted on Mission Assignments.
 *
 * Pro users can edit the latest assignment payload (JSON) and re-fire it
 * through `POST /api/mission-assignments/:id/replay`. The scaffold endpoint
 * returns 202 so the surface can be flipped to real replay later.
 *
 * Until per-assignment context wiring lands (parent surface passes the
 * assignment id), the component takes the id via prop with a `__draft__`
 * sentinel so the page mount can render without a selection.
 */
import { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { proPost } from "./proApi";

interface PayloadReplayProps {
  /** Mission assignment id; pass null/undefined to render in standalone mode. */
  assignmentId?: string | null;
  /** Optional seed payload — usually the latest assignment payload. */
  initialPayload?: unknown;
}

export function PayloadReplay({
  assignmentId,
  initialPayload,
}: PayloadReplayProps) {
  const { getAccessToken } = useAuth();
  const [id, setId] = useState(assignmentId ?? "");
  const [payload, setPayload] = useState(() =>
    JSON.stringify(
      initialPayload ?? {
        missionId: "msn_demo",
        agentId: "ag_demo",
        instructions: "Resend the welcome email",
      },
      null,
      2,
    ),
  );
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleReplay() {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(payload);
      } catch {
        throw new Error("Payload must be valid JSON.");
      }
      if (!id.trim()) {
        throw new Error("Assignment id is required.");
      }
      const token = await getAccessToken();
      const data = await proPost<{ status?: string; queued?: boolean }>(
        `/mission-assignments/${encodeURIComponent(id.trim())}/replay`,
        { payload: parsed },
        token,
      );
      setStatus(data?.status ?? "queued");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Replay failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <label style={{ display: "grid", gap: 4 }}>
        <span style={{ fontSize: 11, color: "var(--af2-ink-3)" }}>
          Assignment id
        </span>
        <input
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder="ma_..."
          className="af2-input"
          style={{
            padding: "6px 8px",
            fontSize: 13,
            fontFamily: "var(--af2-font-mono, ui-monospace, monospace)",
          }}
        />
      </label>
      <label style={{ display: "grid", gap: 4 }}>
        <span style={{ fontSize: 11, color: "var(--af2-ink-3)" }}>
          Payload (JSON)
        </span>
        <textarea
          value={payload}
          onChange={(e) => setPayload(e.target.value)}
          rows={10}
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
      <div>
        <button
          type="button"
          onClick={() => void handleReplay()}
          disabled={busy}
          className="af2-btn af2-btn-sm af2-btn-primary"
        >
          {busy ? "Replaying..." : "Replay"}
        </button>
      </div>
      {error ? (
        <div style={{ color: "var(--af2-clay-2)", fontSize: 12 }}>{error}</div>
      ) : null}
      {status ? (
        <div style={{ color: "var(--af2-sage)", fontSize: 12 }}>
          Replay {status}.
        </div>
      ) : null}
    </div>
  );
}

export default PayloadReplay;
