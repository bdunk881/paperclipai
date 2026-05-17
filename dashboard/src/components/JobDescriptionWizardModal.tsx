/**
 * JobDescriptionWizardModal (Wave 3) — four plain-English questions
 * that turn into a markdown Job Description draft via the LLM.
 *
 * UX rules:
 *   - Three questions are required (mission, decisions, asks). The
 *     fourth (hardRules) is optional.
 *   - Submit is gated until the three required answers have ≥1 char.
 *   - On submit, calls the wizard via api/instructionsApi. On success,
 *     the parent receives the drafted body and the modal closes.
 *   - On failure, surfaces the backend error verbatim (which includes
 *     provider/model on LLM_FAILED).
 *   - Cancel closes without invoking the backend.
 */

import { useState } from "react";
import { Loader2, Sparkles, X } from "lucide-react";
import {
  draftAgentJobDescription,
  type DraftedJobDescription,
  type JobDescriptionAnswers,
} from "../api/instructionsApi";
import { useAuth } from "../context/AuthContext";

interface Props {
  agentId: string;
  agentName: string;
  open: boolean;
  onClose: () => void;
  onDrafted: (draft: DraftedJobDescription) => void;
}

const EMPTY: JobDescriptionAnswers = {
  mission: "",
  decisions: "",
  asks: "",
  hardRules: "",
};

const ANSWER_MAX = 500;

export function JobDescriptionWizardModal({
  agentId,
  agentName,
  open,
  onClose,
  onDrafted,
}: Props) {
  const { requireAccessToken } = useAuth();
  const [answers, setAnswers] = useState<JobDescriptionAnswers>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const canSubmit =
    answers.mission.trim().length > 0 &&
    answers.decisions.trim().length > 0 &&
    answers.asks.trim().length > 0 &&
    !submitting;

  function updateAnswer<K extends keyof JobDescriptionAnswers>(
    key: K,
    value: string,
  ): void {
    setAnswers((current) => ({ ...current, [key]: value.slice(0, ANSWER_MAX) }));
  }

  async function handleSubmit(): Promise<void> {
    setSubmitting(true);
    setError(null);
    try {
      const token = await requireAccessToken();
      const draft = await draftAgentJobDescription(agentId, answers, token);
      onDrafted(draft);
      setAnswers(EMPTY);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Wizard call failed");
    } finally {
      setSubmitting(false);
    }
  }

  function close(): void {
    if (submitting) return;
    setError(null);
    onClose();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Job description wizard for ${agentName}`}
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
        aria-label="Close wizard"
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
          maxWidth: 640,
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
              style={{
                fontSize: 22,
                margin: 0,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <Sparkles size={18} style={{ color: "var(--af2-sage)" }} />
              Let's write {agentName}'s job description.
            </h2>
            <p
              className="af2-muted"
              style={{ marginTop: 6, fontSize: 13, lineHeight: 1.5 }}
            >
              I'll ask four short questions and draft the document for you. You
              can edit anything before saving.
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            disabled={submitting}
            aria-label="Close wizard"
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

        <div style={{ display: "grid", gap: 18 }}>
          <WizardQuestion
            label="1. In one or two sentences, what's their main job?"
            value={answers.mission}
            onChange={(v) => updateAnswer("mission", v)}
            disabled={submitting}
            placeholder="e.g. Keep our biggest customers happy and renewing."
          />
          <WizardQuestion
            label="2. How should they make decisions when you're not around?"
            value={answers.decisions}
            onChange={(v) => updateAnswer("decisions", v)}
            disabled={submitting}
            placeholder="e.g. If a customer's health drops, reach out same-day."
          />
          <WizardQuestion
            label="3. What should they always ask you before doing?"
            value={answers.asks}
            onChange={(v) => updateAnswer("asks", v)}
            disabled={submitting}
            placeholder="e.g. Anything involving pricing, contracts, or refunds."
          />
          <WizardQuestion
            label="4. Anything they should never do?"
            optional
            value={answers.hardRules ?? ""}
            onChange={(v) => updateAnswer("hardRules", v)}
            disabled={submitting}
            placeholder="e.g. Never offer a discount without my approval."
          />
        </div>

        {error ? (
          <div
            role="alert"
            style={{
              marginTop: 16,
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
            marginTop: 20,
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
            {submitting ? <Loader2 size={14} className="animate-spin" /> : null}
            {submitting ? "Drafting…" : `Draft ${agentName}'s JD →`}
          </button>
        </div>
      </div>
    </div>
  );
}

interface WizardQuestionProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  optional?: boolean;
  placeholder?: string;
}

function WizardQuestion({
  label,
  value,
  onChange,
  disabled,
  optional,
  placeholder,
}: WizardQuestionProps) {
  return (
    <label style={{ display: "block" }}>
      <span
        style={{
          display: "block",
          fontSize: 13,
          fontWeight: 600,
          color: "var(--af2-ink-2)",
          marginBottom: 6,
        }}
      >
        {label}{" "}
        {optional ? (
          <span className="af2-muted" style={{ fontWeight: 400, fontSize: 12 }}>
            (optional)
          </span>
        ) : null}
      </span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        rows={2}
        placeholder={placeholder}
        maxLength={ANSWER_MAX}
        style={{
          width: "100%",
          padding: "8px 10px",
          fontSize: 14,
          fontFamily: "var(--af2-serif, ui-serif, Georgia, serif)",
          border: "1px solid var(--af2-line)",
          borderRadius: 6,
          background: "var(--af2-paper-2, #fafafa)",
          color: "var(--af2-ink)",
          resize: "vertical",
        }}
      />
    </label>
  );
}
