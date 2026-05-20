/**
 * AgentDetail page (UX-5) — route /agents/:agentId.
 *
 * The missing hub for per-agent context. Pre-UX-5 the route was caught
 * by the v1 redirect to /templates, so every "View agent" link on the
 * Team page silently dead-ended. Now it shows everything an owner
 * cares about for a single agent in one place:
 *
 *   - Header  : avatar + name + role + live presence pill
 *   - Toolbar : Check in / Hand off / Job desc link / Standing tasks
 *                link (the same AgentCardActions used on every other
 *                agent surface)
 *   - Three section cards:
 *       1. Job description (preview + "Edit →")
 *       2. Standing tasks (count + "Manage →")
 *       3. Budget / model / created-at quick facts
 *
 * No engine wiring needed — this page just composes existing
 * endpoints (listAgents + listAgentInstructions + listRoutines) and
 * the already-built components.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, ClipboardList, Sparkles } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { ErrorState, LoadingState } from "../components/UiStates";
import { listAgents, type Agent } from "../api/agentApi";
import {
  listAgentInstructions,
  type Instruction,
} from "../api/instructionsApi";
import {
  createRoutine,
  listRoutines,
  type Routine,
} from "../api/routinesApi";
import { AgentPresencePill } from "../components/AgentPresencePill";
import { AgentCardActions } from "../components/AgentCardActions";
import { useAgentPresence } from "../hooks/useAgentPresence";
import { readableCron } from "../components/cronReadable";

type PageState = "loading" | "ready" | "error";

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  if (parts.length === 0) return "··";
  return parts
    .map((p) => p[0] ?? "")
    .join("")
    .toUpperCase();
}

export default function AgentDetail() {
  const { agentId } = useParams<{ agentId: string }>();
  const { requireAccessToken } = useAuth();

  const [agent, setAgent] = useState<Agent | null>(null);
  const [instruction, setInstruction] = useState<Instruction | null>(null);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [state, setState] = useState<PageState>("loading");
  const [error, setError] = useState<string | null>(null);
  const presence = useAgentPresence();

  const load = useCallback(async () => {
    if (!agentId) return;
    setState("loading");
    setError(null);
    try {
      const token = await requireAccessToken();
      const [agents, instructions, allRoutines] = await Promise.all([
        listAgents(token),
        listAgentInstructions(agentId, token),
        listRoutines(token),
      ]);
      const a = agents.find((x) => x.id === agentId) ?? null;
      setAgent(a);
      setInstruction(instructions[0] ?? null);
      setRoutines(allRoutines.filter((r) => r.agentId === agentId));
      setState("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load agent");
      setState("error");
    }
  }, [agentId, requireAccessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const live = useMemo(
    () => (agentId ? presence.get(agentId) : undefined),
    [agentId, presence],
  );

  if (state === "loading") {
    return (
      <div className="af2-page text-af2-ink" style={{ maxWidth: 920 }}>
        <LoadingState label="Loading agent…" />
      </div>
    );
  }
  if (state === "error" && error) {
    return (
      <div className="af2-page text-af2-ink" style={{ maxWidth: 920 }}>
        <ErrorState
          title="Couldn't load agent"
          message={error}
          onRetry={() => void load()}
        />
      </div>
    );
  }
  if (!agent) {
    return (
      <div className="af2-page text-af2-ink" style={{ maxWidth: 920 }}>
        <ErrorState
          title="Agent not found"
          message="The agent you're looking for doesn't exist in this workspace, or you don't have access."
          onRetry={() => void load()}
        />
        <div style={{ marginTop: 14 }}>
          <Link
            to="/workspace/org-structure"
            className="af2-btn af2-btn-ghost"
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <ArrowLeft size={14} />
            Back to Team
          </Link>
        </div>
      </div>
    );
  }

  const enabledRoutines = routines.filter((r) => r.enabled).length;

  return (
    <div className="af2-page text-af2-ink" style={{ maxWidth: 920 }}>
      <div className="af2-page-head">
        <div>
          <div className="af2-eyebrow">Workforce · Team</div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              marginTop: 6,
            }}
          >
            <div
              aria-hidden="true"
              style={{
                width: 56,
                height: 56,
                borderRadius: "50%",
                background: "var(--af2-clay-soft)",
                color: "var(--af2-clay-2, var(--af2-clay))",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 18,
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              {initialsFor(agent.name)}
            </div>
            <div style={{ minWidth: 0 }}>
              <h1
                className="af2-h1 font-af2-serif"
                style={{
                  margin: 0,
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                {agent.name}
                <AgentPresencePill presence={live} />
              </h1>
              <div className="af2-page-head-meta" style={{ marginTop: 4 }}>
                {agent.roleKey ?? "—"}
                {agent.model ? (
                  <span
                    className="af2-mono af2-muted-2"
                    style={{ marginLeft: 10, fontSize: 12 }}
                  >
                    · {agent.model}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        </div>
        <Link
          to="/workspace/org-structure"
          className="af2-btn af2-btn-ghost"
          style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          <ArrowLeft size={14} />
          Back to Team
        </Link>
      </div>

      {/* Action toolbar — same component used on every agent card. */}
      <div className="af2-card" style={{ padding: 14, marginBottom: 18 }}>
        <AgentCardActions agent={{ id: agent.id, name: agent.name }} />
      </div>

      {/* Three section cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 14,
        }}
      >
        <JobDescriptionCard agentId={agent.id} agentName={agent.name} instruction={instruction} />
        <StandingTasksCard
          agentId={agent.id}
          agentName={agent.name}
          routines={routines}
          enabledCount={enabledRoutines}
        />
        <QuickFactsCard agent={agent} />
      </div>

      {/* HEL-174: prompt-backed routine form. Pure NL — no workflow
          builder required. */}
      <SchedulePromptCard
        agentId={agent.id}
        agentName={agent.name}
        routines={routines}
        onCreated={(routine) => setRoutines((prev) => [routine, ...prev])}
      />
    </div>
  );
}

