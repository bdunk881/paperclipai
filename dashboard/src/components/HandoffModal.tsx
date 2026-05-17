/**
 * HandoffModal (UX-8 redesign).
 *
 * Wave 5 shipped this as a basic 4-field form ("empty set of boxes")
 * which left owners staring at unlabeled inputs with no idea what
 * good answers look like. This rebuild:
 *
 *   - Header card: who we're handing off to, with their live presence
 *     pill so the owner sees "Aaron · idle · 3m" before assigning work
 *     (avoid handing critical work to a blocked / offline agent).
 *   - "What is a hand off?" mini-explainer up top (one sentence).
 *   - Question-style labels ("What needs to happen?" instead of
 *     "Title"), with concrete example placeholders that rotate per
 *     render so refreshing surfaces variety.
 *   - Chip-style priority selector with color codes (low → muted,
 *     medium → ink, high → mustard, urgent → clay) so the choice is
 *     visually weighted, not buried in a dropdown.
 *   - Optional due-date input lives in a quiet "Adjust schedule"
 *     section to reduce noise for the common case (no deadline).
 *   - Live preview pane shows the resulting mission assignment card
 *     in real time as the owner types so they see exactly what the
 *     agent will pick up.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarClock, Loader2, MessageSquareText, Send, Sparkles, Type, X } from "lucide-react";
import {
  classifyHandoffPriority,
  handoffToAgent,
  type AgentActionResult,
  type PrioritySuggestion,
} from "../api/agentActionsApi";
import { useAuth } from "../context/AuthContext";
import { useAgentPresence } from "../hooks/useAgentPresence";
import { AgentPresencePill } from "./AgentPresencePill";

interface Props {
  agentId: string;
  agentName: string;
  open: boolean;
  onClose: () => void;
  onHandedOff: (result: AgentActionResult) => void;
}

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 2000;

const PRIORITIES: Array<{
  value: "low" | "medium" | "high" | "urgent";
  label: string;
  tone: "muted" | "ink" | "mustard" | "clay";
  helper: string;
}> = [
  { value: "low", label: "Low", tone: "muted", helper: "Whenever — nice to have" },
  { value: "medium", label: "Medium", tone: "ink", helper: "Normal cycle" },
  { value: "high", label: "High", tone: "mustard", helper: "Front of the queue" },
  { value: "urgent", label: "Urgent", tone: "clay", helper: "Drop other work for this" },
];

const TITLE_EXAMPLES = [
  "Triage the latest support escalation",
  "Pull this week's churn-risk report and flag anything urgent",
  "Draft a follow-up email for the Acme renewal",
  "Audit our onboarding emails for the last 14 days",
  "Compile this month's KPI summary for the leadership call",
];

const DESCRIPTION_EXAMPLES = [
  "Pull the thread, summarize the customer's ask, decide whether we can fix it ourselves or need to bump it to engineering.",
  "Check the health-score dashboard. Anyone dropping below 60 in the last 7 days needs a same-day reach-out.",
  "Outline a one-page renewal pitch. Don't send — drop the draft in our shared doc and ping me.",
];

export function HandoffModal({
  agentId,
  agentName,
  open,
  onClose,
  onHandedOff,
}: Props) {
  const { requireAccessToken } = useAuth();
  const presence = useAgentPresence();
  const live = presence.get(agentId);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<typeof PRIORITIES[number]["value"]>(
    "medium",
  );
  const [dueDate, setDueDate] = useState("");
  const [showSchedule, setShowSchedule] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // DASH-15: lite-tier LLM priority suggestion. Fires on a debounce
  // after the user pauses typing. We track:
  //   - `suggestion`: the latest classifier result (or null)
  //   - `suggestionLoading`: true while a request is in flight
  //   - `userOverride`: true once the user manually picks a priority,
  //     so the suggestion never silently changes their choice
  //   - `suggestionDismissed`: true after explicit X-click, so the
  //     banner doesn't pop back up for the same draft
  const [suggestion, setSuggestion] = useState<PrioritySuggestion | null>(null);
  const [suggestionLoading, setSuggestionLoading] = useState(false);
  const [userOverride, setUserOverride] = useState(false);
  const [suggestionDismissed, setSuggestionDismissed] = useState(false);

  // Stable per-mount example so the placeholder doesn't churn on every
  // keystroke. Re-rolls when the modal opens via the `open` boolean.
  const titlePlaceholder = useMemo(
    () => pickRandom(TITLE_EXAMPLES),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open],
  );
  const descriptionPlaceholder = useMemo(
    () => pickRandom(DESCRIPTION_EXAMPLES),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open],
  );

  if (!open) return null;

  const canSubmit = title.trim().length > 0 && !submitting;
  const priorityChoice = PRIORITIES.find((p) => p.value === priority)!;
  const previewActive = title.trim().length > 0 || description.trim().length > 0;

  // Debounced classifier call. Re-fires whenever the trimmed title /
  // description changes; aborts in-flight requests on subsequent
  // edits so we don't race the response back onto an outdated draft.
  const classifyAbortRef = useRef<AbortController | null>(null);
  const trimmedTitle = title.trim();
  const trimmedDescription = description.trim();
  useEffect(() => {
    if (!open) return;
    if (trimmedTitle.length < 8) {
      setSuggestion(null);
      return;
    }
    const handle = window.setTimeout(() => {
      classifyAbortRef.current?.abort();
      const controller = new AbortController();
      classifyAbortRef.current = controller;
      setSuggestionLoading(true);
      void (async () => {
        try {
          const token = await requireAccessToken();
          const result = await classifyHandoffPriority(
            { title: trimmedTitle, description: trimmedDescription || undefined },
            token,
            controller.signal,
          );
          if (controller.signal.aborted) return;
          setSuggestion(result);
        } catch {
          if (!controller.signal.aborted) setSuggestion(null);
        } finally {
          if (!controller.signal.aborted) setSuggestionLoading(false);
        }
      })();
    }, 650);
    return () => window.clearTimeout(handle);
    // requireAccessToken is stable from useAuth; safe to omit per
    // existing patterns elsewhere in the dashboard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, trimmedTitle, trimmedDescription]);

  // Apply the suggestion automatically only when the user hasn't
  // already changed priority manually. Otherwise leave their choice
  // alone and let them tap "Use suggestion" to accept.
  useEffect(() => {
    if (
      suggestion &&
      !userOverride &&
      !suggestionDismissed &&
      suggestion.priority !== priority
    ) {
      setPriority(suggestion.priority);
    }
    // We intentionally don't depend on `priority` so the suggestion
    // doesn't get reapplied after a manual change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestion, userOverride, suggestionDismissed]);

  function reset(): void {
    setTitle("");
    setDescription("");
    setPriority("medium");
    setDueDate("");
    setShowSchedule(false);
    setError(null);
    setSuggestion(null);
    setSuggestionLoading(false);
    setUserOverride(false);
    setSuggestionDismissed(false);
    classifyAbortRef.current?.abort();
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
      const result = await handoffToAgent(
        agentId,
        {
          title: title.trim(),
          description: description.trim() || undefined,
          priority,
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
        background: "rgba(20, 22, 28, 0.55)",
        padding: 16,
        animation: "af2-handoff-fade-in 160ms ease-out",
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
          maxWidth: 680,
          maxHeight: "92vh",
          overflowY: "auto",
          background: "var(--af2-card, #fff)",
          borderRadius: 16,
          boxShadow:
            "0 24px 60px rgba(0,0,0,0.30), 0 4px 12px rgba(0,0,0,0.10)",
          animation: "af2-handoff-slide-up 200ms ease-out",
        }}
      >
        {/* Agent context header — colored band so the owner sees who
            this is going to + what state they're in before assigning. */}
        <header
          style={{
            padding: "18px 24px",
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            borderBottom: "1px solid var(--af2-line)",
            background:
              "linear-gradient(180deg, rgba(192,84,76,0.06), rgba(192,84,76,0.02))",
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
              background: "var(--af2-clay-soft)",
              color: "var(--af2-clay-2, var(--af2-clay))",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 16,
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            {initialsFor(agentName)}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              className="af2-eyebrow"
              style={{ color: "var(--af2-clay-2, var(--af2-clay))" }}
            >
              Hand off work
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
              {agentName}
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

        {/* Inline explainer so first-time users know what a hand-off
            actually is (vs check-in vs standing task). */}
        <div
          style={{
            padding: "12px 24px",
            background: "var(--af2-paper-2, #fafafa)",
            borderBottom: "1px solid var(--af2-line)",
            color: "var(--af2-ink-2)",
            fontSize: 12.5,
            lineHeight: 1.55,
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
          }}
        >
          <Sparkles
            size={13}
            style={{ marginTop: 2, color: "var(--af2-sage)", flexShrink: 0 }}
          />
          <span>
            Create a one-off task <strong>{agentName}</strong> picks up on the
            next cycle. Stays on their queue as a mission assignment until
            resolved.
          </span>
        </div>

        {/* Form body */}
        <div style={{ padding: 24, display: "grid", gap: 18 }}>
          <Field
            icon={Type}
            label="What needs to happen?"
            hint="One short sentence. Be concrete."
            counter={`${title.length} / ${TITLE_MAX}`}
          >
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value.slice(0, TITLE_MAX))}
              disabled={submitting}
              placeholder={titlePlaceholder}
              style={inputStyle}
            />
          </Field>

          <Field
            icon={MessageSquareText}
            label="Any context they should know? (optional)"
            hint="Background, expected output, blockers to watch for."
            counter={`${description.length} / ${DESCRIPTION_MAX}`}
          >
            <textarea
              value={description}
              onChange={(e) =>
                setDescription(e.target.value.slice(0, DESCRIPTION_MAX))
              }
              disabled={submitting}
              rows={4}
              placeholder={descriptionPlaceholder}
              style={{
                ...inputStyle,
                fontFamily: "var(--af2-serif, ui-serif, Georgia, serif)",
                resize: "vertical",
              }}
            />
          </Field>

          <Field icon={Sparkles} label="Priority">
            <div
              role="radiogroup"
              aria-label="Priority"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: 8,
              }}
            >
              {PRIORITIES.map((p) => {
                const selected = p.value === priority;
                const tone = toneStyles(p.tone);
                return (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    key={p.value}
                    onClick={() => {
                      setPriority(p.value);
                      // DASH-15: explicit click locks in the user's
                      // choice — the LLM suggestion will not override
                      // it for the rest of this modal session.
                      setUserOverride(true);
                    }}
                    disabled={submitting}
                    style={{
                      padding: "10px 12px",
                      border: selected
                        ? `1.5px solid ${tone.fg}`
                        : "1px solid var(--af2-line)",
                      borderRadius: 8,
                      background: selected ? tone.bg : "var(--af2-card)",
                      color: selected ? tone.fg : "var(--af2-ink)",
                      cursor: submitting ? "wait" : "pointer",
                      textAlign: "left",
                      transition: "border-color 100ms, background 100ms",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: selected ? 700 : 600,
                      }}
                    >
                      {p.label}
                    </div>
                    <div
                      className="af2-muted"
                      style={{ fontSize: 11, marginTop: 2 }}
                    >
                      {p.helper}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* DASH-15 suggestion banner. Only shows when:
                  - classifier returned a suggestion
                  - user hasn't dismissed it
                  - suggestion differs from the user's manual choice
                If the user already overrode, the banner offers a
                "Use suggestion" CTA so they can swap back. */}
            {suggestionLoading && trimmedTitle.length >= 8 ? (
              <div
                className="af2-muted-2"
                style={{
                  marginTop: 8,
                  fontSize: 11.5,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <Loader2 size={11} className="animate-spin" />
                Thinking…
              </div>
            ) : suggestion && !suggestionDismissed ? (
              <div
                role="status"
                style={{
                  marginTop: 8,
                  padding: "8px 10px",
                  borderRadius: 6,
                  border: "1px solid var(--af2-line)",
                  background: "var(--af2-paper-2)",
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                  fontSize: 12,
                  color: "var(--af2-ink-2)",
                  lineHeight: 1.45,
                }}
              >
                <Sparkles
                  size={12}
                  style={{
                    color: "var(--af2-sage)",
                    marginTop: 2,
                    flexShrink: 0,
                  }}
                />
                <span style={{ flex: 1, minWidth: 0 }}>
                  Suggested: <strong>{suggestion.priority}</strong>
                  {priority !== suggestion.priority ? (
                    <>
                      {" — "}
                      <button
                        type="button"
                        onClick={() => {
                          setPriority(suggestion.priority);
                          setUserOverride(false);
                        }}
                        style={{
                          background: "transparent",
                          border: "none",
                          padding: 0,
                          cursor: "pointer",
                          color: "var(--af2-clay)",
                          textDecoration: "underline",
                          font: "inherit",
                        }}
                      >
                        use suggestion
                      </button>
                    </>
                  ) : null}
                  <span
                    className="af2-muted"
                    style={{ display: "block", marginTop: 2 }}
                  >
                    {suggestion.reason}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => setSuggestionDismissed(true)}
                  aria-label="Dismiss suggestion"
                  style={{
                    background: "transparent",
                    border: "none",
                    padding: 2,
                    cursor: "pointer",
                    color: "var(--af2-muted)",
                    flexShrink: 0,
                  }}
                >
                  <X size={11} />
                </button>
              </div>
            ) : null}
          </Field>

          {/* Quiet "Adjust schedule" disclosure for the optional due date.
              Hidden by default so the common case (no deadline) stays
              clean. */}
          <div>
            {showSchedule ? (
              <Field
                icon={CalendarClock}
                label="Deadline"
                hint="In your local time. Stored as UTC on the assignment."
              >
                <input
                  type="datetime-local"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  disabled={submitting}
                  style={inputStyle}
                />
              </Field>
            ) : (
              <button
                type="button"
                onClick={() => setShowSchedule(true)}
                disabled={submitting}
                className="af2-btn af2-btn-sm af2-btn-ghost"
                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <CalendarClock size={12} />
                Add a deadline
              </button>
            )}
          </div>

          {/* Live preview of what the agent will see on their queue. */}
          {previewActive ? (
            <PreviewBlock
              agentName={agentName}
              title={title}
              description={description}
              priority={priorityChoice}
              dueDate={dueDate}
            />
          ) : null}
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
            Lands on <strong>{agentName}</strong>'s queue immediately.
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
                <Send size={14} />
              )}
              {submitting ? "Sending…" : `Hand off to ${agentName} →`}
            </button>
          </div>
        </footer>
      </div>
      <KeyframeStyles />
    </div>
  );
}

