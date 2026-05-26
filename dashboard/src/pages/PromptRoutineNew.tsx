/**
 * New prompt routine — companion to Studio for users who just want a
 * scheduled prompt instead of a full workflow. Mounted at
 * `/routines/new-prompt`.
 *
 * Form shape: name, prompt text, mission (required), agent (filtered by
 * mission), days of week, time of day, start/end dates. Persists via
 * POST /api/prompt-routines.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useMissionsQuery } from "../hooks/queries/useMissionsQuery";
import { useAgentsQuery } from "../hooks/queries/useAgentsQuery";
import {
  createPromptRoutine,
  type CreatePromptRoutineInput,
} from "../api/promptRoutinesApi";
import { useToast } from "../components/ToastProvider";

const DAY_LABELS: ReadonlyArray<{ value: number; short: string; long: string }> = [
  { value: 0, short: "Sun", long: "Sunday" },
  { value: 1, short: "Mon", long: "Monday" },
  { value: 2, short: "Tue", long: "Tuesday" },
  { value: 3, short: "Wed", long: "Wednesday" },
  { value: 4, short: "Thu", long: "Thursday" },
  { value: 5, short: "Fri", long: "Friday" },
  { value: 6, short: "Sat", long: "Saturday" },
];

function localTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function todayLocalIsoDate(): string {
  // YYYY-MM-DD for <input type="date">.
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);
}

export default function PromptRoutineNew() {
  const navigate = useNavigate();
  const toast = useToast();
  const { getAccessToken } = useAuth();
  const missionsQuery = useMissionsQuery();
  const agentsQuery = useAgentsQuery();

  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [missionId, setMissionId] = useState<string>("");
  const [agentId, setAgentId] = useState<string>("");
  const [days, setDays] = useState<Set<number>>(() => new Set([1, 2, 3, 4, 5]));
  const [timeOfDay, setTimeOfDay] = useState<string>("09:00");
  const [startsDate, setStartsDate] = useState<string>(todayLocalIsoDate());
  const [endsDate, setEndsDate] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const missions = missionsQuery.data ?? [];
  const agents = agentsQuery.data ?? [];

  // Filter agents by the selected mission. We look at the agent.metadata.missionId
  // convention used elsewhere in the app.
  const filteredAgents = useMemo(() => {
    if (!missionId) return [];
    return agents.filter((a) => {
      const raw = (a.metadata ?? {}) as { missionId?: unknown };
      return typeof raw.missionId === "string" && raw.missionId === missionId;
    });
  }, [agents, missionId]);

  // Auto-clear agent when mission changes so we don't carry a now-invalid pick.
  useEffect(() => {
    if (agentId && !filteredAgents.some((a) => a.id === agentId)) {
      setAgentId("");
    }
  }, [agentId, filteredAgents]);

  function toggleDay(value: number) {
    setDays((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError("Give the routine a short name.");
      return;
    }
    if (!prompt.trim()) {
      setError("Add the prompt you want the agent to run.");
      return;
    }
    if (!missionId) {
      setError("Pick a mission this routine belongs to.");
      return;
    }
    if (!agentId) {
      setError("Pick an agent on that mission to run the prompt.");
      return;
    }
    if (days.size === 0) {
      setError("Pick at least one day of the week.");
      return;
    }

    const startsAtIso = new Date(`${startsDate}T${timeOfDay}:00`).toISOString();
    const endsAtIso = endsDate
      ? new Date(`${endsDate}T${timeOfDay}:00`).toISOString()
      : null;
    if (endsAtIso && new Date(endsAtIso) <= new Date(startsAtIso)) {
      setError("End date must be after the start date.");
      return;
    }

    const input: CreatePromptRoutineInput = {
      name: name.trim(),
      prompt: prompt.trim(),
      missionId,
      agentId,
      daysOfWeek: Array.from(days).sort((a, b) => a - b),
      timeOfDay,
      timezone: localTimezone(),
      startsAt: startsAtIso,
      endsAt: endsAtIso,
    };

    setSubmitting(true);
    try {
      const token = (await getAccessToken()) ?? undefined;
      await createPromptRoutine(input, token);
      toast.success(`Prompt routine "${name.trim()}" created`);
      navigate("/routines");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create routine");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="af2-v2">
      <div className="af2-page">
        <div className="page-head">
          <div className="page-head-left">
            <h1 className="h1">New prompt routine</h1>
            <div className="meta">
              Send a prompt to an agent on a schedule. Each fire creates an
              assignment in the queue and posts to the activity feed.
            </div>
          </div>
          <div className="page-head-right">
            <Link to="/routines" className="btn">
              Cancel
            </Link>
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          style={{ display: "grid", gap: 20, maxWidth: 760 }}
        >
          <label className="field">
            <span style={fieldLabelStyle}>Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Morning standup nudge"
              required
              autoFocus
            />
          </label>

          <label className="field">
            <span style={fieldLabelStyle}>Prompt</span>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={6}
              placeholder="What should the agent do each time this fires?"
              required
              style={{ fontFamily: "inherit", fontSize: 13.5, lineHeight: 1.5 }}
            />
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <label className="field">
              <span style={fieldLabelStyle}>Mission</span>
              <select
                value={missionId}
                onChange={(e) => setMissionId(e.target.value)}
                required
              >
                <option value="">Pick a mission…</option>
                {missions.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.statement.slice(0, 80) || `Mission ${m.id.slice(0, 6)}`}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span style={fieldLabelStyle}>Agent</span>
              <select
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
                required
                disabled={!missionId}
              >
                <option value="">
                  {missionId
                    ? filteredAgents.length === 0
                      ? "No agents on this mission yet"
                      : "Pick an agent…"
                    : "Pick a mission first"}
                </option>
                {filteredAgents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.displayName || a.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div>
            <div style={fieldLabelStyle}>Days of the week</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {DAY_LABELS.map((day) => {
                const selected = days.has(day.value);
                return (
                  <button
                    key={day.value}
                    type="button"
                    onClick={() => toggleDay(day.value)}
                    aria-pressed={selected}
                    title={day.long}
                    style={{
                      padding: "8px 14px",
                      borderRadius: 6,
                      border: `1px solid ${selected ? "var(--af2-clay)" : "var(--af2-line)"}`,
                      background: selected ? "var(--af2-clay-soft)" : "var(--af2-paper-2)",
                      color: selected ? "var(--af2-clay)" : "var(--af2-ink-2)",
                      fontSize: 13,
                      fontWeight: 500,
                      cursor: "pointer",
                      font: "inherit",
                    }}
                  >
                    {day.short}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
            <label className="field">
              <span style={fieldLabelStyle}>Time of day</span>
              <input
                type="time"
                value={timeOfDay}
                onChange={(e) => setTimeOfDay(e.target.value)}
                required
              />
            </label>
            <label className="field">
              <span style={fieldLabelStyle}>Starts on</span>
              <input
                type="date"
                value={startsDate}
                onChange={(e) => setStartsDate(e.target.value)}
                required
              />
            </label>
            <label className="field">
              <span style={fieldLabelStyle}>Ends on (optional)</span>
              <input
                type="date"
                value={endsDate}
                onChange={(e) => setEndsDate(e.target.value)}
                min={startsDate}
              />
            </label>
          </div>

          {error ? (
            <div
              role="alert"
              style={{
                padding: "10px 12px",
                borderRadius: 6,
                background: "rgba(192,84,76,0.10)",
                border: "1px solid rgba(192,84,76,0.30)",
                color: "var(--af2-clay)",
                fontSize: 13,
              }}
            >
              {error}
            </div>
          ) : null}

          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="submit"
              className="btn primary"
              disabled={submitting}
            >
              {submitting ? "Saving…" : "Create routine"}
            </button>
            <Link to="/routines" className="btn">
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}

const fieldLabelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.1em",
  color: "var(--af2-ink-3)",
  marginBottom: 6,
};