// HEL-174: Cron presets so users don't need to know cron syntax.
const CRON_PRESETS: Array<{ label: string; cron: string | null; trigger: "manual" | "scheduled" }> = [
  { label: "Manual only", cron: null, trigger: "manual" },
  { label: "Every weekday 9am UTC", cron: "0 9 * * 1-5", trigger: "scheduled" },
  { label: "Monday mornings (9am UTC)", cron: "0 9 * * 1", trigger: "scheduled" },
  { label: "Hourly", cron: "0 * * * *", trigger: "scheduled" },
  { label: "Daily at 8am UTC", cron: "0 8 * * *", trigger: "scheduled" },
];

function SchedulePromptCard({
  agentId,
  agentName,
  routines,
  onCreated,
}: {
  agentId: string;
  agentName: string;
  routines: Routine[];
  onCreated: (routine: Routine) => void;
}) {
  const { requireAccessToken } = useAuth();
  const [name, setName] = useState(`${agentName} scheduled prompt`);
  const [prompt, setPrompt] = useState("");
  const [presetIdx, setPresetIdx] = useState(1);
  const [llmTier, setLlmTier] = useState<"lite" | "standard" | "power">("standard");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const promptBackedRoutines = useMemo(
    () => routines.filter((r) => r.prompt && r.agentId === agentId),
    [routines, agentId],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const token = await requireAccessToken();
      const preset = CRON_PRESETS[presetIdx]!;
      const created = await createRoutine(
        {
          agentId,
          name: name.trim() || `${agentName} scheduled prompt`,
          prompt: prompt.trim(),
          llmTier,
          scheduleCron: preset.cron,
          triggerKind: preset.trigger,
          enabled: true,
        },
        token,
      );
      onCreated(created);
      setPrompt("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to schedule prompt");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="af2-card" style={{ padding: 16, marginTop: 18 }}>
      <div
        className="af2-eyebrow"
        style={{ marginBottom: 6, color: "var(--af2-ink-2)" }}
      >
        <Sparkles size={12} style={{ display: "inline-block", marginRight: 4 }} />
        Scheduled prompts (no workflow needed)
      </div>
      <p
        className="af2-muted"
        style={{ fontSize: 12.5, lineHeight: 1.55, marginTop: 0, marginBottom: 14 }}
      >
        Write a natural-language instruction. {agentName} will read it on the
        cron you pick and act — no DAG, no steps. For complex multi-step
        automation, build a workflow in Studio instead.
      </p>

      <form
        onSubmit={handleSubmit}
        style={{ display: "grid", gap: 10 }}
      >
        <label style={{ display: "grid", gap: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--af2-ink-2)" }}>
            Name
          </span>
          <input
            type="text"
            className="af2-input"
            value={name}
            maxLength={200}
            onChange={(e) => setName(e.target.value)}
            placeholder={`${agentName} scheduled prompt`}
          />
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--af2-ink-2)" }}>
            Prompt
          </span>
          <textarea
            className="af2-input"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={`e.g., "Every Monday, generate a summary of last week's marketing performance and post it to the team channel."`}
            rows={4}
            maxLength={10000}
            required
          />
        </label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 160px", gap: 10 }}>
          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--af2-ink-2)" }}>
              Schedule
            </span>
            <select
              className="af2-input"
              value={presetIdx}
              onChange={(e) => setPresetIdx(Number(e.target.value))}
            >
              {CRON_PRESETS.map((p, i) => (
                <option key={p.label} value={i}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--af2-ink-2)" }}>
              Model
            </span>
            <select
              className="af2-input"
              value={llmTier}
              onChange={(e) => setLlmTier(e.target.value as "lite" | "standard" | "power")}
            >
              <option value="lite">Lite</option>
              <option value="standard">Standard</option>
              <option value="power">Power</option>
            </select>
          </label>
        </div>
        {error ? (
          <div className="af2-muted" style={{ color: "var(--af2-clay)", fontSize: 12 }}>
            {error}
          </div>
        ) : null}
        <div>
          <button
            type="submit"
            className="af2-btn af2-btn-primary"
            disabled={busy || !prompt.trim()}
          >
            {busy ? "Saving…" : "Schedule prompt"}
          </button>
        </div>
      </form>

      {promptBackedRoutines.length > 0 ? (
        <div style={{ marginTop: 18 }}>
          <div
            className="af2-eyebrow"
            style={{ marginBottom: 6, color: "var(--af2-ink-2)" }}
          >
            Active scheduled prompts
          </div>
          <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none", display: "grid", gap: 8 }}>
            {promptBackedRoutines.map((r) => {
              const readable = readableCron(r.scheduleCron);
              return (
                <li
                  key={r.id}
                  style={{
                    fontSize: 13,
                    lineHeight: 1.5,
                    padding: "8px 10px",
                    background: "var(--af2-paper-soft, rgba(0,0,0,0.02))",
                    borderRadius: 6,
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{r.name}</div>
                  <div className="af2-muted" style={{ fontSize: 12 }}>
                    {readable.label}
                    {!r.enabled ? " · paused" : ""}
                  </div>
                  <div
                    className="af2-muted"
                    style={{
                      fontSize: 12,
                      marginTop: 4,
                      whiteSpace: "pre-wrap",
                      opacity: 0.85,
                    }}
                  >
                    {r.prompt}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function JobDescriptionCard({
  agentId,
  agentName,
  instruction,
}: {
  agentId: string;
  agentName: string;
  instruction: Instruction | null;
}) {
  const preview = instruction?.body?.slice(0, 280) ?? "";
  return (
    <div className="af2-card" style={{ padding: 16 }}>
      <div
        className="af2-eyebrow"
        style={{ marginBottom: 8, color: "var(--af2-ink-2)" }}
      >
        Job description
      </div>
      {instruction ? (
        <>
          <p
            className="af2-muted"
            style={{
              fontSize: 12.5,
              lineHeight: 1.55,
              marginTop: 0,
              maxHeight: 110,
              overflow: "hidden",
              fontFamily: "var(--af2-serif, ui-serif, Georgia, serif)",
              color: "var(--af2-ink)",
            }}
          >
            {preview}
            {instruction.body.length > preview.length ? "…" : ""}
          </p>
          <Link
            to={`/agents/${encodeURIComponent(agentId)}/job`}
            className="af2-btn af2-btn-sm af2-btn-ghost"
            style={{
              marginTop: 8,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Sparkles size={12} />
            Edit job description →
          </Link>
        </>
      ) : (
        <>
          <p
            className="af2-muted"
            style={{ fontSize: 12.5, lineHeight: 1.55, marginTop: 0 }}
          >
            {agentName} doesn't have a job description yet. Use the wizard to
            draft one from four short answers.
          </p>
          <Link
            to={`/agents/${encodeURIComponent(agentId)}/job`}
            className="af2-btn af2-btn-sm af2-btn-clay"
            style={{
              marginTop: 8,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Sparkles size={12} />
            Help me write this →
          </Link>
        </>
      )}
    </div>
  );
}

function StandingTasksCard({
  agentId,
  agentName,
  routines,
  enabledCount,
}: {
  agentId: string;
  agentName: string;
  routines: Routine[];
  enabledCount: number;
}) {
  return (
    <div className="af2-card" style={{ padding: 16 }}>
      <div
        className="af2-eyebrow"
        style={{ marginBottom: 8, color: "var(--af2-ink-2)" }}
      >
        Standing tasks
      </div>
      {routines.length > 0 ? (
        <>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "var(--af2-ink)",
              marginBottom: 4,
            }}
          >
            {enabledCount} of {routines.length} active
          </div>
          <ul
            style={{
              margin: 0,
              paddingLeft: 0,
              listStyle: "none",
              display: "grid",
              gap: 4,
            }}
          >
            {routines.slice(0, 3).map((r) => {
              const readable = readableCron(r.scheduleCron);
              return (
                <li
                  key={r.id}
                  className="af2-muted"
                  style={{
                    fontSize: 12,
                    lineHeight: 1.5,
                    color: r.enabled
                      ? "var(--af2-ink-2)"
                      : "var(--af2-ink-3)",
                  }}
                >
                  <strong style={{ color: "var(--af2-ink)" }}>{r.name}</strong>
                  <span style={{ opacity: 0.7 }}> · {readable.label}</span>
                  {!r.enabled ? (
                    <span style={{ marginLeft: 6, opacity: 0.7 }}>(off)</span>
                  ) : null}
                </li>
              );
            })}
            {routines.length > 3 ? (
              <li
                className="af2-muted"
                style={{ fontSize: 11.5, fontStyle: "italic" }}
              >
                +{routines.length - 3} more…
              </li>
            ) : null}
          </ul>
          <Link
            to={`/agents/${encodeURIComponent(agentId)}/standing-tasks`}
            className="af2-btn af2-btn-sm af2-btn-ghost"
            style={{
              marginTop: 10,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <ClipboardList size={12} />
            Manage standing tasks →
          </Link>
        </>
      ) : (
        <>
          <p
            className="af2-muted"
            style={{ fontSize: 12.5, lineHeight: 1.55, marginTop: 0 }}
          >
            {agentName} has no standing tasks yet. Build one in Studio and
            attach it to {agentName}.
          </p>
          <Link
            to="/builder"
            className="af2-btn af2-btn-sm af2-btn-ghost"
            style={{ marginTop: 8 }}
          >
            Open Studio →
          </Link>
        </>
      )}
    </div>
  );
}

function QuickFactsCard({ agent }: { agent: Agent }) {
  const created = new Date(agent.createdAt);
  const lastRun = agent.lastRunAt ? new Date(agent.lastRunAt) : null;
  return (
    <div className="af2-card" style={{ padding: 16 }}>
      <div
        className="af2-eyebrow"
        style={{ marginBottom: 8, color: "var(--af2-ink-2)" }}
      >
        Quick facts
      </div>
      <dl
        style={{
          margin: 0,
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          gap: "6px 12px",
          fontSize: 12.5,
        }}
      >
        <dt className="af2-muted">Budget</dt>
        <dd style={{ margin: 0, color: "var(--af2-ink)" }}>
          {agent.budgetMonthlyUsd > 0
            ? `$${agent.budgetMonthlyUsd.toFixed(0)}/mo`
            : "—"}
        </dd>
        <dt className="af2-muted">Model</dt>
        <dd
          className="af2-mono"
          style={{ margin: 0, color: "var(--af2-ink)" }}
        >
          {agent.model ?? "auto (workspace default)"}
        </dd>
        <dt className="af2-muted">Status</dt>
        <dd style={{ margin: 0, color: "var(--af2-ink)" }}>{agent.status}</dd>
        <dt className="af2-muted">Created</dt>
        <dd style={{ margin: 0, color: "var(--af2-ink)" }}>
          {Number.isNaN(created.getTime())
            ? agent.createdAt
            : created.toLocaleDateString()}
        </dd>
        <dt className="af2-muted">Last run</dt>
        <dd style={{ margin: 0, color: "var(--af2-ink)" }}>
          {lastRun && !Number.isNaN(lastRun.getTime())
            ? lastRun.toLocaleString()
            : "—"}
        </dd>
      </dl>
    </div>
  );
}
