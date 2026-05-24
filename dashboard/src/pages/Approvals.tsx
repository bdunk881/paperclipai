/**
 * Approvals — v2 editorial governance board with merged Escalations.
 *
 * HEL-204 PR A: merges the old Approvals (action sign-offs) + Escalations
 * (Ask-the-CEO) surfaces into a single tabbed queue, plus a Policies sub-tab
 * that owns what used to live under Settings → Policies → Approvals.
 *
 * Sub-tabs (sync'd to ?tab=):
 *   - queue    — action approvals AND escalation cards inline
 *   - policies — approval-tier policy editor (moved from Settings)
 *   - history  — resolved approvals + previous escalations
 *
 * Each escalation card surfaces two extra actions next to Approve / Reject:
 *   - "Reply with guidance"     (open inline composer)
 *   - "Approve recommendation"  (one-click endorse the proposed action)
 *
 * Backwards compat: /escalations and /settings/approvals redirect into
 * the matching tab via the router (see dashboard/src/router.tsx).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { Loader2, MessageSquarePlus, X } from "lucide-react";
import {
  createHitlAskCeoRequest,
  getHitlCompanyState,
  resolveApproval,
  type ApprovalRequest,
  type CreateHitlAskCeoRequestInput,
  type HitlAskCeoRequest,
  type HitlCompanyState,
} from "../api/client";
import type { Agent } from "../api/agentApi";
import { ErrorState, LoadingState, SkeletonBlock } from "../components/UiStates";
import { useAuth } from "../context/AuthContext";
import { useWorkspace } from "../context/useWorkspace";
import { queryKeys } from "../lib/queryKeys";
import { useApprovalsQuery } from "../hooks/queries/useApprovalsQuery";
import { useAgentsQuery } from "../hooks/queries/useAgentsQuery";
import { AgentPresencePill } from "../components/AgentPresencePill";
import { useAgentPresence } from "../hooks/useAgentPresence";
// HEL-214 / PR J: Pro Mode actionable reveal.
import { ProReveal } from "../components/pro/ProReveal";
import { RuleDebugger } from "../components/pro/RuleDebugger";
import { trackedFetch } from "../api/trackedFetch";
import { getApiBasePath } from "../api/baseUrl";

type TabKey = "queue" | "policies" | "history";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "queue", label: "Queue" },
  { key: "policies", label: "Policies" },
  { key: "history", label: "History" },
];

// -- Approvals-policy types (mirrors src/approvals/policyTypes.ts) ------------

type ApprovalTierActionType =
  | "spend_above_threshold"
  | "contracts"
  | "public_posts"
  | "customer_facing_comms"
  | "code_merges_to_prod";

type ApprovalTierMode = "auto_approve" | "notify_only" | "require_approval";

interface ApprovalPolicy {
  id: string;
  workspaceId: string;
  actionType: ApprovalTierActionType;
  mode: ApprovalTierMode;
  spendThresholdCents?: number;
  createdAt: string;
  updatedAt: string;
}

interface ApprovalPoliciesResponse {
  policies: ApprovalPolicy[];
  actionTypes: ApprovalTierActionType[];
  modes: ApprovalTierMode[];
  total: number;
}

const ACTION_LABEL: Record<ApprovalTierActionType, string> = {
  spend_above_threshold: "Spend above threshold",
  contracts: "Contracts",
  public_posts: "Public posts",
  customer_facing_comms: "Customer-facing comms",
  code_merges_to_prod: "Production deploys",
};

const MODE_LABEL: Record<ApprovalTierMode, string> = {
  auto_approve: "Auto-approve",
  notify_only: "Notify only, no human required",
  require_approval: "Always require human",
};

function formatSpend(cents?: number): string {
  if (cents == null || !Number.isFinite(cents) || cents <= 0) return "any spend";
  const dollars = cents / 100;
  return dollars >= 1000
    ? `$${(dollars / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })}k`
    : `$${dollars.toLocaleString()}`;
}

function policyKeyText(policy: ApprovalPolicy): string {
  if (policy.actionType === "spend_above_threshold") {
    const label = formatSpend(policy.spendThresholdCents);
    return label === "any spend" ? "Spend (any amount)" : `Spend over ${label}`;
  }
  return ACTION_LABEL[policy.actionType];
}

function policyValueText(policy: ApprovalPolicy): string {
  if (policy.actionType === "spend_above_threshold") {
    const formatted = formatSpend(policy.spendThresholdCents);
    return formatted === "any spend"
      ? `${MODE_LABEL[policy.mode]} on any spend`
      : `${MODE_LABEL[policy.mode]} for spend over ${formatted}`;
  }
  return MODE_LABEL[policy.mode];
}

// -- Helpers ------------------------------------------------------------------

function initialsFor(name: string | undefined | null): string {
  if (!name) return "—";
  const first = name.trim().split(/\s+/)[0];
  return first?.[0]?.toUpperCase() ?? "—";
}

function firstName(name: string | undefined | null): string {
  if (!name) return "—";
  return name.trim().split(/\s+/)[0] ?? "—";
}

function riskForTimeout(timeoutMinutes: number): {
  label: "high" | "medium" | "low";
  color: string;
} {
  if (timeoutMinutes <= 15) return { label: "high", color: "var(--af2-clay)" };
  if (timeoutMinutes <= 60) return { label: "medium", color: "var(--af2-mustard)" };
  return { label: "low", color: "var(--af2-sage)" };
}

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

const GRID_TEMPLATE = "90px 1.4fr 130px 80px 100px 130px";

// -- Page ---------------------------------------------------------------------

export default function Approvals() {
  const { requireAccessToken } = useAuth();
  const { activeWorkspaceId } = useWorkspace();
  const queryClient = useQueryClient();
  const presence = useAgentPresence();
  const approvalsQuery = useApprovalsQuery();
  const agentsQuery = useAgentsQuery();
  const approvals = approvalsQuery.data ?? [];
  const agents = agentsQuery.data ?? [];
  const loading = approvalsQuery.isLoading && !approvalsQuery.data;
  const [error, setError] = useState<string | null>(
    approvalsQuery.error instanceof Error ? approvalsQuery.error.message : null,
  );
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const isRefreshing =
    (approvalsQuery.isFetching || agentsQuery.isFetching) && Boolean(approvalsQuery.data);

  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = (searchParams.get("tab") as TabKey | null) ?? "queue";
  const [tab, setTab] = useState<TabKey>(
    TABS.some((t) => t.key === initialTab) ? initialTab : "queue",
  );

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (tab === "queue") {
      next.delete("tab");
    } else {
      next.set("tab", tab);
    }
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // Escalations: backed by HITL company state. companyId = workspaceId.
  const companyId = activeWorkspaceId ?? null;
  const [companyState, setCompanyState] = useState<HitlCompanyState | null>(null);
  const [escalationsLoading, setEscalationsLoading] = useState(true);
  const [escalationsError, setEscalationsError] = useState<string | null>(null);
  const [newEscalationOpen, setNewEscalationOpen] = useState(false);

  const loadEscalations = useCallback(async () => {
    if (!companyId) {
      setEscalationsLoading(false);
      return;
    }
    try {
      setEscalationsLoading(true);
      setEscalationsError(null);
      const accessToken = await requireAccessToken();
      const state = await getHitlCompanyState(companyId, accessToken);
      setCompanyState(state);
    } catch (err) {
      setEscalationsError(
        err instanceof Error ? err.message : "Failed to load escalations",
      );
    } finally {
      setEscalationsLoading(false);
    }
  }, [companyId, requireAccessToken]);

  useEffect(() => {
    void loadEscalations();
  }, [loadEscalations]);

  const escalations = useMemo(
    () =>
      (companyState?.askCeoRequests ?? [])
        .slice()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [companyState],
  );

  // Name → agent map for presence lookup.
  const agentByName = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const a of agents) {
      const key = a.name.trim().toLowerCase();
      if (!map.has(key)) map.set(key, a);
    }
    return map;
  }, [agents]);

  const pending = useMemo(
    () => approvals.filter((approval) => approval.status === "pending"),
    [approvals],
  );

  const history = useMemo(
    () => approvals.filter((approval) => approval.status !== "pending"),
    [approvals],
  );

  async function handleResolve(
    approval: ApprovalRequest,
    decision: "approved" | "rejected",
  ) {
    setResolvingId(approval.id);
    setError(null);
    try {
      const accessToken = await requireAccessToken();
      await resolveApproval(approval.id, decision, accessToken);
      if (activeWorkspaceId) {
        await queryClient.invalidateQueries({
          queryKey: queryKeys.approvals(activeWorkspaceId),
        });
        await queryClient.invalidateQueries({
          queryKey: queryKeys.home(activeWorkspaceId),
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resolve approval");
    } finally {
      setResolvingId(null);
    }
  }

  return (
    <div className="af2-page">
      <div className="af2-page-head">
        <div>
          <div className="af2-eyebrow">Governance · Board</div>
          <h1 className="af2-h1" style={{ marginTop: 6 }}>
            Approvals
          </h1>
          <div className="af2-page-head-meta">
            {loading ? (
              <SkeletonBlock lines={1} />
            ) : (
              <>
                {pending.length} {pending.length === 1 ? "assignment" : "assignments"} waiting ·{" "}
                {escalations.length} escalation{escalations.length === 1 ? "" : "s"} on record.
                {isRefreshing ? (
                  <span className="af2-muted-2" style={{ marginLeft: 8 }}>
                    · Updating…
                  </span>
                ) : null}
              </>
            )}
          </div>
        </div>
        <div className="af2-page-actions">
          <Link
            to="/agents/activity"
            className="af2-btn"
            style={{ textDecoration: "none" }}
          >
            Audit log
          </Link>
          <button
            type="button"
            onClick={() => setNewEscalationOpen(true)}
            className="af2-btn af2-btn-primary"
            disabled={!companyId}
          >
            <MessageSquarePlus size={14} style={{ marginRight: 6 }} />
            New escalation
          </button>
        </div>
      </div>

      <div className="af2-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`af2-tab${tab === t.key ? " active" : ""}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "queue" ? (
        <QueueTab
          pending={pending}
          escalations={escalations}
          escalationsLoading={escalationsLoading}
          escalationsError={escalationsError}
          resolvingId={resolvingId}
          handleResolve={handleResolve}
          agents={agents}
          agentByName={agentByName}
          presence={presence}
          loading={loading}
          error={error}
          onRetry={() => void approvalsQuery.refetch()}
        />
      ) : tab === "policies" ? (
        <PoliciesTab />
      ) : (
        <HistoryTab history={history} escalations={escalations} />
      )}

      {newEscalationOpen && companyId ? (
        <NewEscalationModal
          companyId={companyId}
          onClose={() => setNewEscalationOpen(false)}
          onCreated={() => {
            setNewEscalationOpen(false);
            void loadEscalations();
          }}
        />
      ) : null}
      <ProReveal
        label="Rule debugger"
        description="Dry-run a policy against a synthetic payload."
      >
        <RuleDebugger />
      </ProReveal>
    </div>
  );
}

// -- Queue tab ---------------------------------------------------------------

interface QueueTabProps {
  pending: ApprovalRequest[];
  escalations: HitlAskCeoRequest[];
  escalationsLoading: boolean;
  escalationsError: string | null;
  resolvingId: string | null;
  handleResolve: (approval: ApprovalRequest, decision: "approved" | "rejected") => Promise<void>;
  agents: Agent[];
  agentByName: Map<string, Agent>;
  presence: ReturnType<typeof useAgentPresence>;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

function QueueTab({
  pending,
  escalations,
  escalationsLoading,
  escalationsError,
  resolvingId,
  handleResolve,
  agents,
  agentByName,
  presence,
  loading,
  error,
  onRetry,
}: QueueTabProps) {
  if (loading && pending.length === 0) {
    return (
      <div className="af2-card" style={{ padding: 24 }}>
        <SkeletonBlock lines={4} />
      </div>
    );
  }

  if (error && pending.length === 0) {
    return (
      <ErrorState title="Approvals unavailable" message={error} onRetry={onRetry} />
    );
  }

  const isEmpty =
    pending.length === 0 && escalations.length === 0 && !escalationsLoading;

  return (
    <>
      {error ? (
        <div style={{ marginBottom: 16 }}>
          <ErrorState title="Resolve failed" message={error} onRetry={onRetry} />
        </div>
      ) : null}

      {isEmpty ? (
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
            ✓ All clear — no approvals or escalations waiting.
          </p>
          <p
            className="af2-muted"
            style={{ fontSize: 13, marginTop: 8, lineHeight: 1.5 }}
          >
            When an agent needs your stamp on a spend, contract, or
            customer-facing action — or when a CEO-level question is filed —
            it'll appear here.
          </p>
          <div
            style={{
              marginTop: 14,
              display: "inline-flex",
              gap: 10,
              alignItems: "center",
            }}
          >
            <Link to="/agents/activity" className="af2-btn af2-btn-ghost">
              Open Activity →
            </Link>
            <Link to="/assignments" className="af2-btn af2-btn-ghost">
              See mission assignments →
            </Link>
          </div>
        </div>
      ) : (
        <>
          {pending.length > 0 ? (
            <div className="af2-list" style={{ marginBottom: 18 }}>
              <div
                className="af2-list-head"
                style={{ gridTemplateColumns: GRID_TEMPLATE }}
              >
                <div>Assignment</div>
                <div>Request</div>
                <div>Agent</div>
                <div>Risk</div>
                <div>Cost</div>
                <div></div>
              </div>
              {pending.map((approval) => {
                const risk = riskForTimeout(approval.timeoutMinutes);
                const isResolving = resolvingId === approval.id;
                return (
                  <div
                    key={approval.id}
                    className="af2-list-row"
                    style={{ gridTemplateColumns: GRID_TEMPLATE }}
                  >
                    <div
                      className="af2-mono"
                      style={{ fontSize: 11.5, color: "var(--af2-ink-3)" }}
                    >
                      {approval.id.slice(0, 8).toUpperCase()}
                    </div>
                    <div style={{ fontSize: 13.5 }}>
                      {approval.message ?? approval.stepName}
                    </div>
                    <div className="af2-row" style={{ gap: 8 }}>
                      <div
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: 24,
                          height: 24,
                          borderRadius: "50%",
                          background: "var(--af2-clay-soft)",
                          color: "var(--af2-clay-2)",
                          fontSize: 11,
                          fontWeight: 700,
                        }}
                      >
                        {initialsFor(approval.assignee)}
                      </div>
                      <span
                        style={{
                          fontSize: 12.5,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          minWidth: 0,
                          flexWrap: "wrap",
                        }}
                      >
                        {firstName(approval.assignee)}
                        {(() => {
                          const matchedById = approval.agentId
                            ? agents.find((a) => a.id === approval.agentId) ?? null
                            : null;
                          const matched =
                            matchedById ??
                            agentByName.get(approval.assignee.trim().toLowerCase()) ??
                            null;
                          if (!matched) return null;
                          return (
                            <AgentPresencePill presence={presence.get(matched.id)} />
                          );
                        })()}
                      </span>
                    </div>
                    <div>
                      <span
                        className="af2-mono"
                        style={{ fontSize: 11.5, color: risk.color }}
                      >
                        ● {risk.label}
                      </span>
                    </div>
                    <div className="af2-mono" style={{ fontSize: 12 }}>
                      —
                    </div>
                    <div
                      className="af2-row"
                      style={{ gap: 6, justifyContent: "flex-end" }}
                    >
                      <button
                        type="button"
                        onClick={() => void handleResolve(approval, "rejected")}
                        disabled={isResolving}
                        className="af2-btn af2-btn-sm"
                      >
                        Reject
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleResolve(approval, "approved")}
                        disabled={isResolving}
                        className="af2-btn af2-btn-sm af2-btn-primary"
                      >
                        Approve
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}

          {escalationsError ? (
            <div style={{ marginBottom: 16 }}>
              <ErrorState
                title="Escalations unavailable"
                message={escalationsError}
              />
            </div>
          ) : null}

          {escalations.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div className="af2-eyebrow">Escalations · Ask the CEO</div>
              {escalations.map((request) => (
                <EscalationCard key={request.id} request={request} />
              ))}
            </div>
          ) : escalationsLoading ? (
            <LoadingState label="Loading escalations…" />
          ) : null}
        </>
      )}
    </>
  );
}

// -- Escalation card (preserved from former Escalations.tsx) -----------------

export function EscalationCard({ request }: { request: HitlAskCeoRequest }) {
  const [composerOpen, setComposerOpen] = useState(false);
  const [reply, setReply] = useState("");
  const [pendingAction, setPendingAction] = useState<null | "guidance" | "recommendation">(
    null,
  );
  const [feedback, setFeedback] = useState<string | null>(null);

  function handleApproveRecommendation() {
    // Scaffold-level: would POST an endorsement back to HITL once wired.
    setPendingAction("recommendation");
    setTimeout(() => {
      setPendingAction(null);
      setFeedback("Recommendation endorsed.");
    }, 200);
  }

  function handleSendGuidance() {
    if (!reply.trim()) return;
    setPendingAction("guidance");
    setTimeout(() => {
      setPendingAction(null);
      setComposerOpen(false);
      setReply("");
      setFeedback("Guidance sent to the requester.");
    }, 200);
  }

  return (
    <article
      className="af2-card"
      style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}
    >
      <div className="af2-row" style={{ alignItems: "flex-start", gap: 14 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="af2-eyebrow" style={{ marginBottom: 4 }}>
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

      {request.response.recommendedActions.length > 0 ? (
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
      ) : null}

      {request.response.citedEntities.length > 0 ? (
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
      ) : null}

      {composerOpen ? (
        <div
          style={{
            borderTop: "1px solid var(--af2-line)",
            paddingTop: 12,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <label
            htmlFor={`escalation-${request.id}-reply`}
            className="af2-eyebrow"
          >
            Guidance
          </label>
          <textarea
            id={`escalation-${request.id}-reply`}
            value={reply}
            onChange={(event) => setReply(event.target.value)}
            rows={4}
            className="af2-input"
            placeholder="What direction does the team need from the CEO?"
          />
          <div className="af2-row" style={{ gap: 8, justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={() => {
                setComposerOpen(false);
                setReply("");
              }}
              className="af2-btn af2-btn-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSendGuidance}
              className="af2-btn af2-btn-sm af2-btn-primary"
              disabled={!reply.trim() || pendingAction === "guidance"}
            >
              {pendingAction === "guidance" ? "Sending…" : "Send guidance"}
            </button>
          </div>
        </div>
      ) : null}

      <div
        className="af2-row"
        style={{ gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}
      >
        {feedback ? (
          <span
            className="af2-muted-2"
            style={{ marginRight: "auto", fontSize: 12 }}
          >
            {feedback}
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => setComposerOpen((open) => !open)}
          className="af2-btn af2-btn-sm"
        >
          Reply with guidance
        </button>
        <button
          type="button"
          onClick={handleApproveRecommendation}
          className="af2-btn af2-btn-sm"
          disabled={pendingAction === "recommendation"}
        >
          {pendingAction === "recommendation" ? "Endorsing…" : "Approve recommendation"}
        </button>
        <button type="button" className="af2-btn af2-btn-sm">
          Reject
        </button>
        <button type="button" className="af2-btn af2-btn-sm af2-btn-primary">
          Approve
        </button>
      </div>
    </article>
  );
}

// -- Policies tab (moved from Settings → Policies → Approvals) ---------------

function PoliciesTab() {
  const { requireAccessToken } = useAuth();
  const [policies, setPolicies] = useState<ApprovalPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingPolicy, setEditingPolicy] = useState<ApprovalPolicy | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await requireAccessToken();
      const res = await trackedFetch(`${getApiBasePath()}/approval-policies`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Failed to load policies (${res.status})`);
      const body = (await res.json()) as ApprovalPoliciesResponse;
      setPolicies(body.policies);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load policies");
    } finally {
      setLoading(false);
    }
  }, [requireAccessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <LoadingState label="Loading approval policies…" />;
  if (error)
    return (
      <ErrorState
        title="Policies unavailable"
        message={error}
        onRetry={() => void load()}
      />
    );

  return (
    <>
      <div className="af2-card" style={{ padding: 16 }}>
        {policies.length === 0 ? (
          <div className="af2-muted" style={{ fontSize: 13 }}>
            No approval policies configured yet.
          </div>
        ) : (
          policies.map((policy, i) => (
            <div
              key={policy.id}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 260px 60px",
                gap: 12,
                alignItems: "center",
                padding: "10px 0",
                borderBottom:
                  i < policies.length - 1 ? "1px solid var(--af2-line)" : "none",
              }}
            >
              <span style={{ fontSize: 13.5, fontWeight: 500 }}>
                {policyKeyText(policy)}
              </span>
              <span className="af2-muted" style={{ fontSize: 12 }}>
                {policyValueText(policy)}
              </span>
              <button
                type="button"
                onClick={() => setEditingPolicy(policy)}
                className="af2-btn af2-btn-sm"
                style={{ textAlign: "center" }}
              >
                Edit
              </button>
            </div>
          ))
        )}
      </div>

      <p className="af2-muted-2" style={{ marginTop: 14, fontSize: 12 }}>
        Tier-based rules for when a workflow run requires human sign-off.
        Changes apply to newly created approval requests.
      </p>

      {editingPolicy ? (
        <ApprovalPolicyEditor
          policy={editingPolicy}
          onClose={() => setEditingPolicy(null)}
          onSaved={(updated) => {
            setPolicies((curr) =>
              curr.map((p) => (p.actionType === updated.actionType ? updated : p)),
            );
            setEditingPolicy(null);
          }}
        />
      ) : null}
    </>
  );
}

function ApprovalPolicyEditor({
  policy,
  onClose,
  onSaved,
}: {
  policy: ApprovalPolicy;
  onClose: () => void;
  onSaved: (updated: ApprovalPolicy) => void;
}) {
  const { requireAccessToken } = useAuth();
  const [mode, setMode] = useState<ApprovalTierMode>(policy.mode);
  const [spendDollars, setSpendDollars] = useState<string>(
    policy.actionType === "spend_above_threshold" && policy.spendThresholdCents != null
      ? String(policy.spendThresholdCents / 100)
      : "500",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSpend = policy.actionType === "spend_above_threshold";

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const token = await requireAccessToken();
      const body: { mode: ApprovalTierMode; spendThresholdCents?: number } = { mode };
      if (isSpend) {
        const dollars = Number.parseFloat(spendDollars);
        if (!Number.isFinite(dollars) || dollars < 0) {
          setError("Spend threshold must be a non-negative dollar amount.");
          setSaving(false);
          return;
        }
        body.spendThresholdCents = Math.round(dollars * 100);
      }
      const res = await trackedFetch(
        `${getApiBasePath()}/approval-policies/${encodeURIComponent(policy.actionType)}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? `Failed to save policy (${res.status})`);
      }
      const { policy: updated } = (await res.json()) as { policy: ApprovalPolicy };
      onSaved(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save policy");
      setSaving(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="approval-policy-editor-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(15, 23, 42, 0.45)",
        padding: 16,
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="af2-card" style={{ padding: 22, maxWidth: 520, width: "100%" }}>
        <div className="af2-eyebrow">Edit policy</div>
        <h2 id="approval-policy-editor-title" className="af2-h3" style={{ marginTop: 6 }}>
          {policyKeyText(policy)}
        </h2>
        <p className="af2-muted" style={{ fontSize: 13, marginTop: 4, lineHeight: 1.5 }}>
          Choose how AutoFlow handles{" "}
          {ACTION_LABEL[policy.actionType].toLowerCase()} requests for this workspace.
        </p>

        <fieldset style={{ border: "none", padding: 0, margin: "16px 0 0" }}>
          <legend className="af2-eyebrow" style={{ padding: 0 }}>
            Mode
          </legend>
          {(["require_approval", "notify_only", "auto_approve"] as ApprovalTierMode[]).map(
            (option) => (
              <label
                key={option}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  marginTop: 10,
                  cursor: "pointer",
                }}
              >
                <input
                  type="radio"
                  name="approval-mode"
                  value={option}
                  checked={mode === option}
                  onChange={() => setMode(option)}
                  style={{ marginTop: 3 }}
                />
                <span style={{ fontSize: 13.5 }}>{MODE_LABEL[option]}</span>
              </label>
            ),
          )}
        </fieldset>

        {isSpend ? (
          <div style={{ marginTop: 16 }}>
            <label htmlFor="spend-threshold" className="af2-eyebrow">
              Spend threshold ($)
            </label>
            <input
              id="spend-threshold"
              className="af2-input"
              type="number"
              min="0"
              step="1"
              value={spendDollars}
              onChange={(event) => setSpendDollars(event.target.value)}
              style={{ width: "100%", marginTop: 6 }}
            />
          </div>
        ) : null}

        {error ? (
          <div
            className="af2-mono"
            style={{
              marginTop: 16,
              fontSize: 12,
              color: "var(--af2-clay)",
              padding: "8px 12px",
              background: "var(--af2-clay-soft)",
              borderRadius: 6,
            }}
          >
            {error}
          </div>
        ) : null}

        <div className="af2-row" style={{ marginTop: 22, gap: 10 }}>
          <button
            type="button"
            className="af2-btn"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <span className="af2-spacer" />
          <button
            type="button"
            className="af2-btn af2-btn-primary"
            onClick={() => void handleSave()}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save policy"}
          </button>
        </div>
      </div>
    </div>
  );
}

// -- History tab --------------------------------------------------------------

function HistoryTab({
  history,
  escalations,
}: {
  history: ApprovalRequest[];
  escalations: HitlAskCeoRequest[];
}) {
  if (history.length === 0 && escalations.length === 0) {
    return (
      <div
        className="af2-card"
        style={{
          padding: "32px 24px",
          textAlign: "center",
          borderStyle: "dashed",
          borderColor: "var(--af2-line-2)",
        }}
      >
        <p className="af2-muted" style={{ fontSize: 13 }}>
          History is empty. Resolved approvals and previous escalations land here.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {history.length > 0 ? (
        <div className="af2-list">
          <div
            className="af2-list-head"
            style={{ gridTemplateColumns: "120px 1fr 130px 120px" }}
          >
            <span>ID</span>
            <span>Request</span>
            <span>Decision</span>
            <span>Resolved</span>
          </div>
          {history.map((approval, idx) => (
            <div
              key={approval.id}
              className="af2-list-row"
              style={{
                gridTemplateColumns: "120px 1fr 130px 120px",
                borderBottom:
                  idx < history.length - 1 ? "1px solid var(--af2-line)" : "none",
              }}
            >
              <span className="af2-mono af2-muted-2" style={{ fontSize: 11 }}>
                {approval.id.slice(0, 8).toUpperCase()}
              </span>
              <span style={{ fontSize: 13 }}>
                {approval.message ?? approval.stepName}
              </span>
              <span className="af2-mono" style={{ fontSize: 12 }}>
                {approval.status}
              </span>
              <span className="af2-muted-2" style={{ fontSize: 11 }}>
                {approval.resolvedAt ? formatTimestamp(approval.resolvedAt) : "—"}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {escalations.length > 0 ? (
        <>
          <div className="af2-eyebrow">Past escalations</div>
          {escalations.map((request) => (
            <EscalationCard key={request.id} request={request} />
          ))}
        </>
      ) : null}
    </div>
  );
}

// -- New escalation modal (preserved from former Escalations.tsx) ------------

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
      const input: CreateHitlAskCeoRequestInput = { question: question.trim() };
      await createHitlAskCeoRequest(companyId, input, accessToken);
      onCreated();
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Failed to file escalation",
      );
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
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-af2-clay">
              Governance · Ask the CEO
            </p>
            <h2
              id="new-escalation-title"
              className="font-af2-serif mt-2 text-xl font-medium text-af2-ink"
            >
              File an escalation
            </h2>
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

          {submitError ? (
            <div className="rounded-md border border-af2-clay/40 bg-af2-clay/10 px-3 py-2 text-sm text-af2-clay">
              {submitError}
            </div>
          ) : null}

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
              {submitting ? (
                <Loader2 size={14} className="animate-spin" style={{ marginRight: 6 }} />
              ) : null}
              File escalation
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
