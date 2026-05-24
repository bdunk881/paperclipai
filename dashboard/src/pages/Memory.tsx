/**
 * Memory page — HEL-207 / PR D scope rework.
 *
 * Replaces the old per-page split (Memory = Knowledge Ingest,
 * WorkspaceMemory = the 3-tab Instructions/Knowledge/Episodes view) with a
 * single page that owns:
 *
 *   1. A scope picker (segmented control): Mission / Team / Agent / Workspace-wide
 *   2. A scope-specific selector dropdown (mission|team|agent picker)
 *   3. The 3-tab body (Instructions / Knowledge / Episodes) filtered by
 *      memory_layer + mission_id | team_id | agent_id.
 *
 * The Personal memory UI is gone — agent memory is the only personal-equivalent
 * scope and is reachable via the Agent scope picker.
 *
 * Scaffold-level: lists are wired to the existing memoryApi endpoints with
 * mission_id propagated for the Mission scope. team/agent scope filters land in
 * a follow-up once the backend route accepts those params; today they're
 * captured as UI state and applied client-side via Episode `agentId`.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import clsx from "clsx";
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

type ScopeKind = "mission" | "team" | "agent" | "workspace";
type Tab = "instructions" | "knowledge" | "episodes";

const SCOPE_LABELS: Record<ScopeKind, string> = {
  mission: "By mission",
  team: "By team",
  agent: "By agent",
  workspace: "Workspace-wide",
};

const TAB_LABELS: Record<Tab, string> = {
  instructions: "Instructions",
  knowledge: "Knowledge",
  episodes: "Episodes",
};

export default function Memory() {
  const { requireAccessToken } = useAuth();
  const [scope, setScope] = useState<ScopeKind>("workspace");
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

  // Hydrate the three scope-target lists once on mount. Cheap enough — every
  // dropdown lives on the same page, and the user will likely flip between
  // scopes during a single visit.
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

  return (
    <div className="min-h-screen bg-af2-paper text-af2-ink">
      <header className="border-b border-af2-line bg-af2-card px-8 py-6">
        <div className="text-xs uppercase tracking-[0.18em] text-af2-ink-2">Memory</div>
        <h1 className="mt-1 font-af2-serif text-3xl font-medium tracking-[-0.02em]">
          Memory
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-af2-ink-2">
          What your agents read, write, and remember. Pick a scope to filter the
          three memory layers — Instructions, Knowledge, and Episodes.
        </p>
      </header>

      {/* Scope picker — segmented control */}
      <div className="border-b border-af2-line bg-af2-card px-8 py-4">
        <div
          role="tablist"
          aria-label="Memory scope"
          className="inline-flex rounded-md border border-af2-line bg-af2-paper p-1"
        >
          {(Object.keys(SCOPE_LABELS) as ScopeKind[]).map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={scope === s}
              onClick={() => setScope(s)}
              className={clsx(
                "rounded px-3 py-1.5 text-sm font-medium transition",
                scope === s
                  ? "bg-af2-clay text-af2-paper"
                  : "text-af2-ink-2 hover:text-af2-ink",
              )}
            >
              {SCOPE_LABELS[s]}
            </button>
          ))}
        </div>

        {/* Scope-target dropdown — only when a non-workspace scope is selected */}
        {scope !== "workspace" ? (
          <div className="mt-3 flex items-center gap-2">
            <label className="text-xs uppercase tracking-[0.14em] text-af2-ink-2">
              {scope === "mission" ? "Mission" : scope === "team" ? "Team" : "Agent"}
            </label>
            {scope === "mission" ? (
              <select
                aria-label="Pick mission"
                value={missionId}
                onChange={(e) => setMissionId(e.target.value)}
                className="rounded-md border border-af2-line-2 bg-af2-card px-3 py-1.5 text-sm text-af2-ink"
              >
                <option value="">(none)</option>
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
                className="rounded-md border border-af2-line-2 bg-af2-card px-3 py-1.5 text-sm text-af2-ink"
              >
                <option value="">(none)</option>
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
                className="rounded-md border border-af2-line-2 bg-af2-card px-3 py-1.5 text-sm text-af2-ink"
              >
                <option value="">(none)</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            ) : null}
            {pickerLoading ? (
              <Loader2 className="h-4 w-4 animate-spin text-af2-ink-2" />
            ) : null}
            {pickerError ? (
              <span role="alert" className="text-xs text-af2-clay">
                {pickerError}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Memory-layer tabs */}
      <nav className="border-b border-af2-line bg-af2-card px-8">
        <div className="flex gap-6">
          {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setActiveTab(t)}
              className={clsx(
                "relative py-3 text-sm font-medium transition",
                activeTab === t ? "text-af2-ink" : "text-af2-ink-2 hover:text-af2-ink",
              )}
            >
              {TAB_LABELS[t]}
              {activeTab === t ? (
                <span className="absolute inset-x-0 bottom-0 h-0.5 bg-af2-clay" />
              ) : null}
            </button>
          ))}
        </div>
      </nav>

      <main className="px-8 py-8">
        <div hidden={activeTab !== "instructions"}>
          <InstructionsTab scopeFilter={scopeFilter} />
        </div>
        <div hidden={activeTab !== "knowledge"}>
          <KnowledgeTab scopeFilter={scopeFilter} />
        </div>
        <div hidden={activeTab !== "episodes"}>
          <EpisodesTab scopeFilter={scopeFilter} />
        </div>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scoped tabs — read-only scaffold. Each tab fetches its layer filtered by
