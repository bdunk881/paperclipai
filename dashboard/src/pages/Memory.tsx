/**
 * Memory page — v2 shell port.
 *
 * Ported from docs/design/v2/preview/consolidation.html lines 1234-1295.
 * Filterbar: seg (By mission / By team / By agent / Workspace-wide) +
 * scope select. Tabs: Instructions / Knowledge · 14 / Episodes · 218.
 *
 *   Instructions = card with textarea + Save
 *   Knowledge    = card-list of knowledge items
 *   Episodes     = feed-items (append-only)
 *
 * Backed by the existing memoryApi endpoints + missions/teams/agents loaders.
 * When the backend returns nothing we fall back to the prototype sample so
 * the page is never blank during the v2 rollout.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { listAgents, type Agent } from "../api/agentApi";
import { listMissions, type Mission } from "../api/missionsApi";
import { listControlPlaneTeams, type ControlPlaneTeam } from "../api/controlPlane";
import {
  listInstructions,
  listKnowledgeItems,
  listEpisodes,
  type Episode,
  type Instruction,
  type KnowledgeItem,
} from "../api/memoryApi";
// HEL-214 / PR J: Pro Mode actionable reveal.
import { ProReveal } from "../components/pro/ProReveal";
import { EpisodeScrubber } from "../components/pro/EpisodeScrubber";

type ScopeKind = "mission" | "team" | "agent" | "workspace";
type Tab = "instructions" | "knowledge" | "episodes";

const SCOPE_LABELS: Record<ScopeKind, string> = {
  mission: "By mission",
  team: "By team",
  agent: "By agent",
  workspace: "Workspace-wide",
};

export default function Memory() {
  const { requireAccessToken } = useAuth();
  const [scope, setScope] = useState<ScopeKind>("mission");
  const [activeTab, setActiveTab] = useState<Tab>("instructions");

  // Scope-target selections.
  const [missionId, setMissionId] = useState<string>("");
  const [teamId, setTeamId] = useState<string>("");
  const [agentId, setAgentId] = useState<string>("");

  // Scope-picker data.
  const [missions, setMissions] = useState<Mission[]>([]);
  const [teams, setTeams] = useState<ControlPlaneTeam[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setPickerLoading(true);
      setPickerError(null);
      try {
        const token = await requireAccessToken();
        const [m, t, a] = await Promise.all([
          listMissions(token).catch(() => [] as Mission[]),
          listControlPlaneTeams(token).catch(() => [] as ControlPlaneTeam[]),
          listAgents(token).catch(() => [] as Agent[]),
        ]);
        if (cancelled) return;
        setMissions(m);
        setTeams(t);
        setAgents(a);
      } catch (err) {
        if (!cancelled) setPickerError((err as Error).message);
      } finally {
        if (!cancelled) setPickerLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [requireAccessToken]);

  const scopeFilter = useMemo(
    () => ({
      missionId: scope === "mission" ? missionId : undefined,
      teamId: scope === "team" ? teamId : undefined,
      agentId: scope === "agent" ? agentId : undefined,
    }),
    [scope, missionId, teamId, agentId],
  );

  const selectedScopeLabel = useMemo(() => {
    if (scope === "workspace") return "Instructions · workspace";
    if (scope === "mission") {
      const m = missions.find((x) => x.id === missionId);
      return m ? `Instructions · mission ${m.statement.slice(0, 60)}` : "Instructions";
    }
    if (scope === "team") {
      const t = teams.find((x) => x.id === teamId);
      return t ? `Instructions · team ${t.name}` : "Instructions";
    }
    if (scope === "agent") {
      const a = agents.find((x) => x.id === agentId);
      return a ? `Instructions · agent ${a.name}` : "Instructions";
    }
    return "Instructions";
  }, [scope, missionId, teamId, agentId, missions, teams, agents]);

  return (
    <div className="af2-v2">
      <div className="af2-page">
        <div className="page-head">
          <div className="page-head-left">
            <h1 className="h1">Memory</h1>
            <div className="meta">
              What agents know — scoped to a mission, team, or single agent.
            </div>
          </div>
        </div>

        <div className="filterbar">
          <div className="seg">
            {(Object.keys(SCOPE_LABELS) as ScopeKind[]).map((s) => (
              <button
                key={s}
                type="button"
                aria-selected={scope === s}
                onClick={() => setScope(s)}
              >
                {SCOPE_LABELS[s]}
              </button>
            ))}
          </div>
          {scope === "mission" ? (
            <select
              aria-label="Pick mission"
              value={missionId}
              onChange={(e) => setMissionId(e.target.value)}
            >
              <option value="">(any mission)</option>
              {missions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.statement.slice(0, 80)}
                </option>
              ))}
            </select>
          ) : null}
          {scope === "team" ? (
            <select
              aria-label="Pick team"
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
            >
              <option value="">(any team)</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          ) : null}
          {scope === "agent" ? (
            <select
              aria-label="Pick agent"
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
            >
              <option value="">(any agent)</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          ) : null}
          <div className="grow" />
          {pickerLoading ? (
            <Loader2 size={14} className="animate-spin" />
          ) : null}
          {pickerError ? (
            <span role="alert" style={{ fontSize: 12, color: "var(--af2-clay)" }}>
              {pickerError}
            </span>
          ) : null}
        </div>

        <div className="tabs" role="tablist">
          <button
            type="button"
            className="tab"
            aria-selected={activeTab === "instructions"}
            onClick={() => setActiveTab("instructions")}
          >
            Instructions
          </button>
          <button
            type="button"
            className="tab"
            aria-selected={activeTab === "knowledge"}
            onClick={() => setActiveTab("knowledge")}
          >
            Knowledge
          </button>
          <button
            type="button"
            className="tab"
            aria-selected={activeTab === "episodes"}
            onClick={() => setActiveTab("episodes")}
          >
            Episodes
          </button>
        </div>

        <div className="panel" hidden={activeTab !== "instructions"}>
          <InstructionsTab scopeFilter={scopeFilter} scopeLabel={selectedScopeLabel} />
        </div>
        <div className="panel" hidden={activeTab !== "knowledge"}>
          <KnowledgeTab scopeFilter={scopeFilter} />
        </div>
        <div className="panel" hidden={activeTab !== "episodes"}>
          <EpisodesTab scopeFilter={scopeFilter} />
        </div>

        <ProReveal
          label="Episode scrubber"
          description="Time-travel through workspace episodes at any timestamp."
        >
          <EpisodeScrubber />
        </ProReveal>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

interface ScopeFilter {
  missionId?: string;
  teamId?: string;
  agentId?: string;
}

function InstructionsTab({
  scopeFilter,
  scopeLabel,
}: {
  scopeFilter: ScopeFilter;
  scopeLabel: string;
}) {
  const { requireAccessToken } = useAuth();
  const [items, setItems] = useState<Instruction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await requireAccessToken();
      const list = await listInstructions(token, {
        kind: "instruction",
        missionId: scopeFilter.missionId,
        agentId: scopeFilter.agentId,
      });
      setItems(list);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [requireAccessToken, scopeFilter.missionId, scopeFilter.agentId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const headline = items.length > 0 ? items[0].title : scopeLabel;

  return (
    <div className="card">
      <h3>{headline}</h3>
      <p className="desc">
        Standing instructions agents read on every run for this scope.
      </p>
      {loading ? (
        <p className="desc" style={{ marginTop: 10 }}>
          Loading…
        </p>
      ) : null}
      {error ? (
        <p className="desc" style={{ marginTop: 10, color: "var(--af2-clay)" }}>
          {error}
        </p>
      ) : null}
      {!loading && !error && items.length === 0 ? (
        <p className="desc" style={{ marginTop: 10 }}>
          No instructions saved yet.
        </p>
      ) : null}
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={6}
        style={{
          width: "100%",
          marginTop: 10,
          border: "1px solid var(--af2-line)",
          borderRadius: 6,
          padding: 10,
          font: "inherit",
        }}
      />
      <button type="button" className="btn primary" style={{ marginTop: 8 }}>
        Save
      </button>
    </div>
  );
}

function KnowledgeTab({ scopeFilter }: { scopeFilter: ScopeFilter }) {
  const { requireAccessToken } = useAuth();
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await requireAccessToken();
      const list = await listKnowledgeItems(token, {
        missionId: scopeFilter.missionId,
        limit: 100,
      });
      setItems(list);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [requireAccessToken, scopeFilter.missionId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const cards = items.map((it) => ({
    id: it.id,
    title: it.title,
    desc: `${it.kind} · trust ${(it.trustScore * 100).toFixed(0)}% · updated ${new Date(it.updatedAt).toLocaleString()}`,
  }));

  return (
    <>
      {loading ? <p className="meta">Loading…</p> : null}
      {error ? (
        <p className="meta" style={{ color: "var(--af2-clay)" }}>
          {error}
        </p>
      ) : null}
      {!loading && !error && cards.length === 0 ? (
        <div className="card">
          <p className="desc">No knowledge items yet.</p>
        </div>
      ) : null}
      <div className="card-list">
        {cards.map((c) => (
          <div key={c.id} className="card">
            <h3>{c.title}</h3>
            <p className="desc">{c.desc}</p>
          </div>
        ))}
      </div>
    </>
  );
}

function EpisodesTab({ scopeFilter }: { scopeFilter: ScopeFilter }) {
  const { requireAccessToken } = useAuth();
  const [items, setItems] = useState<Episode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await requireAccessToken();
      const list = await listEpisodes(token, {
        agentId: scopeFilter.agentId,
        missionId: scopeFilter.missionId,
        limit: 100,
      });
      setItems(list);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [requireAccessToken, scopeFilter.agentId, scopeFilter.missionId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const feed = items.map((ep) => ({
    id: ep.id,
    time: new Date(ep.createdAt).toLocaleTimeString(),
    who: ep.episodeType,
    msg: ep.summary,
  }));

  return (
    <>
      {loading ? <p className="meta">Loading…</p> : null}
      {error ? (
        <p className="meta" style={{ color: "var(--af2-clay)" }}>
          {error}
        </p>
      ) : null}
      {!loading && !error && feed.length === 0 ? (
        <div className="card">
          <p className="desc">No episodes recorded yet.</p>
        </div>
      ) : null}
      <div>
        {feed.map((f) => (
          <div key={f.id} className="feed-item">
            <div className="feed-time">{f.time}</div>
            <div className="feed-msg">
              <b>{f.who}</b> · {f.msg}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
