/**
 * Hiring Plan Review page (HEL-105, ported from the closed PR #747 on top
 * of the HEL-25 backend that landed in PR #745).
 *
 * Side-by-side view: mission statement + company context on the left,
 * generated plan summary + rationale + 30/60/90 roadmap on the right.
 * Below: agent cards for each role the plan provisions. Confirm CTA
 * calls `POST /api/hiring-plans/:hiringPlanId/confirm` (the endpoint
 * shipped in #745) and re-fetches the plan so the confirmed state is
 * reflected.
 *
 * Mirrors the v2 design spec — "User reviews and edits the generated
 * plan in the UI (side-by-side mission ↔ plan)" — which the inline
 * Confirm button on the Hire page didn't fully capture.
 */

import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  Sparkles,
  Trash2,
  UserCircle2,
  Users,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../components/ToastProvider";
import {
  deleteMission,
  getHiringPlan,
  confirmHiringPlan,
  generateHiringPlan,
  patchHiringPlanSelection,
  type HiringPlanResponse,
  type StaffingRecommendation,
  type StarterJobDescription,
} from "../api/missionsApi";
import { patchAgent } from "../api/agentApi";
import { getConnectorHealth } from "../api/client";
import { listLLMConfigs } from "../api/client";
import { AgentToolChips, type ConnectorHealthByKey } from "../components/missions/AgentToolChips";
import { ConfirmDestructiveModal } from "../components/missions/ConfirmDestructiveModal";

type PageState =
  | "loading"
  | "ready"
  | "confirming"
  // HEL-211: post-confirm "Name your team" rename slider.
  | "renaming"
  | "savingNames"
  | "confirmed"
  | "discarding"
  | "error";

interface PendingRename {
  agentId: string;
  agentName: string;
  roleTitle: string;
  displayName: string;
}

