/**
 * Escalations — Ask-the-CEO surface (DASH-46).
 *
 * The HITL backend has shipped `POST /api/hitl/companies/:companyId/ask-ceo/requests`
 * for a while (and DASH-45 just moved the data onto canonical Postgres),
 * but no dashboard page consumed it — escalations landed in the store and
 * the user never saw them. Audit ticket HEL-139 C3 + HEL-140 H3 both
 * flagged this as a dead-end UX.
 *
 * Surface:
 *   - List of past Ask-the-CEO requests for the active workspace's company
 *     (question + response summary + cited entities + recommended actions)
 *   - "New escalation" modal with a question textarea + optional
 *     context fields (artifactRef / taskId / checkpointId)
 *
 * companyId is derived from the active workspace ID. The backend treats
 * companyId as an opaque string key, which matches how every HITL test
 * uses arbitrary "company-1" / team.id values. When per-workspace
 * company resolution lands (HEL-13 follow-up), swap the source — the
 * page only references one `companyId` variable.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, MessageSquarePlus, X } from "lucide-react";
import {
  createHitlAskCeoRequest,
  getHitlCompanyState,
  type CreateHitlAskCeoRequestInput,
  type HitlAskCeoRequest,
  type HitlCompanyState,
} from "../api/client";
import { ErrorState, LoadingState } from "../components/UiStates";
import { useAuth } from "../context/AuthContext";
import { useWorkspace } from "../context/useWorkspace";

function formatTimestamp(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export default function Escalations() {
  const { requireAccessToken } = useAuth();
  const { activeWorkspaceId } = useWorkspace();
  const [companyState, setCompanyState] = useState<HitlCompanyState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  // DASH-46: companyId source. Workspace ID is the stable handle the user
  // already has across other surfaces; the HITL backend accepts any
  // opaque string. Swap to a real company resolver when HEL-13 follow-up
  // lands a workspace → company mapping.
  const companyId = activeWorkspaceId ?? null;

  const loadState = useCallback(async () => {
    if (!companyId) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const accessToken = await requireAccessToken();
      const state = await getHitlCompanyState(companyId, accessToken);
      setCompanyState(state);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load escalations");
    } finally {
      setLoading(false);
    }
  }, [companyId, requireAccessToken]);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  const requests = useMemo(
    () =>
      (companyState?.askCeoRequests ?? []).slice().sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      ),
    [companyState],
  );

  if (!activeWorkspaceId) {
    return (
      <div className="af2-page">
        <ErrorState
          title="No workspace selected"
          message="Switch to a workspace to view its escalation log."
        />
      </div>
    );
  }

  if (loading && !companyState) {
    return (
      <div className="af2-page">
        <LoadingState label="Loading escalations…" />
      </div>
    );
  }

  if (error && !companyState) {
    return (
      <div className="af2-page">
        <ErrorState
          title="Escalations unavailable"
          message={error}
          onRetry={() => void loadState()}
        />
      </div>
    );
  }

  return (
    <div className="af2-page">
      <div className="af2-page-head">
        <div>
          <div className="af2-eyebrow">Governance · Ask the CEO</div>
          <h1 className="af2-h1" style={{ marginTop: 6 }}>
            Escalations
          </h1>
          <div className="af2-page-head-meta">
            {requests.length}{" "}
            {requests.length === 1 ? "escalation" : "escalations"} on record.
            Each one snapshots company state at the moment of the question.
          </div>
        </div>
        <div className="af2-page-actions">
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="af2-btn af2-btn-primary"
          >
            <MessageSquarePlus size={14} style={{ marginRight: 6 }} />
            New escalation
          </button>
        </div>
      </div>

      {error && (
        <div style={{ marginBottom: 16 }}>
          <ErrorState
            title="Refresh failed"
            message={error}
            onRetry={() => void loadState()}
          />
        </div>
      )}

      {requests.length === 0 ? (
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
            Nothing escalated yet.
          </p>
          <p
            className="af2-muted"
            style={{ fontSize: 13, marginTop: 8, lineHeight: 1.5 }}
          >
            When you or an agent needs a CEO-level call — a policy break, a
            cross-team trade-off, a budget decision — file it here. Each
            escalation captures the live company snapshot so the answer has
            grounded context.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {requests.map((request) => (
            <EscalationCard key={request.id} request={request} />
          ))}
        </div>
      )}

      {modalOpen && companyId && (
        <NewEscalationModal
          companyId={companyId}
          onClose={() => setModalOpen(false)}
          onCreated={() => {
            setModalOpen(false);
            void loadState();
          }}
        />
      )}
    </div>
  );
}

function EscalationCard({ request }: { request: HitlAskCeoRequest }) {
  return (
    <article
      className="af2-card"
      style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}
    >
      <div className="af2-row" style={{ alignItems: "flex-start", gap: 14 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            className="af2-eyebrow"
            style={{ marginBottom: 4 }}
          >
            {formatTimestamp(request.createdAt)}
          </div>
          <div
            className="font-af2-serif"
            style={{ fontSize: 17, color: "var(--af2-ink)", lineHeight: 1.4 }}
          >
            {request.question}
          </div>
        </div>
      </div>

      <div
        style={{
          borderTop: "1px solid var(--af2-line)",
          paddingTop: 12,
          fontSize: 13.5,
          color: "var(--af2-ink-2)",
          lineHeight: 1.55,
        }}
      >
        {request.response.summary}
      </div>

      {request.response.recommendedActions.length > 0 && (
        <div>
          <div
            className="af2-mono"
            style={{
              fontSize: 11,
              color: "var(--af2-ink-3)",
              textTransform: "uppercase",
              letterSpacing: 1,
              marginBottom: 6,
            }}
          >
            Recommended actions
          </div>
          <ul
            style={{
              margin: 0,
              paddingLeft: 18,
              fontSize: 13,
              color: "var(--af2-ink-2)",
              lineHeight: 1.6,
            }}
          >
            {request.response.recommendedActions.map((action, index) => (
              <li key={index}>{action}</li>
            ))}
          </ul>
        </div>
      )}

      {request.response.citedEntities.length > 0 && (
        <div className="af2-row" style={{ gap: 8, flexWrap: "wrap" }}>
          {request.response.citedEntities.map((entity) => (
            <span
              key={`${entity.type}-${entity.id}`}
              className="af2-pill"
              style={{ fontSize: 11.5 }}
            >
              <span className="af2-dot" />
              {entity.type}: {entity.label}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}

function NewEscalationModal({
  companyId,
  onClose,
  onCreated,
}: {
  companyId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { requireAccessToken } = useAuth();
  const [question, setQuestion] = useState("");
  const [artifactRef, setArtifactRef] = useState("");
  const [taskId, setTaskId] = useState("");
  const [checkpointId, setCheckpointId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!question.trim()) {
      setSubmitError("Please describe what needs the CEO's attention.");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const accessToken = await requireAccessToken();
      const input: CreateHitlAskCeoRequestInput = {
        question: question.trim(),
      };
      const context = {
        artifactRef: artifactRef.trim() || undefined,
        taskId: taskId.trim() || undefined,
        checkpointId: checkpointId.trim() || undefined,
      };
      if (Object.values(context).some(Boolean)) {
        input.context = context;
      }
      await createHitlAskCeoRequest(companyId, input, accessToken);
      onCreated();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to file escalation");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-af2-ink/55 backdrop-blur-[2px] px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-escalation-title"
    >
      <button
        type="button"
        aria-label="Close new escalation modal"
        className="absolute inset-0 bg-transparent"
        onClick={onClose}
      />
      <div className="af2-card relative z-10 w-full max-w-lg p-6 shadow-af2-lg">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <p
              className="text-[11px] font-semibold uppercase tracking-[0.2em] text-af2-clay"
            >
              Governance · Ask the CEO
            </p>
            <h2
              id="new-escalation-title"
              className="font-af2-serif mt-2 text-xl font-medium text-af2-ink"
            >
              File an escalation
            </h2>
            <p className="mt-2 text-sm leading-6 text-af2-ink-2">
              The response will snapshot live company state (active team, open
              checkpoints, recent artifact comments) so the answer has
              grounded context.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full border border-af2-line p-2 text-af2-ink-3 transition hover:border-af2-clay/30 hover:text-af2-ink"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="escalation-question"
              className="block text-xs font-semibold uppercase tracking-[0.16em] text-af2-ink-3 mb-1"
            >
              Question
            </label>
            <textarea
              id="escalation-question"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              rows={5}
              placeholder="What needs the CEO's attention right now?"
              className="af2-input w-full"
              autoFocus
              required
            />
          </div>

          <details className="text-sm text-af2-ink-2">
            <summary className="cursor-pointer text-xs uppercase tracking-[0.16em] text-af2-ink-3">
              Add optional context (artifact, task, checkpoint)
            </summary>
            <div className="mt-3 space-y-3">
              <div>
                <label
                  htmlFor="escalation-artifact"
                  className="block text-xs text-af2-ink-3 mb-1"
                >
                  Artifact reference
                </label>
                <input
                  id="escalation-artifact"
                  type="text"
                  value={artifactRef}
                  onChange={(event) => setArtifactRef(event.target.value)}
                  placeholder="e.g. prd-checkout-v2"
                  className="af2-input w-full"
                />
              </div>
              <div>
                <label
                  htmlFor="escalation-task"
                  className="block text-xs text-af2-ink-3 mb-1"
                >
                  Task ID
                </label>
                <input
                  id="escalation-task"
                  type="text"
                  value={taskId}
                  onChange={(event) => setTaskId(event.target.value)}
                  placeholder="e.g. TASK-1234"
                  className="af2-input w-full"
                />
              </div>
              <div>
                <label
                  htmlFor="escalation-checkpoint"
                  className="block text-xs text-af2-ink-3 mb-1"
                >
                  Checkpoint ID
                </label>
                <input
                  id="escalation-checkpoint"
                  type="text"
                  value={checkpointId}
                  onChange={(event) => setCheckpointId(event.target.value)}
                  placeholder="e.g. checkpoint-abc-123"
                  className="af2-input w-full"
                />
              </div>
            </div>
          </details>

          {submitError && (
            <div
              className="rounded-md border border-af2-clay/40 bg-af2-clay/10 px-3 py-2 text-sm text-af2-clay"
            >
              {submitError}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="af2-btn"
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="af2-btn af2-btn-primary"
              disabled={submitting}
            >
              {submitting && (
                <Loader2 size={14} className="animate-spin" style={{ marginRight: 6 }} />
              )}
              File escalation
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
