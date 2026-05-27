/**
 * StepDebugger — HEL-214 Pro reveal mounted on the Routines / Studio
 * (WorkflowBuilder) surface.
 *
 * Pro users can run a routine in paused mode, inspect every step's IO,
 * mutate a step's output, and resume. Plumbing goes through
 * `POST /api/routines/:id/debug-run`. The scaffold returns a synthetic
 * three-step trace so the UI can be reviewed end-to-end.
 */
import { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { proPost } from "./proApi";

interface DebugStep {
  index: number;
  name: string;
  input: unknown;
  output: unknown;
  status: "ok" | "paused" | "failed";
}

interface DebugRunResponse {
  runId: string;
  steps: DebugStep[];
}

interface StepDebuggerProps {
  routineId?: string | null;
}

export function StepDebugger({ routineId }: StepDebuggerProps) {
  const { getAccessToken } = useAuth();
  const [id, setId] = useState(routineId ?? "");
  const [run, setRun] = useState<DebugRunResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");

  async function handleStart() {
    setBusy(true);
    setError(null);
    setRun(null);
    try {
      if (!id.trim()) throw new Error("Routine id is required.");
      const token = await getAccessToken();
      const data = await proPost<DebugRunResponse>(
        `/routines/${encodeURIComponent(id.trim())}/debug-run`,
        { mode: "paused" },
        token,
      );
      setRun(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Debug run failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleResume(stepIdx: number) {
    if (!run) return;
    setBusy(true);
    setError(null);
    try {
      let mutated: unknown = run.steps[stepIdx]?.output;
      if (editingIdx === stepIdx) {
        try {
          mutated = JSON.parse(editDraft);
        } catch {
          throw new Error("Edited output must be valid JSON.");
        }
      }
      const token = await getAccessToken();
      const data = await proPost<DebugRunResponse>(
        `/routines/${encodeURIComponent(id.trim())}/debug-run`,
        { mode: "resume", runId: run.runId, stepIndex: stepIdx, output: mutated },
        token,
      );
      setRun(data);
      setEditingIdx(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Resume failed");
    } finally {
      setBusy(false);
    }
  }

  function startEdit(idx: number, output: unknown) {
    setEditingIdx(idx);
    setEditDraft(JSON.stringify(output, null, 2));
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <label style={{ display: "grid", gap: 4 }}>
        <span style={{ fontSize: 11, color: "var(--af2-ink-3)" }}>
          Routine id
        </span>
        <input
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder="rt_..."
          className="af2-input"
          style={{
            padding: "6px 8px",
            fontSize: 13,
            fontFamily: "var(--af2-font-mono, ui-monospace, monospace)",
          }}
        />
      </label>
      <div>
        <button
          type="button"
          onClick={() => void handleStart()}
          disabled={busy}
          className="af2-btn af2-btn-sm af2-btn-primary"
        >
          {busy ? "Running..." : "Start paused run"}
        </button>
      </div>
      {error ? (
        <div style={{ color: "var(--af2-clay-2)", fontSize: 12 }}>{error}</div>
      ) : null}
      {run ? (
        <div style={{ display: "grid", gap: 8 }}>
          {run.steps.map((step) => (
            <div
              key={step.index}
              style={{
                border: "1px solid var(--af2-line)",
                borderRadius: 6,
                padding: 10,
                background: "var(--af2-paper)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 6,
                  fontSize: 13,
                }}
              >
                <strong>
                  #{step.index} {step.name}
                </strong>
                <span
                  style={{
                    fontSize: 11,
                    padding: "1px 6px",
                    borderRadius: 999,
                    background:
                      step.status === "paused"
                        ? "var(--af2-mustard-soft, rgba(212,168,73,0.18))"
                        : "var(--af2-paper-2)",
                    color: "var(--af2-ink-3)",
                  }}
                >
                  {step.status}
                </span>
                <span style={{ flex: 1 }} />
                {step.status === "paused" ? (
                  <>
                    <button
                      type="button"
                      onClick={() => startEdit(step.index, step.output)}
                      className="af2-btn af2-btn-sm"
                    >
                      Edit output
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleResume(step.index)}
                      disabled={busy}
                      className="af2-btn af2-btn-sm af2-btn-primary"
                    >
                      Resume
                    </button>
                  </>
                ) : null}
              </div>
              <div style={{ fontSize: 11, color: "var(--af2-ink-3)" }}>
                Input
              </div>
              <pre
                style={{
                  fontSize: 11,
                  margin: "2px 0 6px",
                  maxHeight: 120,
                  overflow: "auto",
                }}
              >
                {JSON.stringify(step.input, null, 2)}
              </pre>
              <div style={{ fontSize: 11, color: "var(--af2-ink-3)" }}>
                Output
              </div>
              {editingIdx === step.index ? (
                <textarea
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                  rows={6}
                  spellCheck={false}
                  style={{
                    width: "100%",
                    fontFamily: "var(--af2-font-mono, ui-monospace, monospace)",
                    fontSize: 11,
                    padding: 6,
                  }}
                />
              ) : (
                <pre
                  style={{
                    fontSize: 11,
                    margin: "2px 0 0",
                    maxHeight: 120,
                    overflow: "auto",
                  }}
                >
                  {JSON.stringify(step.output, null, 2)}
                </pre>
              )}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default StepDebugger;
