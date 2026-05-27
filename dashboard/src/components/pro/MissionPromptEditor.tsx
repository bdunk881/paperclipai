/**
 * MissionPromptEditor — HEL-214 Pro reveal mounted on Mission State /
 * mission detail.
 *
 * Pro users can edit the team-assembly prompt that produced the current
 * mission and re-run it in a sandbox via
 * `POST /api/missions/:id/team-assembly/sandbox`. The scaffold endpoint
 * returns a stub plan so the UI plumbing can be reviewed without burning
 * LLM tokens.
 */
import { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { proPost } from "./proApi";

interface MissionPromptEditorProps {
  missionId?: string | null;
  initialPrompt?: string;
}

export function MissionPromptEditor({
  missionId,
  initialPrompt,
}: MissionPromptEditorProps) {
  const { getAccessToken } = useAuth();
  const [id, setId] = useState(missionId ?? "");
  const [prompt, setPrompt] = useState(
    initialPrompt ??
      "You are AutoFlow's team assembly planner. Build a minimal team that can deliver the mission below in two weeks.",
  );
  const [output, setOutput] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleRun() {
    setBusy(true);
    setError(null);
    setOutput(null);
    try {
      if (!id.trim()) throw new Error("Mission id is required.");
      const token = await getAccessToken();
      const data = await proPost<{ plan: unknown }>(
        `/missions/${encodeURIComponent(id.trim())}/team-assembly/sandbox`,
        { prompt },
        token,
      );
      setOutput(data?.plan ?? data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sandbox run failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <label style={{ display: "grid", gap: 4 }}>
        <span style={{ fontSize: 11, color: "var(--af2-ink-3)" }}>
          Mission id
        </span>
        <input
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder="msn_..."
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
          Team-assembly prompt
        </span>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={8}
          spellCheck={false}
          style={{
            fontSize: 13,
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
          onClick={() => void handleRun()}
          disabled={busy}
          className="af2-btn af2-btn-sm af2-btn-primary"
        >
          {busy ? "Running..." : "Re-run team assembly"}
        </button>
      </div>
      {error ? (
        <div style={{ color: "var(--af2-clay-2)", fontSize: 12 }}>{error}</div>
      ) : null}
      {output ? (
        <pre
          style={{
            fontSize: 12,
            background: "var(--af2-paper)",
            border: "1px solid var(--af2-line)",
            borderRadius: 6,
            padding: 10,
            overflow: "auto",
            maxHeight: 280,
          }}
        >
          {JSON.stringify(output, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}

export default MissionPromptEditor;
