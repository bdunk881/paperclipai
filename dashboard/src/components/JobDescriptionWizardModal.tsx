/**
 * JobDescriptionWizardModal (UX-8 redesign).
 *
 * Wave 3 shipped this as 4 textareas with one-line labels. Owners had
 * no idea what a good answer looks like and the modal felt like an
 * "empty set of boxes" — same pattern as the original HandoffModal.
 *
 * This rebuild matches the new HandoffModal visual language:
 *   - Agent context header (avatar + name + presence pill).
 *   - "What's a Job description?" inline explainer.
 *   - Numbered question cards (1 of 4 / 2 of 4 …) so the wizard
 *     feels like a guided process, not a faceless form.
 *   - Each card has: question, helper text, sample answer in italic,
 *     textarea with a generous placeholder, char counter.
 *   - Progress strip at the top shows how many questions are filled.
 *   - "Use my answers to draft Aaron's JD →" footer CTA shows agent
 *     name so the button reads as the next concrete action.
 */

import { useMemo, useState } from "react";
import { Loader2, Sparkles, X } from "lucide-react";
import {
  draftAgentJobDescription,
  type DraftedJobDescription,
  type JobDescriptionAnswers,
} from "../api/instructionsApi";
import { useAuth } from "../context/AuthContext";
import { useAgentPresence } from "../hooks/useAgentPresence";
import { AgentPresencePill } from "./AgentPresencePill";

interface Props {
  agentId: string;
  agentName: string;
  open: boolean;
  onClose: () => void;
  onDrafted: (draft: DraftedJobDescription) => void;
}

const ANSWER_MAX = 500;

interface QuestionSpec {
  key: keyof JobDescriptionAnswers;
  label: string;
  hint: string;
  examples: string[];
  required: boolean;
}

const QUESTIONS: QuestionSpec[] = [
  {
    key: "mission",
    label: "What's their main job?",
    hint: "One or two sentences. The plainer the better.",
    examples: [
      "Keep our biggest customers happy and renewing.",
      "Triage every inbound bug report and route it to the right engineer.",
      "Run our outbound prospecting for net-new mid-market accounts.",
    ],
    required: true,
  },
  {
    key: "decisions",
    label: "How should they decide when you're not around?",
    hint: "Day-to-day calls they can make on their own.",
    examples: [
      "If a customer's health score drops, reach out same-day.",
      "Routine bug fixes can ship without review; anything customer-impacting waits for me.",
      "Send personalized intros for warm leads; cold lists go through the standard sequence.",
    ],
    required: true,
  },
  {
    key: "asks",
    label: "What should they always ask you first?",
    hint: "Decisions that need a human signoff.",
    examples: [
      "Anything involving pricing, contracts, or refunds.",
      "Public roadmap or PR statements — even if drafted internally.",
      "Spending more than $500 in a single action.",
    ],
    required: true,
  },
  {
    key: "hardRules",
    label: "Anything they should never do?",
    hint: "Hard rules. Lines you do not want crossed.",
    examples: [
      "Never offer a discount without my approval.",
      "Never email anyone tagged 'do not contact' in HubSpot.",
      "Never push code that touches the payment-processing path.",
    ],
    required: false,
  },
];

const EMPTY: JobDescriptionAnswers = {
  mission: "",
  decisions: "",
  asks: "",
  hardRules: "",
};