// memory_layer + scope identifier. Tabs share the same shape (loading/error/
// list) so reviewers can see the scope wiring without losing the existing
// instructions/knowledge/episodes UX.
// ---------------------------------------------------------------------------

interface ScopeFilter {
  missionId?: string;
  teamId?: string;
  agentId?: string;
}

function InstructionsTab({ scopeFilter }: { scopeFilter: ScopeFilter }) {
  const { requireAccessToken } = useAuth();
  const [items, setItems] = useState<Instruction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <section className="mx-auto max-w-4xl">
      <h2 className="font-af2-serif text-xl text-af2-ink">Instructions</h2>
      <p className="mt-1 text-sm text-af2-ink-2">
        CLAUDE.md-style instructions inlined into every agent at boot.
      </p>

      <StatusRow loading={loading} error={error} empty={!loading && items.length === 0}>
        No instructions match this scope yet.
      </StatusRow>

      <ul className="mt-4 space-y-2.5">
        {items.map((it) => (
          <li key={it.id} className="rounded-md border border-af2-line bg-af2-card p-4">
            <h3 className="font-af2-serif text-lg text-af2-ink">{it.title}</h3>
            <p className="mt-1 text-xs text-af2-ink-2">
              v{it.version} · updated {new Date(it.updatedAt).toLocaleString()}
              {it.missionId ? " · mission-scoped" : ""}
              {it.agentId ? " · agent-scoped" : ""}
            </p>
          </li>
        ))}
      </ul>
    </section>
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

  return (
    <section className="mx-auto max-w-5xl">
      <h2 className="font-af2-serif text-xl text-af2-ink">Knowledge</h2>
      <p className="mt-1 text-sm text-af2-ink-2">
        Durable retrieval-backing facts. Filtered by the active scope.
      </p>

      <StatusRow loading={loading} error={error} empty={!loading && items.length === 0}>
        No knowledge items match this scope yet.
      </StatusRow>

      <ul className="mt-4 space-y-2.5">
        {items.map((it) => (
          <li key={it.id} className="rounded-md border border-af2-line bg-af2-card p-4">
            <h3 className="font-af2-serif text-base text-af2-ink">{it.title}</h3>
            <p className="mt-1 line-clamp-2 text-sm text-af2-ink-2">{it.content}</p>
            <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-af2-ink-2">
              <span className="rounded bg-af2-paper px-2 py-0.5">{it.kind}</span>
              <span className="rounded bg-af2-paper px-2 py-0.5">
                trust {(it.trustScore * 100).toFixed(0)}%
              </span>
              <span>· updated {new Date(it.updatedAt).toLocaleString()}</span>
            </p>
          </li>
        ))}
      </ul>
    </section>
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

  return (
    <section className="mx-auto max-w-5xl">
      <h2 className="font-af2-serif text-xl text-af2-ink">Episodes</h2>
      <p className="mt-1 text-sm text-af2-ink-2">
        Append-only log of agent observations, actions, and reflections.
      </p>

      <StatusRow loading={loading} error={error} empty={!loading && items.length === 0}>
        No episodes match this scope yet.
      </StatusRow>

      <ul className="mt-4 space-y-2.5">
        {items.map((ep) => (
          <li key={ep.id} className="rounded-md border border-af2-line bg-af2-card p-4">
            <div className="flex items-baseline justify-between gap-4">
              <h3 className="font-af2-serif text-base text-af2-ink">{ep.title}</h3>
              <span className="shrink-0 rounded bg-af2-paper px-2 py-1 text-xs text-af2-ink-2">
                {ep.episodeType}
              </span>
            </div>
            <p className="mt-1 line-clamp-2 text-sm text-af2-ink-2">{ep.summary}</p>
            <p className="mt-2 text-xs text-af2-ink-2">
              {new Date(ep.createdAt).toLocaleString()}
              {ep.reflectedAt ? " · reflected" : " · awaiting reflection"}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function StatusRow({
  loading,
  error,
  empty,
  children,
}: {
  loading: boolean;
  error: string | null;
  empty: boolean;
  children: React.ReactNode;
}) {
  if (loading) {
    return (
      <div className="mt-4 flex items-center gap-2 text-sm text-af2-ink-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }
  if (error) {
    return (
      <div
        role="alert"
        className="mt-4 rounded-md border border-af2-clay/40 bg-af2-clay-soft/30 px-4 py-3 text-sm text-af2-clay"
      >
        {error}
      </div>
    );
  }
  if (empty) {
    return (
      <div className="mt-4 rounded-md border border-dashed border-af2-line bg-af2-card p-8 text-center text-sm text-af2-ink-2">
        {children}
      </div>
    );
  }
  return null;
}
