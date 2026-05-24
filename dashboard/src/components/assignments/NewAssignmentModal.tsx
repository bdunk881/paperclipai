/**
 * NewAssignmentModal — Linear-style ticket-create modal (HEL-204 PR A).
 *
 * Fields: title · mission · assignee (agent or human) · description ·
 * risk tier · priority · due date.
 *
 * On submit, POSTs to `/api/mission-assignments` (handler lives in
 * `src/tickets/ticketRoutes.ts` mounted under that path — see
 * `src/app.ts`). Returns the created TicketAggregate so the parent
 * Assignments page can refresh + navigate to the detail surface.
 *
 * Modal chrome mirrors `components/missions/ConfirmDestructiveModal.tsx`
 * (Af2Modal-shell) so it composes the same way as the rest of the v2
 * editorial dialogs.
 */
import { useState, type FormEvent } from "react";
import { Loader2, Plus, X } from "lucide-react";
import {
  buildCreateTicketPayload,
  type CreateTicketRouteActionPayload,
} from "../../routes/ticketRouteData";
import {
  getTicketActorProfile,
  type TicketActorRef,
  type TicketAggregate,
  type TicketPriority,
} from "../../api/tickets";
import type { Mission } from "../../api/missionsApi";
import { useAuth } from "../../context/AuthContext";
import { trackedFetch } from "../../api/trackedFetch";
import { getApiBasePath } from "../../api/baseUrl";

type RiskTier = "low" | "medium" | "high";

const PRIORITY_OPTIONS: TicketPriority[] = ["urgent", "high", "medium", "low"];
const RISK_TIERS: RiskTier[] = ["low", "medium", "high"];

interface NewAssignmentModalProps {
  actorOptions: TicketActorRef[];
  missions: Mission[];
  workspaceId: string | null;
  onClose: () => void;
  onCreated: (
    aggregate: TicketAggregate & { source: "api" | "mock"; integrationWarnings: string[] },
  ) => void;
}

interface FormState {
  title: string;
  description: string;
  missionId: string;
  primaryActorKey: string;
  priority: TicketPriority;
  riskTier: RiskTier;
  dueDate: string;
}

const EMPTY_FORM: FormState = {
  title: "",
  description: "",
  missionId: "",
  primaryActorKey: "",
  priority: "medium",
  riskTier: "medium",
  dueDate: "",
};

