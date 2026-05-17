/**
 * AgentStandingTasks page (Wave 4) — route /agents/:agentId/standing-tasks
 *
 * Lists every routine (HEL-108) attached to the given agent, with:
 *   - Plain-English cron summary ("Every weekday at 9 am UTC")
 *   - Enable / disable toggle (PATCH .enabled)
 *   - Inline cron editor (PATCH .scheduleCron)
 *
 * The backend (src/routines/routineRoutes.ts) already syncs the
 * BullMQ repeatable-job scheduler on every PATCH, so toggling on/off
 * or changing cron takes effect at the next fire window without a
 * worker restart.
 *
 * "Run now" isn't here — that's Wave 5 (Check in now / Hand off),
 * because it queues a one-off job, which is a different code path
 * than scheduled routine execution.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Loader2, Save } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { ErrorState, LoadingState } from "../components/UiStates";
import { useToast } from "../components/ToastProvider";
import {
  listRoutines,
  updateRoutine,
  type Routine,
} from "../api/routinesApi";
import { listAgents, type Agent } from "../api/agentApi";
import { readableCron } from "../components/cronReadable";

type PageState = "loading" | "ready" | "error";

export default function AgentStandingTasks() {
  const { agentId } = useParams<{ agentId: string }>();
  const { requireAccessToken } = useAuth();
  const toast = useToast();

  const [agent, setAgent] = useState<Agent | null>(null);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [state, setState] = useState<PageState>("loading");
  const [error, setError] = useState<string | null>(null);
  // Per-routine pending edits to the cron string. Keyed by routine.id;
  // entries only exist for routines the user is mid-editing so a
  // background refresh of one routine doesn't clobber another's edit.
  const [cronEdits, setCronEdits] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  // Per-row error retained (instead of toast-only) because the failing
  // routine is easy to identify visually when the error sits in its
  // own card. The toast still fires for cross-app consistency.
  const [rowError, setRowError] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!agentId) return;
    setState("loading");
    setError(null);
    try {
      const token = await requireAccessToken();
      const [agents, allRoutines] = await Promise.all([
        listAgents(token),
        listRoutines(token),
      ]);
      setAgent(agents.find((a) => a.id === agentId) ?? null);
      // Server returns the whole workspace; filter client-side. With
      // dozens of routines per workspace this is cheap.
      setRoutines(allRoutines.filter((r) => r.agentId === agentId));
      setState("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
      setState("error");
    }
  }, [agentId, requireAccessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleToggleEnabled(routine: Routine): Promise<void> {
    setSavingId(routine.id);
    setRowError((prev) => ({ ...prev, [routine.id]: "" }));
    try {
      const token = await requireAccessToken();
      const updated = await updateRoutine(
        routine.id,
        { enabled: !routine.enabled },
        token,
      );
      setRoutines((prev) =>
        prev.map((r) => (r.id === routine.id ? updated : r)),
      );
      toast.success(
        updated.enabled
          ? `Standing task "${updated.name}" enabled.`
          : `Standing task "${updated.name}" paused.`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Toggle failed";
      setRowError((prev) => ({ ...prev, [routine.id]: msg }));
      toast.error(msg);
    } finally {
      setSavingId(null);
    }
  }

  async function handleSaveCron(routine: Routine): Promise<void> {
    const next = cronEdits[routine.id] ?? routine.scheduleCron ?? "";
    setSavingId(routine.id);
    setRowError((prev) => ({ ...prev, [routine.id]: "" }));
    try {
      const token = await requireAccessToken();
      const updated = await updateRoutine(
        routine.id,
        { scheduleCron: next.trim() || null },
        token,
      );
      setRoutines((prev) =>
        prev.map((r) => (r.id === routine.id ? updated : r)),
      );
      setCronEdits((prev) => {
        const copy = { ...prev };
        delete copy[routine.id];
        return copy;
      });
      toast.success(`Schedule for "${updated.name}" saved.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Save failed";
      setRowError((prev) => ({ ...prev, [routine.id]: msg }));
      toast.error(msg);
    } finally {
      setSavingId(null);
    }
  }

  const agentName = agent?.name ?? "this agent";

  if (state === "loading") {
    return (
      <div className="af2-page text-af2-ink" style={{ maxWidth: 820 }}>
        <LoadingState label="Loading standing tasks…" />
      </div>
    );
  }
  if (state === "error" && error) {
    return (
      <div className="af2-page text-af2-ink" style={{ maxWidth: 820 }}>
        <ErrorState
          title="Couldn't load standing tasks"
          message={error}
          onRetry={() => void load()}
        />
      </div>
    );
  }

  return (
    <div className="af2-page text-af2-ink" style={{ maxWidth: 820 }}>
      <div className="af2-page-head">
        <div>
          <div className="af2-eyebrow">Workforce · Team · {agentName}</div>
          <h1 className="af2-h1 font-af2-serif" style={{ marginTop: 6 }}>
            Standing tasks
          </h1>
          <div className="af2-page-head-meta">
            The scheduled work {agentName} runs on its own. Toggle one off to
            pause it, or edit the schedule to change when it fires.
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

      {routines.length === 0 ? (
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
            style={{ fontSize: 15, color: "var(--af2-ink-2)", margin: 0 }}
          >
            {agentName} doesn't have any standing tasks yet.
          </p>
          <p
            className="af2-muted"
            style={{ fontSize: 13, marginTop: 8, lineHeight: 1.5 }}
          >
            Build one in the Studio and attach it to {agentName} to see it
            here.
          </p>
          <Link
            to="/builder"
            className="af2-btn af2-btn-clay"
            style={{ marginTop: 16, display: "inline-block" }}
          >
            Open Studio →
          </Link>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {routines.map((routine) => (
            <RoutineRow
              key={routine.id}
              routine={routine}
              cronDraft={cronEdits[routine.id]}
              saving={savingId === routine.id}
              error={rowError[routine.id]}
              onCronDraftChange={(v) =>
                setCronEdits((prev) => ({ ...prev, [routine.id]: v }))
              }
              onCronSave={() => void handleSaveCron(routine)}
              onToggleEnabled={() => void handleToggleEnabled(routine)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface RoutineRowProps {
  routine: Routine;
  cronDraft: string | undefined;
  saving: boolean;
  error: string | undefined;
  onCronDraftChange: (v: string) => void;
  onCronSave: () => void;
  onToggleEnabled: () => void;
}

function RoutineRow({
  routine,
  cronDraft,
  saving,
  error,
  onCronDraftChange,
  onCronSave,
  onToggleEnabled,
}: RoutineRowProps) {
  const currentCron = cronDraft ?? routine.scheduleCron ?? "";
  const isDirty =
    cronDraft !== undefined && cronDraft !== (routine.scheduleCron ?? "");
  const readable = useMemo(
    () => readableCron(routine.scheduleCron),
    [routine.scheduleCron],
  );

  return (
    <div className="af2-card" style={{ padding: 16 }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{ fontWeight: 600, fontSize: 14, color: "var(--af2-ink)" }}
          >
            {routine.name}
          </div>
          <div
            className="af2-muted"
            style={{ fontSize: 12, marginTop: 4, lineHeight: 1.5 }}
          >
            {readable.label}
            {!readable.recognized && routine.scheduleCron ? (
              <span style={{ opacity: 0.6, marginLeft: 6 }}>
                ({routine.scheduleCron})
              </span>
            ) : null}
            {" · "}
            <span style={{ opacity: 0.7 }}>{routine.triggerKind}</span>
          </div>
        </div>

        {/* Enable / disable toggle */}
        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            cursor: saving ? "wait" : "pointer",
            opacity: saving ? 0.6 : 1,
          }}
        >
          <span
            className="af2-mono af2-muted"
            style={{ fontSize: 11.5, color: routine.enabled ? "var(--af2-sage)" : "var(--af2-ink-3)" }}
          >
            {routine.enabled ? "on" : "off"}
          </span>
          <input
            type="checkbox"
            role="switch"
            checked={routine.enabled}
            disabled={saving}
            onChange={onToggleEnabled}
            aria-label={`Toggle ${routine.name}`}
          />
        </label>
      </div>

      {/* Cron editor */}
      <div
        style={{
          marginTop: 12,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <input
          type="text"
          value={currentCron}
          disabled={saving}
          onChange={(e) => onCronDraftChange(e.target.value)}
          placeholder="0 9 * * 1-5"
          aria-label={`Cron schedule for ${routine.name}`}
          style={{
            flex: 1,
            padding: "6px 10px",
            fontSize: 12.5,
            fontFamily:
              "var(--af2-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
            border: "1px solid var(--af2-line)",
            borderRadius: 6,
            background: "var(--af2-paper-2)",
            color: "var(--af2-ink)",
          }}
        />
        <button
          type="button"
          onClick={onCronSave}
          disabled={!isDirty || saving}
          className="af2-btn af2-btn-sm af2-btn-ghost"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            opacity: !isDirty || saving ? 0.5 : 1,
            cursor: !isDirty || saving ? "not-allowed" : "pointer",
          }}
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
          Save
        </button>
      </div>

      {error ? (
        <div
          role="alert"
          style={{
            marginTop: 10,
            fontSize: 12,
            color: "var(--af2-clay)",
          }}
        >
          {error}
        </div>
      ) : null}
    </div>
  );
}
