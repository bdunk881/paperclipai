/**
 * AgentJobDescription page (Wave 3) — route: /agents/:agentId/job
 *
 * Loads the agent's current Job Description (most-recent
 * workspace_instructions row with kind='instruction' + agent_id),
 * renders it in either Sections mode (default — three named
 * textareas) or Raw markdown mode, and provides a "Help me write
 * this" wizard modal that drafts the body from four short answers.
 *
 * Save:
 *   - First save → POST /api/instructions (creates row at version 1)
 *   - Subsequent saves → PATCH /api/instructions/:id (bumps version)
 *
 * Empty state: when no instruction exists for the agent, the page
 * shows a single CTA to start the wizard (with a quieter "Start
 * blank" link below).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Loader2, Sparkles } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { ErrorState, LoadingState } from "../components/UiStates";
import { useToast } from "../components/ToastProvider";
import {
  draftAgentJobDescription as _draftUnused,
  listAgentInstructions,
  saveInstruction,
  type DraftedJobDescription,
  type Instruction,
} from "../api/instructionsApi";
import { listAgents, type Agent } from "../api/agentApi";
import {
  SectionEditor,
  type NamedSection,
} from "../components/SectionEditor";
import { JobDescriptionWizardModal } from "../components/JobDescriptionWizardModal";

// Silence the unused-import lint — keeping the explicit import path
// in the module's barrel for callers/tests that follow this one.
void _draftUnused;

type ViewMode = "sections" | "raw";

const SECTIONS: NamedSection[] = [
  {
    heading: "Mission",
    helperText: "What is this agent responsible for, in plain English?",
    placeholder:
      "e.g. Aaron leads customer success. He keeps our top accounts healthy and runs onboarding for every new enterprise customer.",
  },
  {
    heading: "How they work",
    helperText:
      "Day-to-day behavior: what they can decide on their own, when they should pause and ask you.",
    placeholder:
      "e.g. Aaron checks the customer dashboard every morning and flags any account with a dropping health score. Routine outreach is fine; pricing or contract questions come to me.",
  },
  {
    heading: "Hard rules",
    helperText:
      "Bright lines they should never cross. Spending limits, off-limits topics, sensitive accounts.",
    placeholder:
      "e.g. Never offer a discount. Never email an account I've marked 'do not contact'.",
  },
];

// Note: the "saved" state is gone — UX-7 surfaces save confirmation
// via the global toast system instead of an inline "✓ Saved just now"
// span.
type PageState = "loading" | "ready" | "saving" | "error";

export default function AgentJobDescription() {
  const { agentId } = useParams<{ agentId: string }>();
  const { requireAccessToken } = useAuth();
  const toast = useToast();

  const [agent, setAgent] = useState<Agent | null>(null);
  const [existing, setExisting] = useState<Instruction | null>(null);
  const [body, setBody] = useState("");
  const [view, setView] = useState<ViewMode>("sections");
  const [state, setState] = useState<PageState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [draftBanner, setDraftBanner] = useState<{
    visible: boolean;
    previousBody: string;
  } | null>(null);

  const load = useCallback(async () => {
    if (!agentId) return;
    setState("loading");
    setError(null);
    try {
      const token = await requireAccessToken();
      const [agents, instructions] = await Promise.all([
        listAgents(token),
        listAgentInstructions(agentId, token),
      ]);
      const a = agents.find((x) => x.id === agentId) ?? null;
      setAgent(a);
      // Newest row wins (the backend returns ORDER BY updated_at DESC).
      const current = instructions[0] ?? null;
      setExisting(current);
      setBody(current?.body ?? "");
      setState("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
      setState("error");
    }
  }, [agentId, requireAccessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  // Auto-fade the "draft inserted" banner after 30s so the page
  // settles back into its normal state. The user can always Undo
  // before that point.
  useEffect(() => {
    if (!draftBanner?.visible) return;
    const t = window.setTimeout(() => setDraftBanner(null), 30_000);
    return () => window.clearTimeout(t);
  }, [draftBanner?.visible]);

  async function handleSave(): Promise<void> {
    if (!agentId) return;
    if (!body.trim()) {
      toast.error("Add a body before saving.");
      return;
    }
    setState("saving");
    setError(null);
    try {
      const token = await requireAccessToken();
      const saved = await saveInstruction(
        {
          id: existing?.id,
          agentId,
          title: agent ? `${agent.name} — Job description` : "Job description",
          body,
        },
        token,
      );
      setExisting(saved);
      setState("ready");
      toast.success(
        existing
          ? `${agent?.name ?? "Agent"}'s job description updated.`
          : `${agent?.name ?? "Agent"}'s job description saved.`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Save failed";
      toast.error(msg);
      setState("ready");
    }
  }

  function handleWizardDrafted(draft: DraftedJobDescription): void {
    setDraftBanner({ visible: true, previousBody: body });
    setBody(draft.body);
  }

  function handleUndoDraft(): void {
    if (!draftBanner) return;
    setBody(draftBanner.previousBody);
    setDraftBanner(null);
  }

  const isEmpty = useMemo(() => !body.trim(), [body]);

  if (state === "loading") {
    return (
      <div className="af2-page text-af2-ink" style={{ maxWidth: 820 }}>
        <LoadingState label="Loading job description…" />
      </div>
    );
  }

  if (state === "error" && error) {
    return (
      <div className="af2-page text-af2-ink" style={{ maxWidth: 820 }}>
        <ErrorState
          title="Couldn't load job description"
          message={error}
          onRetry={() => void load()}
        />
      </div>
    );
  }

  const agentName = agent?.name ?? "this agent";

  return (
    <div className="af2-page text-af2-ink" style={{ maxWidth: 820 }}>
      <div className="af2-page-head">
        <div>
          <div className="af2-eyebrow">Workforce · Team · {agentName}</div>
          <h1
            className="af2-h1 font-af2-serif"
            style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 10 }}
          >
            Job description
          </h1>
          <div className="af2-page-head-meta">
            Tells {agentName} what to focus on, how to make decisions, and what
            not to touch.
          </div>
        </div>
        <Link
          to={`/agents/${agentId ?? ""}`}
          className="af2-btn af2-btn-ghost"
          style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          <ArrowLeft size={14} />
          Back to agent
        </Link>
      </div>

      {/* Mode toggle + wizard CTA */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 14,
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "inline-flex", gap: 4 }}>
          <button
            type="button"
            className={view === "sections" ? "af2-btn af2-btn-sm" : "af2-btn af2-btn-sm af2-btn-ghost"}
            onClick={() => setView("sections")}
          >
            Sections
          </button>
          <button
            type="button"
            className={view === "raw" ? "af2-btn af2-btn-sm" : "af2-btn af2-btn-sm af2-btn-ghost"}
            onClick={() => setView("raw")}
          >
            Raw markdown
          </button>
        </div>
        <button
          type="button"
          onClick={() => setWizardOpen(true)}
          className="af2-btn af2-btn-sm af2-btn-clay"
          style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          <Sparkles size={14} />
          {isEmpty ? "Help me write this" : "Redraft with wizard"}
        </button>
      </div>

      {draftBanner?.visible ? (
        <div
          role="status"
          style={{
            marginBottom: 14,
            padding: "10px 14px",
            borderRadius: 8,
            border: "1px solid rgba(74,107,74,0.25)",
            background: "rgba(74,107,74,0.10)",
            color: "var(--af2-sage)",
            fontSize: 13,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <span>✓ Draft inserted from your answers</span>
          <button
            type="button"
            onClick={handleUndoDraft}
            className="af2-btn af2-btn-sm af2-btn-ghost"
          >
            Undo
          </button>
        </div>
      ) : null}

      {isEmpty && !wizardOpen ? (
        <div
          className="af2-card"
          style={{
            padding: "32px 24px",
            textAlign: "center",
            borderStyle: "dashed",
            borderColor: "var(--af2-line-2)",
          }}
        >
          <p
            className="font-af2-serif"
            style={{ fontSize: 16, color: "var(--af2-ink)", margin: 0 }}
          >
            ✨ {agentName} doesn't have a job description yet.
          </p>
          <p
            className="af2-muted"
            style={{ fontSize: 13, marginTop: 8, lineHeight: 1.5 }}
          >
            A clear job description tells {agentName} what to focus on, how to
            make decisions when you're not around, and what not to touch.
          </p>
          <div
            style={{
              marginTop: 16,
              display: "inline-flex",
              gap: 10,
              alignItems: "center",
            }}
          >
            <button
              type="button"
              onClick={() => setWizardOpen(true)}
              className="af2-btn af2-btn-clay"
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <Sparkles size={14} />
              Help me write this →
            </button>
            <button
              type="button"
              onClick={() => {
                // Seed an empty 3-section skeleton so the user has
                // something to type into.
                setBody(
                  SECTIONS.map((s) => `## ${s.heading}\n`).join("\n").trim(),
                );
              }}
              className="af2-btn af2-btn-ghost"
            >
              Start blank
            </button>
          </div>
        </div>
      ) : (
        <div className="af2-card" style={{ padding: 20 }}>
          {view === "sections" ? (
            <SectionEditor
              body={body}
              onChange={setBody}
              sections={SECTIONS}
              disabled={state === "saving"}
            />
          ) : (
            <div>
              <label
                className="af2-eyebrow"
                style={{
                  display: "block",
                  marginBottom: 6,
                  color: "var(--af2-ink-2)",
                }}
              >
                Body (markdown)
              </label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                disabled={state === "saving"}
                rows={28}
                style={{
                  width: "100%",
                  fontFamily: "var(--af2-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
                  fontSize: 13,
                  lineHeight: 1.6,
                  padding: 12,
                  border: "1px solid var(--af2-line)",
                  borderRadius: 8,
                  background: "var(--af2-paper-2, #fafafa)",
                  color: "var(--af2-ink)",
                  resize: "vertical",
                }}
              />
            </div>
          )}

          <div
            style={{
              marginTop: 18,
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              gap: 10,
            }}
          >
            {/* Save confirmation + error live in the global toast
                (UX-7). Inline error span only renders when state ===
                "error" (e.g. initial load failure already handled
                above) — empty here so this row doesn't double-up
                with the toast message. */}
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={state === "saving"}
              className="af2-btn af2-btn-clay"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {state === "saving" ? (
                <Loader2 size={14} className="animate-spin" />
              ) : null}
              {state === "saving" ? "Saving…" : existing ? "Save changes" : "Save"}
            </button>
          </div>
        </div>
      )}

      <JobDescriptionWizardModal
        agentId={agentId ?? ""}
        agentName={agentName}
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onDrafted={handleWizardDrafted}
      />
    </div>
  );
}