export function JobDescriptionWizardModal({
  agentId,
  agentName,
  open,
  onClose,
  onDrafted,
}: Props) {
  const { requireAccessToken } = useAuth();
  const presence = useAgentPresence();
  const live = presence.get(agentId);

  const [answers, setAnswers] = useState<JobDescriptionAnswers>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pin example per modal-open so the helper doesn't flicker on every
  // keystroke. Re-rolls when the modal re-opens (re-mounts the useMemo).
  const exampleByKey = useMemo(() => {
    const map: Partial<Record<keyof JobDescriptionAnswers, string>> = {};
    for (const q of QUESTIONS) {
      map[q.key] = q.examples[Math.floor(Math.random() * q.examples.length)];
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const requiredFilled = QUESTIONS.filter(
    (q) => q.required && (answers[q.key] ?? "").trim().length > 0,
  ).length;
  const requiredTotal = QUESTIONS.filter((q) => q.required).length;
  const totalFilled = QUESTIONS.filter(
    (q) => (answers[q.key] ?? "").trim().length > 0,
  ).length;

  const canSubmit = requiredFilled === requiredTotal && !submitting;

  function updateAnswer<K extends keyof JobDescriptionAnswers>(
    key: K,
    value: string,
  ): void {
    setAnswers((current) => ({
      ...current,
      [key]: value.slice(0, ANSWER_MAX),
    }));
  }

  function reset(): void {
    setAnswers(EMPTY);
    setError(null);
  }

  function close(): void {
    if (submitting) return;
    reset();
    onClose();
  }

  async function handleSubmit(): Promise<void> {
    setSubmitting(true);
    setError(null);
    try {
      const token = await requireAccessToken();
      const draft = await draftAgentJobDescription(agentId, answers, token);
      onDrafted(draft);
      reset();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Wizard call failed");
    } finally {
      setSubmitting(false);
    }
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
        background: "rgba(20, 22, 28, 0.55)",
        padding: 16,
        animation: "af2-jd-fade-in 160ms ease-out",
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
          maxWidth: 720,
          maxHeight: "92vh",
          overflowY: "auto",
          background: "var(--af2-card, #fff)",
          borderRadius: 16,
          boxShadow:
            "0 24px 60px rgba(0,0,0,0.30), 0 4px 12px rgba(0,0,0,0.10)",
          animation: "af2-jd-slide-up 200ms ease-out",
        }}
      >
        {/* Agent context header */}
        <header
          style={{
            padding: "18px 24px",
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            borderBottom: "1px solid var(--af2-line)",
            background:
              "linear-gradient(180deg, rgba(90,122,90,0.06), rgba(90,122,90,0.02))",
            display: "flex",
            alignItems: "center",
            gap: 14,
          }}
        >
          <div
            aria-hidden="true"
            style={{
              width: 44,
              height: 44,
              borderRadius: "50%",
              background: "var(--af2-sage-soft, rgba(90,122,90,0.12))",
              color: "var(--af2-sage)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 16,
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            <Sparkles size={20} />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              className="af2-eyebrow"
              style={{ color: "var(--af2-sage)" }}
            >
              Job description wizard
            </div>
            <h2
              className="af2-h2 font-af2-serif"
              style={{
                margin: 0,
                marginTop: 2,
                fontSize: 20,
                display: "flex",
                alignItems: "center",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              Let's write {agentName}'s job description
              <AgentPresencePill presence={live} />
            </h2>
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
              flexShrink: 0,
            }}
          >
            <X size={18} />
          </button>
        </header>

        {/* Explainer + progress dots */}
        <div
          style={{
            padding: "14px 24px",
            background: "var(--af2-paper-2, #fafafa)",
            borderBottom: "1px solid var(--af2-line)",
            display: "flex",
            alignItems: "center",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <div
            style={{
              color: "var(--af2-ink-2)",
              fontSize: 12.5,
              lineHeight: 1.55,
              flex: 1,
              minWidth: 280,
            }}
          >
            Four short questions. We'll turn your answers into a Mission /
            How they work / Hard rules document — you can edit anything
            before saving.
          </div>
          <ProgressDots
            filled={totalFilled}
            total={QUESTIONS.length}
            requiredFilled={requiredFilled}
            requiredTotal={requiredTotal}
          />
        </div>

        {/* Question cards */}
        <div style={{ padding: 24, display: "grid", gap: 16 }}>
          {QUESTIONS.map((q, index) => {
            const value = answers[q.key] ?? "";
            const filled = value.trim().length > 0;
            return (
              <QuestionCard
                key={q.key}
                index={index + 1}
                total={QUESTIONS.length}
                question={q}
                value={value}
                example={exampleByKey[q.key] ?? ""}
                filled={filled}
                disabled={submitting}
                onChange={(v) => updateAnswer(q.key, v)}
              />
            );
          })}
        </div>

        {error ? (
          <div
            role="alert"
            style={{
              margin: "0 24px 14px",
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

        <footer
          style={{
            padding: "14px 24px 18px",
            borderTop: "1px solid var(--af2-line)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <span className="af2-muted" style={{ fontSize: 11.5 }}>
            {requiredFilled}/{requiredTotal} required answers · 4th is optional
          </span>
          <div style={{ display: "flex", gap: 10 }}>
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
                opacity: !canSubmit ? 0.5 : 1,
                cursor: !canSubmit ? "not-allowed" : "pointer",
              }}
            >
              {submitting ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Sparkles size={14} />
              )}
              {submitting ? "Drafting…" : `Draft ${agentName}'s JD →`}
            </button>
          </div>
        </footer>
      </div>
      <KeyframeStyles />
    </div>
  );
}

// ---------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------

interface QuestionCardProps {
  index: number;
  total: number;
  question: QuestionSpec;
  value: string;
  example: string;
  filled: boolean;
  disabled: boolean;
  onChange: (v: string) => void;
}

function QuestionCard({
  index,
  total,
  question,
  value,
  example,
  filled,
  disabled,
  onChange,
}: QuestionCardProps) {
  return (
    <div
      className="af2-card"
      style={{
        padding: 16,
        borderColor: filled
          ? "rgba(90,122,90,0.25)"
          : "var(--af2-line)",
        background: filled ? "rgba(90,122,90,0.03)" : "var(--af2-card)",
        transition: "border-color 120ms, background 120ms",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 10,
          marginBottom: 6,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            minWidth: 26,
            height: 26,
            padding: "0 8px",
            borderRadius: 999,
            background: filled
              ? "var(--af2-sage)"
              : "var(--af2-paper-2)",
            color: filled ? "#fff" : "var(--af2-ink-3)",
            fontSize: 11,
            fontWeight: 700,
            fontFamily:
              "var(--af2-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
            flexShrink: 0,
          }}
        >
          {index} / {total}
        </span>
        <label
          htmlFor={`jd-q-${question.key}`}
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: "var(--af2-ink)",
            lineHeight: 1.4,
          }}
        >
          {question.label}{" "}
          {question.required ? null : (
            <span
              className="af2-muted"
              style={{ fontWeight: 400, fontSize: 12 }}
            >
              (optional)
            </span>
          )}
        </label>
      </div>
      <div
        className="af2-muted"
        style={{
          fontSize: 12,
          lineHeight: 1.5,
          marginBottom: 4,
          marginLeft: 36,
        }}
      >
        {question.hint}
      </div>
      {example ? (
        <div
          style={{
            fontSize: 12,
            color: "var(--af2-ink-3)",
            fontStyle: "italic",
            marginBottom: 10,
            marginLeft: 36,
            lineHeight: 1.5,
          }}
        >
          e.g. "{example}"
        </div>
      ) : null}
      <textarea
        id={`jd-q-${question.key}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        rows={2}
        maxLength={ANSWER_MAX}
        placeholder={example}
        style={{
          width: "100%",
          padding: "9px 11px",
          fontSize: 14,
          fontFamily: "var(--af2-serif, ui-serif, Georgia, serif)",
          border: "1px solid var(--af2-line)",
          borderRadius: 8,
          background: "var(--af2-card)",
          color: "var(--af2-ink)",
          resize: "vertical",
          outline: "none",
        }}
      />
      <div
        className="af2-mono af2-muted-2"
        style={{
          marginTop: 4,
          fontSize: 10.5,
          textAlign: "right",
        }}
      >
        {value.length} / {ANSWER_MAX}
      </div>
    </div>
  );
}

function ProgressDots({
  filled,
  total,
  requiredFilled,
  requiredTotal,
}: {
  filled: number;
  total: number;
  requiredFilled: number;
  requiredTotal: number;
}) {
  return (
    <div
      aria-label={`${filled} of ${total} answered, ${requiredFilled} of ${requiredTotal} required`}
      style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
    >
      {Array.from({ length: total }).map((_, i) => {
        const isFilled = i < filled;
        return (
          <span
            key={i}
            aria-hidden="true"
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: isFilled
                ? "var(--af2-sage)"
                : "var(--af2-line-2, #d4d4d4)",
              transition: "background 120ms",
            }}
          />
        );
      })}
    </div>
  );
}

// Keyframes injected once globally.
const KEYFRAME_STYLE_ID = "af2-jd-keyframes";

function KeyframeStyles() {
  if (typeof document !== "undefined" && !document.getElementById(KEYFRAME_STYLE_ID)) {
    const style = document.createElement("style");
    style.id = KEYFRAME_STYLE_ID;
    style.textContent = `
      @keyframes af2-jd-fade-in {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes af2-jd-slide-up {
        from { transform: translateY(8px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
    `;
    document.head.appendChild(style);
  }
  return null;
}
