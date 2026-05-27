/**
 * PromptPreviewPane — HEL-214 Pro reveal mounted on the Hire surface.
 *
 * Live-previews the team-assembly normalizedGoalDocument as the user
 * iterates on goal pills. Re-implements the serialization shape from
 * `TeamAssemblyNormalizedGoalDocument` (see dashboard/src/api/client.ts:790)
 * so the user sees exactly what the server will receive.
 *
 * Two actions:
 *   - Copy: writes the rendered JSON to the clipboard.
 *   - Save as template: hits the scaffold `POST /api/hire/templates`
 *     endpoint (returns the doc back with an `id`) so the user can iterate
 *     on prompt templates outside of live missions.
 */
import { useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { proPost } from "./proApi";

interface PromptPreviewPaneProps {
  goal?: string;
  targetCustomer?: string | null;
  successMetrics?: string[];
  constraints?: string[];
  budget?: string | null;
  timeHorizon?: string | null;
}

export function PromptPreviewPane({
  goal = "",
  targetCustomer = null,
  successMetrics = [],
  constraints = [],
  budget = null,
  timeHorizon = null,
}: PromptPreviewPaneProps) {
  const { getAccessToken } = useAuth();
  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const doc = useMemo(
    () => ({
      sourceType: "hire_wizard",
      goal: goal.trim() || "(not set)",
      targetCustomer: targetCustomer?.trim() || null,
      successMetrics: successMetrics.filter((m) => m.trim()),
      constraints: constraints.filter((c) => c.trim()),
      budget: budget?.trim() || null,
      timeHorizon: timeHorizon?.trim() || null,
      planReadinessThreshold: 0.7,
    }),
    [goal, targetCustomer, successMetrics, constraints, budget, timeHorizon],
  );

  const json = useMemo(() => JSON.stringify(doc, null, 2), [doc]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Copy failed");
    }
  }

  async function handleSaveTemplate() {
    setBusy(true);
    setError(null);
    setSavedId(null);
    try {
      const token = await getAccessToken();
      const data = await proPost<{ id: string }>(
        "/hire/templates",
        { normalizedGoalDocument: doc },
        token,
      );
      setSavedId(data?.id ?? "template_saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <pre
        style={{
          fontSize: 12,
          background: "var(--af2-paper)",
          border: "1px solid var(--af2-line)",
          borderRadius: 6,
          padding: 10,
          overflow: "auto",
          maxHeight: 320,
        }}
      >
        {json}
      </pre>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="af2-btn af2-btn-sm"
        >
          {copied ? "Copied" : "Copy"}
        </button>
        <button
          type="button"
          onClick={() => void handleSaveTemplate()}
          disabled={busy}
          className="af2-btn af2-btn-sm af2-btn-primary"
        >
          {busy ? "Saving..." : "Save as template"}
        </button>
        {savedId ? (
          <span
            style={{
              fontSize: 12,
              color: "var(--af2-sage)",
              alignSelf: "center",
            }}
          >
            Saved as {savedId}
          </span>
        ) : null}
      </div>
      {error ? (
        <div style={{ color: "var(--af2-clay-2)", fontSize: 12 }}>{error}</div>
      ) : null}
    </div>
  );
}

export default PromptPreviewPane;