function ModelTierBadge({ tier }: { tier: string }) {
  const colors: Record<string, string> = {
    lite: "bg-af2-paper-2 text-af2-ink-3",
    standard: "af2-tone-bg-sage",
    power: "af2-tone-bg-clay",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colors[tier] ?? "bg-af2-paper-2 text-af2-ink-3"}`}
    >
      {tier}
    </span>
  );
}

function AgentCard({
  agent,
  selected,
  onToggle,
  connectorHealth,
  disabled,
}: {
  agent: StaffingRecommendation;
  selected: boolean;
  onToggle: () => void;
  connectorHealth: ConnectorHealthByKey;
  disabled?: boolean;
}) {
  return (
    <div
      className="af2-card"
      style={{
        padding: 16,
        opacity: selected ? 1 : 0.55,
        borderColor: selected ? undefined : "var(--af2-line-2)",
      }}
    >
      <div className="af2-row" style={{ alignItems: "flex-start", gap: 8 }}>
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          disabled={disabled}
          aria-label={`Include ${agent.title}`}
          style={{ marginTop: 4 }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="af2-row" style={{ gap: 8, flexWrap: "wrap" }}>
            <span className="af2-serif" style={{ fontSize: 14, fontWeight: 600 }}>
              {agent.title}
            </span>
            <ModelTierBadge tier={agent.modelTier} />
            {agent.budgetMonthlyUsd != null ? (
              <span className="af2-mono af2-muted-2" style={{ fontSize: 11 }}>
                ${agent.budgetMonthlyUsd.toLocaleString()}/mo
              </span>
            ) : null}
          </div>
          <p className="af2-muted" style={{ marginTop: 4, fontSize: 12, lineHeight: 1.5 }}>
            {agent.mandate}
          </p>
          {agent.justification ? (
            <p className="af2-muted-2" style={{ marginTop: 6, fontSize: 11.5, lineHeight: 1.55 }}>
              {agent.justification}
            </p>
          ) : null}
        </div>
      </div>
      {agent.skills.length > 0 ? (
        <div style={{ marginTop: 10 }}>
          <div className="af2-eyebrow" style={{ marginBottom: 4 }}>
            Skills
          </div>
          <p className="af2-muted" style={{ fontSize: 12, lineHeight: 1.5, margin: 0 }}>
            {agent.skills.join(" · ")}
          </p>
        </div>
      ) : null}
      <AgentToolChips tools={agent.tools} connectorHealth={connectorHealth} />
      {agent.kpis.length > 0 ? (
        <div style={{ marginTop: 10 }}>
          <div className="af2-eyebrow" style={{ marginBottom: 4 }}>
            KPIs
          </div>
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {agent.kpis.map((kpi) => (
              <li key={kpi} className="af2-muted" style={{ fontSize: 12, lineHeight: 1.6 }}>
                {kpi}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {agent.provisioningInstructions ? (
        <div style={{ marginTop: 10 }}>
          <div className="af2-eyebrow" style={{ marginBottom: 4 }}>
            Day-one brief
          </div>
          <p className="af2-muted" style={{ fontSize: 12, lineHeight: 1.55, margin: 0 }}>
            {agent.provisioningInstructions}
          </p>
        </div>
      ) : null}
    </div>
  );
}

export default function HiringPlanReview() {
  // Route shape: /hire/plan/:missionId/:planId. The missionId is kept in the
  // URL for breadcrumb context + back-links, but the API calls below key
  // off planId only — that's the canonical lookup id post-HEL-25.
  const { missionId, planId } = useParams<{ missionId: string; planId: string }>();
  const { requireAccessToken } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const [pageState, setPageState] = useState<PageState>("loading");
  const [plan, setPlan] = useState<HiringPlanResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // HEL-154: post-confirm payload — the backend seeds a starter routine per
  // agent, we surface a "Default routines created — View routines" CTA per
  // agent that deep-links to /agents/:id/standing-tasks.
  const [seededRoutines, setSeededRoutines] = useState<
    Array<{ agentId: string; agentName: string; routineId: string; routineName: string }>
  >([]);
  // HEL-211: staged display-name values for the post-confirm "Name your
  // team" step. Defaults to empty per agent so the input placeholder
  // (the role title) shows until the owner types.
  const [pendingRenames, setPendingRenames] = useState<PendingRename[]>([]);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [includedRoleKeys, setIncludedRoleKeys] = useState<Set<string>>(new Set());
  const [connectorHealth, setConnectorHealth] = useState<ConnectorHealthByKey>({});
  const [regenerating, setRegenerating] = useState(false);
  const [selectionWarning, setSelectionWarning] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!planId) return;
    setPageState("loading");
    setError(null);
    try {
      const token = await requireAccessToken();
      const [data, health] = await Promise.all([
        getHiringPlan(planId, token),
        getConnectorHealth(token).catch(() => ({ connectors: [] })),
      ]);
      setPlan(data);
      const healthMap: ConnectorHealthByKey = {};
      for (const record of health.connectors ?? []) {
        healthMap[record.connectorKey] = {
          state: record.state,
          connectorName: record.connectorName,
        };
      }
      setConnectorHealth(healthMap);
      const keys =
        data.plan.selection?.includedRoleKeys ??
        data.plan.provisioningPlan.agents.map((a) => a.roleKey);
      setIncludedRoleKeys(new Set(keys));
      // A fresh load (post-navigation) doesn't carry the seeded-routines
      // payload — those only return on the confirm POST. Clear so we don't
      // show a stale CTA list from a previous confirm.
      if (!data.acceptedAt) setSeededRoutines([]);
      setPageState(data.acceptedAt ? "confirmed" : "ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load hiring plan");
      setPageState("error");
    }
  }, [planId, requireAccessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  function toggleAgent(roleKey: string) {
    setIncludedRoleKeys((current) => {
      const next = new Set(current);
      if (next.has(roleKey)) next.delete(roleKey);
      else next.add(roleKey);
      return next;
    });
    setSelectionWarning(null);
  }

  async function persistSelection(keys: string[]) {
    if (!planId) return;
    const token = await requireAccessToken();
    const { plan: updated } = await patchHiringPlanSelection(planId, keys, token);
    setPlan((prev) => (prev ? { ...prev, plan: updated } : prev));
  }

  async function handleConfirm() {
    if (!planId) return;
    const selected = Array.from(includedRoleKeys);
    if (selected.length === 0) {
      setSelectionWarning("Select at least one agent to provision.");
      return;
    }
    setPageState("confirming");
    setError(null);
    setSelectionWarning(null);
    try {
      const token = await requireAccessToken();
      await persistSelection(selected);
      const confirmed = await confirmHiringPlan(planId, token, selected);
      // Refresh plan data so the confirmed state is reflected.
      const refreshed = await getHiringPlan(planId, token);
      setPlan(refreshed);
      // HEL-211: stage one rename entry per provisioned agent. Default
      // displayName is "" so the input placeholder (role title) shows
      // and we don't accidentally PATCH unchanged rows.
      const agentsByRoleKey = new Map(
        refreshed.plan.provisioningPlan.agents.map((a) => [a.roleKey, a]),
      );
      setPendingRenames(
        confirmed.agents.map((agent) => ({
          agentId: agent.id,
          agentName: agent.name,
          roleTitle:
            agentsByRoleKey.get(agent.roleKey)?.title ?? agent.name,
          displayName: "",
        })),
      );
      setRenameError(null);
      // HEL-154: zip seeded routines to their agents for the post-confirm CTA list.
      if (confirmed.seededRoutines && confirmed.seededRoutines.length > 0) {
        const agentNameById = new Map(confirmed.agents.map((a) => [a.id, a.name]));
        setSeededRoutines(
          confirmed.seededRoutines.map((r) => ({
            agentId: r.agentId,
            agentName: agentNameById.get(r.agentId) ?? "Agent",
            routineId: r.id,
            routineName: r.name,
          })),
        );
      } else {
        setSeededRoutines([]);
      }
      const agentCount = refreshed.plan.provisioningPlan.agents.length;
      toast.success(
        `Team confirmed — ${agentCount} agent${
          agentCount === 1 ? "" : "s"
        } provisioned.`,
      );
      // HEL-211: move into the rename step. Falls back to "confirmed"
      // when no agents were provisioned (defensive — shouldn't happen
      // post-validation but the step has nothing to render in that
      // case).
      setPageState(confirmed.agents.length > 0 ? "renaming" : "confirmed");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to confirm plan";
      setError(msg);
      toast.error(msg);
      setPageState("ready");
    }
  }

  // HEL-211 — "Name your team" handlers.
  function updatePendingRename(agentId: string, displayName: string) {
    setPendingRenames((cur) =>
      cur.map((row) =>
        row.agentId === agentId ? { ...row, displayName } : row,
      ),
    );
  }

  async function handleSaveRenames() {
    setRenameError(null);
    // Only PATCH the rows with a non-empty value — empty stays NULL so
    // the org list falls back to `name`.
    const dirty = pendingRenames
      .map((row) => ({ ...row, trimmed: row.displayName.trim() }))
      .filter((row) => row.trimmed.length > 0);

    if (dirty.length === 0) {
      // Nothing to save — same as skip.
      setPageState("confirmed");
      return;
    }

    setPageState("savingNames");
    try {
      const token = await requireAccessToken();
      // Sequential rather than Promise.all so the first failure stops
      // the rest — partial saves on this screen would surface as half
      // the org renamed without an obvious recovery path.
      for (const row of dirty) {
        await patchAgent(row.agentId, { displayName: row.trimmed }, token);
      }
      toast.success(
        `Renamed ${dirty.length} agent${dirty.length === 1 ? "" : "s"}.`,
      );
      setPageState("confirmed");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save names";
      setRenameError(msg);
      toast.error(msg);
      setPageState("renaming");
    }
  }

  function handleSkipRenames() {
    setRenameError(null);
    setPageState("confirmed");
  }

  async function handleDiscard() {
    if (!plan || plan.acceptedAt) return;
    setPageState("discarding");
    setError(null);
    try {
      const token = await requireAccessToken();
      await deleteMission(plan.missionId, token);
      toast.success("Draft discarded.");
      setDiscardOpen(false);
      navigate("/hire");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to discard plan";
      setError(msg);
      toast.error(msg);
      setPageState("ready");
    }
  }

  async function handleRegenerate() {
    if (!missionId || !planId) return;
    setRegenerating(true);
    setError(null);
    try {
      const token = await requireAccessToken();
      const configs = await listLLMConfigs(token).catch(() => []);
      const llmConfigId =
        plan?.plan.generationMeta?.llmConfigId ??
        configs.find((c) => c.isDefault)?.id ??
        configs[0]?.id;
      if (!llmConfigId) {
        throw new Error("Connect a model in Settings before regenerating.");
      }
      const generated = await generateHiringPlan(missionId, token, { llmConfigId });
      navigate(`/hire/plan/${missionId}/${generated.hiringPlanId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to regenerate plan";
      setError(msg);
      toast.error(msg);
    } finally {
      setRegenerating(false);
    }
  }

  const agents = plan?.plan.provisioningPlan.agents ?? [];
  const selectedCount = agents.filter((a) => includedRoleKeys.has(a.roleKey)).length;
  const generationMeta = plan?.plan.generationMeta;

  return (
    <div className="af2-page text-af2-ink" style={{ maxWidth: 1200 }}>
      <div className="af2-page-head">
        <div>
          <div className="af2-eyebrow">Workforce · Hiring · Plan Review</div>
          <h1 className="af2-h1 font-af2-serif" style={{ marginTop: 6 }}>
            Review hiring plan
          </h1>
          <div className="af2-page-head-meta">
            {plan?.plan.summary ?? "Review the generated org plan and confirm to provision agents."}
          </div>
        </div>
        <div className="af2-page-actions af2-row" style={{ gap: 8 }}>
          {generationMeta ? (
            <span className="af2-mono af2-muted-2" style={{ fontSize: 11 }}>
              Generated with {generationMeta.provider} / {generationMeta.model}
            </span>
          ) : null}
          {!plan?.acceptedAt ? (
            <button
              type="button"
              className="af2-btn af2-btn-sm"
              disabled={regenerating || pageState === "confirming"}
              onClick={() => void handleRegenerate()}
            >
              {regenerating ? <Loader2 size={12} className="animate-spin" /> : null}
              Regenerate plan
            </button>
          ) : null}
          <Link
            to="/hire"
            className="af2-btn af2-btn-ghost af2-btn-sm"
            style={{ textDecoration: "none" }}
          >
            ← Back to Hire
          </Link>
        </div>
      </div>

      {error ? (
        <div
          role="alert"
          style={{
            marginBottom: 16,
            padding: "10px 14px",
            borderRadius: "var(--af2-radius)",
            border: "1px solid rgba(194,80,43,0.3)",
            background: "rgba(194,80,43,0.10)",
            color: "var(--af2-clay)",
            fontSize: 13,
          }}
        >
          {error}
        </div>
      ) : null}

      {pageState === "loading" ? (
        <div className="af2-card" style={{ padding: 40, textAlign: "center" }}>
          <Loader2 className="animate-spin" style={{ margin: "0 auto 12px", opacity: 0.5 }} />
          <p className="af2-muted">Loading hiring plan…</p>
        </div>
      ) : pageState === "error" && !plan ? (
        <div className="af2-card" style={{ padding: 40, textAlign: "center" }}>
          <p className="af2-muted">Plan could not be loaded. Check the URL and try again.</p>
        </div>
      ) : plan ? (
        <>
          {/* Side-by-side: mission ↔ plan summary */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) minmax(0, 2fr)",
              gap: 20,
              marginBottom: 24,
            }}
          >
            {/* Left: mission */}
            <div className="af2-card" style={{ padding: 22 }}>
              <div className="af2-eyebrow" style={{ marginBottom: 10 }}>
                Mission
              </div>
              <p className="af2-serif" style={{ fontSize: 15, lineHeight: 1.6 }}>
                {plan.missionStatement}
              </p>
              {plan.plan.company.targetCustomer ? (
                <div style={{ marginTop: 14 }}>
                  <div className="af2-eyebrow">Target customer</div>
                  <p className="af2-muted" style={{ marginTop: 4, fontSize: 13 }}>
                    {plan.plan.company.targetCustomer}
                  </p>
                </div>
              ) : null}
              {plan.plan.company.budget ? (
                <div style={{ marginTop: 10 }}>
                  <div className="af2-eyebrow">Budget</div>
                  <p className="af2-muted" style={{ marginTop: 4, fontSize: 13 }}>
                    {plan.plan.company.budget}
                  </p>
                </div>
              ) : null}
              {plan.plan.company.timeHorizon ? (
                <div style={{ marginTop: 10 }}>
                  <div className="af2-eyebrow">Time horizon</div>
                  <p className="af2-muted" style={{ marginTop: 4, fontSize: 13 }}>
                    {plan.plan.company.timeHorizon}
                  </p>
                </div>
              ) : null}
            </div>

            {/* Right: plan summary + rationale */}
            <div className="af2-card" style={{ padding: 22 }}>
              <div className="af2-eyebrow" style={{ marginBottom: 10 }}>
                Plan — {plan.plan.provisioningPlan.teamName}
              </div>
              <p style={{ fontSize: 14, lineHeight: 1.7, color: "var(--af2-ink-2)", marginBottom: 10 }}>
                {plan.plan.summary}
              </p>
              <p style={{ fontSize: 13, lineHeight: 1.65, color: "var(--af2-ink-3)" }}>
                {plan.plan.rationale}
              </p>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  gap: 12,
                  marginTop: 18,
                }}
              >
                {(
                  [
                    { label: "Day 30", data: plan.plan.roadmap306090.day30 },
                    { label: "Day 60", data: plan.plan.roadmap306090.day60 },
                    { label: "Day 90", data: plan.plan.roadmap306090.day90 },
                  ] as const
                ).map(({ label, data }) => (
                  <div key={label} className="af2-card" style={{ background: "var(--af2-paper-2)" }}>
                    <div className="af2-eyebrow">{label}</div>
                    <ul style={{ margin: "6px 0 0", paddingLeft: 14 }}>
                      {data.objectives.map((obj) => (
                        <li key={obj} className="af2-muted" style={{ fontSize: 11.5, lineHeight: 1.6 }}>
                          {obj}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Agents to provision */}
          <div style={{ marginBottom: 24 }}>
            <div className="af2-row" style={{ marginBottom: 14, alignItems: "center" }}>
              <div>
                <div className="af2-eyebrow">Agents to provision</div>
                <div className="af2-row" style={{ gap: 8, marginTop: 4 }}>
                  <span className="af2-mono af2-muted-2" style={{ fontSize: 12 }}>
                    <Users size={12} style={{ display: "inline", marginRight: 4 }} />
                    {selectedCount} of {agents.length} selected for provisioning
                  </span>
                </div>
              </div>
            </div>

            {agents.length > 0 ? (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                  gap: 12,
                }}
              >
                {agents.map((agent) => (
                  <AgentCard
                    key={agent.roleKey}
                    agent={agent}
                    selected={includedRoleKeys.has(agent.roleKey)}
                    onToggle={() => toggleAgent(agent.roleKey)}
                    connectorHealth={connectorHealth}
                    disabled={Boolean(plan.acceptedAt)}
                  />
                ))}
              </div>
            ) : (
              <p className="af2-muted">No agents in this plan.</p>
            )}
          </div>

          {selectionWarning ? (
            <p className="af2-muted" style={{ color: "var(--af2-clay)", fontSize: 13 }}>
              {selectionWarning}
            </p>
          ) : null}

          {/* UX-4: preview the starter Job Descriptions that the
              confirm flow will seed per agent. Collapsed by default so
              the page isn't dense; one click reveals all of them. */}
          {!plan.acceptedAt && (plan.starterJobDescriptions?.length ?? 0) > 0 ? (
            <JobDescriptionPreviewSection
              previews={plan.starterJobDescriptions ?? []}
            />
          ) : null}

          {/* HEL-211: post-confirm "Name your team" rename slider. Renders
              after the confirm call succeeds; Skip / Continue both
              transition into the "confirmed" callout below. */}
          {pageState === "renaming" || pageState === "savingNames" ? (
            <NameYourTeamStep
              pendingRenames={pendingRenames}
              onChangeRename={updatePendingRename}
              onContinue={() => void handleSaveRenames()}
              onSkip={handleSkipRenames}
              saving={pageState === "savingNames"}
              error={renameError}
            />
          ) : null}

          {/* Confirm / confirmed state */}
          {pageState === "confirmed" || plan.acceptedAt ? (
            <div
              className="af2-card"
              style={{
                padding: "18px 22px",
                display: "flex",
                alignItems: "center",
                gap: 12,
                borderColor: "rgba(74,107,74,0.4)",
                background: "rgba(74,107,74,0.06)",
              }}
            >
              <CheckCircle2 size={20} style={{ color: "var(--af2-sage)", flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <p style={{ fontWeight: 600, fontSize: 14 }}>Plan confirmed</p>
                <p className="af2-muted" style={{ marginTop: 2, fontSize: 13 }}>
                  {agents.length} agent{agents.length !== 1 ? "s" : ""} provisioned. The org chart
                  on the{" "}
                  <Link to="/workspace/org-structure" style={{ color: "var(--af2-sage)" }}>
                    Team page
                  </Link>{" "}
                  will reflect the new graph.
                </p>
                {seededRoutines.length > 0 ? (
                  <SeededRoutinesCallout seededRoutines={seededRoutines} />
                ) : null}
              </div>
            </div>
          ) : pageState === "renaming" || pageState === "savingNames" ? null : (
            <div className="af2-card" style={{ padding: "18px 22px" }}>
              <p style={{ fontSize: 14, color: "var(--af2-ink-2)", marginBottom: 14 }}>
                Confirming will provision {selectedCount} selected agent
                {selectedCount !== 1 ? "s" : ""} and wire up the reporting structure. This cannot
                be undone from this screen.
              </p>
              <div className="af2-row" style={{ gap: 10 }}>
                <button
                  type="button"
                  onClick={() => setDiscardOpen(true)}
                  disabled={
                    pageState === "confirming" || pageState === "discarding"
                  }
                  className="af2-btn af2-btn-ghost"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    color: "var(--af2-clay)",
                    cursor:
                      pageState === "discarding" ? "wait" : "pointer",
                  }}
                  title="Discard this draft and the mission it belongs to"
                >
                  {pageState === "discarding" ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Trash2 size={14} />
                  )}
                  {pageState === "discarding" ? "Discarding…" : "Discard draft"}
                </button>
                <span className="af2-spacer" />
                <button
                  type="button"
                  onClick={() => void navigate("/hire")}
                  className="af2-btn af2-btn-ghost"
                  disabled={
                    pageState === "confirming" || pageState === "discarding"
                  }
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleConfirm()}
                  disabled={
                    pageState === "confirming" ||
                    pageState === "discarding" ||
                    selectedCount === 0
                  }
                  className="af2-btn af2-btn-clay"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    opacity: pageState === "confirming" ? 0.7 : 1,
                    cursor: pageState === "confirming" ? "not-allowed" : "pointer",
                  }}
                >
                  {pageState === "confirming" ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : null}
                  {pageState === "confirming" ? "Provisioning…" : "Confirm & provision agents →"}
                </button>
              </div>
            </div>
          )}
        </>
      ) : null}

      <ConfirmDestructiveModal
        open={discardOpen}
        onClose={() => setDiscardOpen(false)}
        eyebrow="Discard draft"
        title="Discard this draft?"
        message="Discard this draft and the mission it belongs to? This can't be undone."
        confirmLabel="Discard draft"
        confirming={pageState === "discarding"}
        onConfirm={() => void handleDiscard()}
      />
    </div>
  );
}