export function NewAssignmentModal({
  actorOptions,
  missions,
  workspaceId,
  onClose,
  onCreated,
}: NewAssignmentModalProps) {
  const { getAccessToken } = useAuth();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!form.title.trim()) {
      setError("Title is required.");
      return;
    }
    if (!form.primaryActorKey) {
      setError("Choose an assignee.");
      return;
    }
    setSubmitting(true);
    try {
      // Compose tags so the assignment threads onto the parent mission and
      // carries its risk tier (used by the SLA tab for triage).
      const tags = [
        form.missionId ? `mission:${form.missionId}` : null,
        `risk:${form.riskTier}`,
      ]
        .filter(Boolean)
        .join(",");

      const payload: CreateTicketRouteActionPayload = {
        title: form.title.trim(),
        description: form.description.trim(),
        priority: form.priority,
        primaryActorKey: form.primaryActorKey,
        collaboratorKeys: [],
        dueDate: form.dueDate,
        tags,
        workspaceId: workspaceId ?? undefined,
        externalSyncRequested: false,
      };

      const body = buildCreateTicketPayload(payload);
      const accessToken = (await getAccessToken()) ?? undefined;
      // HEL-204 PR A: new dedicated path. Backend currently mounts the
      // ticket router at both `/api/tickets` and `/api/mission-assignments`
      // (see src/app.ts).
      const res = await trackedFetch(`${getApiBasePath()}/mission-assignments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(errBody?.error ?? `Failed to create assignment (${res.status})`);
      }
      const aggregate = (await res.json()) as TicketAggregate & {
        source: "api" | "mock";
        integrationWarnings: string[];
      };
      onCreated(aggregate);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create assignment");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-assignment-heading"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        background: "rgba(20, 22, 24, 0.55)",
      }}
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          background: "transparent",
          border: "none",
          cursor: "default",
        }}
      />
      <form
        onSubmit={handleSubmit}
        className="af2-card"
        style={{
          position: "relative",
          zIndex: 1,
          width: "100%",
          maxWidth: 640,
          maxHeight: "90vh",
          overflowY: "auto",
          padding: 24,
          background: "var(--af2-card)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 16,
            marginBottom: 18,
          }}
        >
          <div>
            <div className="af2-eyebrow">Run · Assignments · New</div>
            <h2
              id="new-assignment-heading"
              className="af2-h2 font-af2-serif"
              style={{ marginTop: 6 }}
            >
              Hand off work
            </h2>
            <p className="af2-muted" style={{ fontSize: 13, marginTop: 4 }}>
              Scope to a mission, pick the agent or human, set risk + priority.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="af2-btn af2-btn-sm"
            aria-label="Close modal"
            style={{
              padding: 6,
              minWidth: 32,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <X size={14} />
          </button>
        </div>

        <div style={{ display: "grid", gap: 14 }}>
          <label style={{ display: "grid", gap: 4 }}>
            <span className="af2-eyebrow">Title</span>
            <input
              autoFocus
              aria-label="Assignment title"
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
              placeholder="Describe the outcome you need"
              className="af2-input"
            />
          </label>

          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
            <label style={{ display: "grid", gap: 4 }}>
              <span className="af2-eyebrow">Mission</span>
              <select
                aria-label="Assignment mission"
                value={form.missionId}
                onChange={(event) => setForm({ ...form, missionId: event.target.value })}
                className="af2-input"
              >
                <option value="">No mission · standalone</option>
                {missions.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.statement.length > 60
                      ? `${m.statement.slice(0, 60)}…`
                      : m.statement}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ display: "grid", gap: 4 }}>
              <span className="af2-eyebrow">Assignee (agent or human)</span>
              <select
                aria-label="Assignment primary assignee"
                value={form.primaryActorKey}
                onChange={(event) =>
                  setForm({ ...form, primaryActorKey: event.target.value })
                }
                className="af2-input"
              >
                <option value="">
                  {actorOptions.length === 0 ? "No assignees available" : "Choose an owner"}
                </option>
                {actorOptions.map((actor) => {
                  const key = `${actor.type}:${actor.id}`;
                  return (
                    <option key={key} value={key}>
                      {getTicketActorProfile(actor).name} ({actor.type})
                    </option>
                  );
                })}
              </select>
            </label>
          </div>

          <label style={{ display: "grid", gap: 4 }}>
            <span className="af2-eyebrow">Description</span>
            <textarea
              rows={4}
              aria-label="Assignment description"
              value={form.description}
              onChange={(event) =>
                setForm({ ...form, description: event.target.value })
              }
              placeholder="Context, expected artifacts, blockers, customer impact…"
              className="af2-input"
              style={{ resize: "vertical" }}
            />
          </label>

          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr 1fr" }}>
            <label style={{ display: "grid", gap: 4 }}>
              <span className="af2-eyebrow">Risk tier</span>
              <select
                aria-label="Assignment risk tier"
                value={form.riskTier}
                onChange={(event) =>
                  setForm({ ...form, riskTier: event.target.value as RiskTier })
                }
                className="af2-input"
              >
                {RISK_TIERS.map((tier) => (
                  <option key={tier} value={tier}>
                    {tier}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ display: "grid", gap: 4 }}>
              <span className="af2-eyebrow">Priority</span>
              <select
                aria-label="Assignment priority"
                value={form.priority}
                onChange={(event) =>
                  setForm({ ...form, priority: event.target.value as TicketPriority })
                }
                className="af2-input"
              >
                {PRIORITY_OPTIONS.map((priority) => (
                  <option key={priority} value={priority}>
                    {priority}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ display: "grid", gap: 4 }}>
              <span className="af2-eyebrow">Due date</span>
              <input
                type="datetime-local"
                aria-label="Assignment due date"
                value={form.dueDate}
                onChange={(event) => setForm({ ...form, dueDate: event.target.value })}
                className="af2-input"
              />
            </label>
          </div>
        </div>

        {error ? (
          <div
            role="alert"
            style={{
              marginTop: 14,
              padding: "10px 14px",
              borderRadius: "var(--af2-radius)",
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
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 10,
            borderTop: "1px solid var(--af2-line)",
            paddingTop: 16,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            className="af2-btn af2-btn-ghost af2-btn-sm"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="af2-btn af2-btn-clay"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              opacity: submitting ? 0.6 : 1,
              cursor: submitting ? "wait" : "pointer",
            }}
          >
            {submitting ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Create assignment
          </button>
        </div>
      </form>
    </div>
  );
}
