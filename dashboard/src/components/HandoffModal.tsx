/**
 * HandoffModal (Wave 5) — small inline modal that lets the owner
 * "hand off" a one-off task to a specific agent. Backend creates a
 * mission_assignment ticket assigned to the agent.
 *
 * Form: title (required), description (optional), priority (default
 * "medium"), due date (optional). On submit, calls handoffToAgent;
 * on success, closes and fires the onHandedOff callback so the
 * caller can show a toast and/or navigate to the new ticket.
 */

import { useState } from "react";
import { Loader2, Send, X } from "lucide-react";
import {
  handoffToAgent,
  type AgentActionResult,
} from "../api/agentActionsApi";
import { useAuth } from "../context/AuthContext";

interface Props {
  agentId: string;
  agentName: string;
  open: boolean;
  onClose: () => void;
  onHandedOff: (result: AgentActionResult) => void;
}

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 2000;

const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
type Priority = (typeof PRIORITIES)[number];

export function HandoffModal({
  agentId,
  agentName,
  open,
  onClose,
  onHandedOff,
}: Props) {
  const { requireAccessToken } = useAuth();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [dueDate, setDueDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const canSubmit = title.trim().length > 0 && !submitting;

  async function handleSubmit(): Promise<void> {
    setSubmitting(true);
    setError(null);
    try {
      const token = await requireAccessToken();
      const result = await handoffToAgent(
        agentId,
        {
          title: title.trim(),
          description: description.trim() || undefined,
          priority,
          // Server expects ISO 8601 — convert from datetime-local
          // (which is in the user's local zone) to UTC ISO.
          dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
        },
        token,
      );
      onHandedOff(result);
      reset();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Hand-off failed");
    } finally {
      setSubmitting(false);
    }
  }

  function reset(): void {
    setTitle("");
    setDescription("");
    setPriority("medium");
    setDueDate("");
    setError(null);
  }

  function close(): void {
    if (submitting) return;
    reset();
    onClose();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Hand off a task to ${agentName}`}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.45)",
        padding: 16,
      }}
    >
      <button
        type="button"
        onClick={close}
        aria-label="Close hand-off modal"
        style={{
          position: "absolute",
          inset: 0,
          background: "transparent",
          border: "none",
          cursor: submitting ? "wait" : "pointer",
        }}
      />
      <div
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 560,
          maxHeight: "92vh",
          overflowY: "auto",
          background: "var(--af2-card, #fff)",
          borderRadius: 16,
          padding: 24,
          boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            marginBottom: 16,
          }}
        >
          <div>
            <h2
              className="af2-h2 font-af2-serif"
              style={{ fontSize: 20, margin: 0 }}
            >
              Hand off to {agentName}
            </h2>
            <p
              className="af2-muted"
              style={{ marginTop: 6, fontSize: 13, lineHeight: 1.5 }}
            >
              Create a mission assignment for {agentName} to pick up on the
              next cycle.
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            disabled={submitting}
            aria-label="Close"
            style={{
              border: "none",
              background: "transparent",
              padding: 6,
              cursor: submitting ? "wait" : "pointer",
              color: "var(--af2-muted)",
            }}
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ display: "grid", gap: 14 }}>
          <label style={{ display: "block" }}>
            <span
              className="af2-eyebrow"
              style={{ display: "block", marginBottom: 6 }}
            >
              Title
            </span>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value.slice(0, TITLE_MAX))}
              disabled={submitting}
              placeholder="e.g. Triage the latest support escalation"
              style={fieldStyle}
            />
          </label>

          <label style={{ display: "block" }}>
            <span
              className="af2-eyebrow"
              style={{ display: "block", marginBottom: 6 }}
            >
              Description{" "}
              <span className="af2-muted" style={{ fontWeight: 400, fontSize: 12 }}>
                (optional)
              </span>
            </span>
            <textarea
              value={description}
              onChange={(e) =>
                setDescription(e.target.value.slice(0, DESCRIPTION_MAX))
              }
              disabled={submitting}
              rows={4}
              placeholder="Context, expected output, any blockers to watch for."
              style={{ ...fieldStyle, fontFamily: "var(--af2-serif, ui-serif, Georgia, serif)" }}
            />
          </label>

          <div
            style={{
              display: "grid",
              gap: 14,
              gridTemplateColumns: "1fr 1fr",
            }}
          >
            <label style={{ display: "block" }}>
              <span
                className="af2-eyebrow"
                style={{ display: "block", marginBottom: 6 }}
              >
                Priority
              </span>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as Priority)}
                disabled={submitting}
                style={fieldStyle}
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "block" }}>
              <span
                className="af2-eyebrow"
                style={{ display: "block", marginBottom: 6 }}
              >
                Due date{" "}
                <span className="af2-muted" style={{ fontWeight: 400, fontSize: 12 }}>
                  (optional)
                </span>
              </span>
              <input
                type="datetime-local"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                disabled={submitting}
                style={fieldStyle}
              />
            </label>
          </div>
        </div>

        {error ? (
          <div
            role="alert"
            style={{
              marginTop: 14,
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid rgba(192,84,76,0.30)",
              background: "rgba(192,84,76,0.10)",
              color: "var(--af2-clay)",
              fontSize: 13,
            }}
          >
            {error}
          </div>
        ) : null}

        <div
          style={{
            marginTop: 18,
            display: "flex",
            justifyContent: "flex-end",
            gap: 10,
          }}
        >
          <button
            type="button"
            onClick={close}
            disabled={submitting}
            className="af2-btn af2-btn-ghost"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
            className="af2-btn af2-btn-clay"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              opacity: !canSubmit ? 0.6 : 1,
              cursor: !canSubmit ? "not-allowed" : "pointer",
            }}
          >
            {submitting ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Send size={14} />
            )}
            {submitting ? "Sending…" : `Hand off to ${agentName} →`}
          </button>
        </div>
      </div>
    </div>
  );
}

const fieldStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  fontSize: 14,
  border: "1px solid var(--af2-line)",
  borderRadius: 6,
  background: "var(--af2-paper-2)",
  color: "var(--af2-ink)",
};