/**
 * HEL-211 — "Name your team" step that follows the Confirm CTA.
 *
 * Renders one row per provisioned agent: a circular initial avatar,
 * the freeform display-name input (placeholder shows the role title),
 * and a muted role label. Continue PATCHes `display_name` for each
 * non-empty value; Skip jumps straight to the confirmed callout.
 *
 * Kept inline (no separate file) since it's only used here and reuses
 * the page's af2-card chrome.
 */
function NameYourTeamStep({
  pendingRenames,
  onChangeRename,
  onContinue,
  onSkip,
  saving,
  error,
}: {
  pendingRenames: PendingRename[];
  onChangeRename: (agentId: string, displayName: string) => void;
  onContinue: () => void;
  onSkip: () => void;
  saving: boolean;
  error: string | null;
}) {
  const filledCount = pendingRenames.filter(
    (row) => row.displayName.trim().length > 0,
  ).length;
  return (
    <div
      className="af2-card"
      style={{
        padding: "18px 22px",
        borderColor: "rgba(74,107,74,0.30)",
        background: "rgba(74,107,74,0.04)",
        marginBottom: 16,
      }}
    >
      {/* Simple two-dot horizontal stepper mirroring the v2 prototype's
          plan→rename pattern. */}
      <div
        className="af2-row"
        style={{ gap: 10, alignItems: "center", marginBottom: 12 }}
      >
        <StepDot label="Plan reviewed" complete />
        <span
          aria-hidden
          style={{
            flex: "0 0 24px",
            height: 1,
            background: "var(--af2-line-2)",
          }}
        />
        <StepDot label="Name your team" active />
      </div>

      <div className="af2-eyebrow" style={{ marginBottom: 6 }}>
        Step 2 · Name your team
      </div>
      <h2 className="af2-h2 font-af2-serif" style={{ margin: 0 }}>
        Give your agents a friendlier handle.
      </h2>
      <p className="af2-muted" style={{ marginTop: 6, fontSize: 13, lineHeight: 1.55 }}>
        Optional — names show up in the org list and activity feed. Skip this
        step to keep the role titles AutoFlow generated.
      </p>

      {error ? (
        <div
          role="alert"
          style={{
            marginTop: 12,
            padding: "8px 12px",
            borderRadius: "var(--af2-radius)",
            border: "1px solid rgba(194,80,43,0.3)",
            background: "rgba(194,80,43,0.10)",
            color: "var(--af2-clay)",
            fontSize: 12.5,
          }}
        >
          {error}
        </div>
      ) : null}

      <div
        style={{
          marginTop: 14,
          display: "grid",
          gap: 8,
        }}
      >
        {pendingRenames.map((row) => (
          <RenameRow
            key={row.agentId}
            row={row}
            onChange={(value) => onChangeRename(row.agentId, value)}
            disabled={saving}
          />
        ))}
      </div>

      <div
        className="af2-row"
        style={{ gap: 10, marginTop: 16, alignItems: "center" }}
      >
        <span className="af2-muted-2 af2-mono" style={{ fontSize: 11 }}>
          {filledCount} of {pendingRenames.length} renamed
        </span>
        <span className="af2-spacer" />
        <button
          type="button"
          className="af2-btn af2-btn-ghost"
          onClick={onSkip}
          disabled={saving}
        >
          Skip
        </button>
        <button
          type="button"
          className="af2-btn af2-btn-clay"
          onClick={onContinue}
          disabled={saving}
          style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          {saving ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <ArrowRight size={14} />
          )}
          {saving ? "Saving names…" : "Continue"}
        </button>
      </div>
    </div>
  );
}