// ---------------------------------------------------------------------
// Sub-components — kept colocated so the modal stays one file.
// ---------------------------------------------------------------------

interface FieldProps {
  icon: React.ComponentType<{ size?: number | string }>;
  label: string;
  hint?: string;
  counter?: string;
  children: React.ReactNode;
}

function Field({ icon: Icon, label, hint, counter, children }: FieldProps) {
  return (
    <label style={{ display: "block" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 6,
        }}
      >
        <Icon size={13} />
        <span
          style={{
            fontSize: 12.5,
            fontWeight: 600,
            color: "var(--af2-ink)",
            flex: 1,
          }}
        >
          {label}
        </span>
        {counter ? (
          <span
            className="af2-mono af2-muted-2"
            style={{ fontSize: 11 }}
          >
            {counter}
          </span>
        ) : null}
      </div>
      {hint ? (
        <div className="af2-muted" style={{ fontSize: 11.5, marginBottom: 6 }}>
          {hint}
        </div>
      ) : null}
      {children}
    </label>
  );
}

function PreviewBlock({
  agentName,
  title,
  description,
  priority,
  dueDate,
}: {
  agentName: string;
  title: string;
  description: string;
  priority: typeof PRIORITIES[number];
  dueDate: string;
}) {
  const tone = toneStyles(priority.tone);
  return (
    <div>
      <div className="af2-eyebrow" style={{ marginBottom: 8 }}>
        What {agentName} will see on their queue
      </div>
      <div
        className="af2-card"
        style={{
          padding: 14,
          borderLeft: `3px solid ${tone.fg}`,
          background: "var(--af2-paper-2)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 11,
          }}
        >
          <span
            style={{
              padding: "1px 8px",
              borderRadius: 999,
              background: tone.bg,
              color: tone.fg,
              fontFamily:
                "var(--af2-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
              fontSize: 10.5,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            {priority.label} priority
          </span>
          {dueDate ? (
            <span className="af2-mono af2-muted-2" style={{ fontSize: 11 }}>
              · due {new Date(dueDate).toLocaleString()}
            </span>
          ) : null}
        </div>
        <p
          className="font-af2-serif"
          style={{
            margin: "10px 0 0",
            fontSize: 14,
            color: "var(--af2-ink)",
            fontWeight: 600,
            lineHeight: 1.4,
          }}
        >
          {title || <em style={{ color: "var(--af2-muted)" }}>(title)</em>}
        </p>
        {description ? (
          <p
            className="af2-muted"
            style={{
              margin: "6px 0 0",
              fontSize: 12.5,
              lineHeight: 1.55,
              whiteSpace: "pre-wrap",
            }}
          >
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Styling utilities
// ---------------------------------------------------------------------

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 11px",
  fontSize: 14,
  border: "1px solid var(--af2-line)",
  borderRadius: 8,
  background: "var(--af2-card)",
  color: "var(--af2-ink)",
  outline: "none",
};

function toneStyles(tone: "muted" | "ink" | "mustard" | "clay"): {
  fg: string;
  bg: string;
} {
  if (tone === "muted") {
    return { fg: "var(--af2-ink-3, #888)", bg: "rgba(0,0,0,0.04)" };
  }
  if (tone === "mustard") {
    return {
      fg: "var(--af2-mustard, #c08e3a)",
      bg: "rgba(192,142,58,0.10)",
    };
  }
  if (tone === "clay") {
    return {
      fg: "var(--af2-clay, #c0544c)",
      bg: "rgba(192,84,76,0.10)",
    };
  }
  return { fg: "var(--af2-ink, #222)", bg: "rgba(0,0,0,0.05)" };
}

function pickRandom<T>(arr: T[]): T {
  const i = Math.floor(Math.random() * arr.length);
  return arr[i] ?? arr[0]!;
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  if (parts.length === 0) return "··";
  return parts.map((p) => p[0] ?? "").join("").toUpperCase();
}

// Keyframes injected once globally. Cheaper than a CSS file for two rules.
const KEYFRAME_STYLE_ID = "af2-handoff-keyframes";

function KeyframeStyles() {
  if (typeof document !== "undefined" && !document.getElementById(KEYFRAME_STYLE_ID)) {
    const style = document.createElement("style");
    style.id = KEYFRAME_STYLE_ID;
    style.textContent = `
      @keyframes af2-handoff-fade-in {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes af2-handoff-slide-up {
        from { transform: translateY(8px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
    `;
    document.head.appendChild(style);
  }
  return null;
}