function StepDot({
  label,
  active,
  complete,
}: {
  label: string;
  active?: boolean;
  complete?: boolean;
}) {
  const color = complete
    ? "var(--af2-sage)"
    : active
      ? "var(--af2-clay)"
      : "var(--af2-ink-3)";
  return (
    <span
      className="af2-row"
      style={{ gap: 6, alignItems: "center", fontSize: 11 }}
    >
      <span
        aria-hidden
        style={{
          display: "inline-block",
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: color,
        }}
      />
      <span
        style={{
          color: active || complete ? "var(--af2-ink)" : "var(--af2-ink-3)",
          fontWeight: active ? 600 : 400,
        }}
      >
        {label}
      </span>
    </span>
  );
}

function RenameRow({
  row,
  onChange,
  disabled,
}: {
  row: PendingRename;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const initial = (row.agentName || row.roleTitle || "?")
    .trim()
    .charAt(0)
    .toUpperCase();
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "32px minmax(0, 1fr) minmax(0, 1fr)",
        alignItems: "center",
        gap: 12,
        padding: "10px 12px",
        borderRadius: 8,
        border: "1px solid var(--af2-line-2)",
        background: "var(--af2-card)",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 32,
          height: 32,
          borderRadius: "50%",
          background: "var(--af2-paper-2)",
          color: "var(--af2-ink-2)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "var(--af2-serif)",
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        {initial || <UserCircle2 size={16} />}
      </span>
      <input
        type="text"
        className="af2-input"
        value={row.displayName}
        onChange={(e) => onChange(e.target.value)}
        placeholder={row.roleTitle}
        disabled={disabled}
        maxLength={120}
        aria-label={`Display name for ${row.roleTitle}`}
        style={{ width: "100%", fontSize: 14 }}
      />
      <span
        className="af2-muted"
        style={{ fontSize: 12, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}
        title={row.roleTitle}
      >
        {row.roleTitle}
      </span>
    </div>
  );
}

/**
 * Collapsible preview of the starter Job Descriptions the confirm flow
 * will seed per agent (Wave 6). Collapsed by default so the review
 * page isn't dense; one click reveals all of them stacked.
 */
function JobDescriptionPreviewSection({
  previews,
}: {
  previews: StarterJobDescription[];
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      className="af2-card"
      style={{
        padding: "14px 18px",
        marginTop: 12,
        borderColor: "rgba(74,107,74,0.25)",
        background: "rgba(74,107,74,0.04)",
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          background: "transparent",
          border: "none",
          padding: 0,
          cursor: "pointer",
          color: "var(--af2-ink)",
          fontSize: 14,
          fontFamily: "var(--af2-serif, ui-serif, Georgia, serif)",
        }}
      >
        <Sparkles size={14} style={{ color: "var(--af2-sage)" }} />
        <span style={{ fontWeight: 600 }}>
          {expanded ? "Hide" : "Preview"} the job descriptions we'll seed for these{" "}
          {previews.length} agent{previews.length === 1 ? "" : "s"}
        </span>
        {expanded ? (
          <ChevronUp size={14} style={{ marginLeft: "auto", color: "var(--af2-muted)" }} />
        ) : (
          <ChevronDown size={14} style={{ marginLeft: "auto", color: "var(--af2-muted)" }} />
        )}
      </button>
      {expanded ? (
        <div style={{ marginTop: 14, display: "grid", gap: 14 }}>
          <p
            className="af2-muted"
            style={{ fontSize: 12, lineHeight: 1.5, margin: 0 }}
          >
            Each agent will arrive with this starter persona. You can edit or
            re-draft any of them via the wizard on the agent's Job description
            page after confirming.
          </p>
          {previews.map((preview) => (
            <PreviewBlock key={preview.agentRoleKey} preview={preview} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PreviewBlock({ preview }: { preview: StarterJobDescription }) {
  return (
    <div
      style={{
        padding: 12,
        borderRadius: 8,
        border: "1px solid var(--af2-line)",
        background: "var(--af2-card)",
      }}
    >
      <div
        className="af2-eyebrow"
        style={{ marginBottom: 8, color: "var(--af2-ink-2)" }}
      >
        {preview.agentTitle}
      </div>
      <pre
        style={{
          margin: 0,
          padding: 10,
          fontSize: 12,
          lineHeight: 1.6,
          fontFamily: "var(--af2-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
          background: "var(--af2-paper-2)",
          border: "1px solid var(--af2-line-2)",
          borderRadius: 6,
          whiteSpace: "pre-wrap",
          color: "var(--af2-ink)",
          maxHeight: 320,
          overflow: "auto",
        }}
      >
        {preview.body}
      </pre>
    </div>
  );
}

/**
 * HEL-154: post-confirm callout listing the prompt-backed routines the
 * backend seeded for each provisioned agent. Each row deep-links to
 * `/agents/:id/standing-tasks` where the owner can refine the prompt,
 * change the cron, or upgrade to a DAG routine in Studio.
 */
function SeededRoutinesCallout({
  seededRoutines,
}: {
  seededRoutines: Array<{
    agentId: string;
    agentName: string;
    routineId: string;
    routineName: string;
  }>;
}) {
  return (
    <div style={{ marginTop: 14, display: "grid", gap: 8 }}>
      <div className="af2-eyebrow">Default routines created</div>
      <p
        className="af2-muted"
        style={{ marginTop: -4, marginBottom: 4, fontSize: 12.5 }}
      >
        Every agent has a weekday morning check-in. Refine the prompt or change
        the schedule on each agent's standing tasks.
      </p>
      {seededRoutines.map((row) => (
        <div
          key={row.routineId}
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 8,
            padding: "8px 10px",
            borderRadius: 8,
            border: "1px solid rgba(74,107,74,0.18)",
            background: "rgba(255,255,255,0.55)",
          }}
        >
          <span
            style={{ flex: "1 1 220px", fontSize: 12.5, color: "var(--af2-ink-2)" }}
          >
            <strong style={{ color: "var(--af2-ink)" }}>{row.agentName}</strong>
            {" — "}
            {row.routineName}
          </span>
          <Link
            to={`/agents/${encodeURIComponent(row.agentId)}/standing-tasks`}
            className="af2-btn af2-btn-sm af2-btn-clay"
            style={{ textDecoration: "none" }}
          >
            View routines
          </Link>
        </div>
      ))}
    </div>
  );
}
