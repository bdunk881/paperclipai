/**
 * Approvals — v2 editorial governance board with merged Escalations.
 *
 * Ported to the af2-v2 shell (docs/design/v2/preview/consolidation.html
 * lines 306-477). Tabs: Queue (5) / Policies / History.
 *
 * Queue merges action approvals and HITL Ask-the-CEO escalations into a
 * single row-list; each row has an inline drawer that expands with details
 * and approve/reject actions. Policies tab is a grid-2 of policy cards.
 * History is a card-list of past resolutions.
 *
 * Backwards compat: /escalations and /settings/approvals redirect into
 * the matching tab via the router (see dashboard/src/router.tsx).
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Loader2, X } from "lucide-react";
import {
  createHitlAskCeoRequest,
  getHitlCompanyState,
  resolveApproval,
  type ApprovalRequest,
  type CreateHitlAskCeoRequestInput,
  type HitlCompanyState,
} from "../api/client";
import { ErrorState } from "../components/UiStates";
import { useAuth } from "../context/AuthContext";
import { useWorkspace } from "../context/useWorkspace";
import { queryKeys } from "../lib/queryKeys";
import { useApprovalsQuery } from "../hooks/queries/useApprovalsQuery";
import { useAgentsQuery } from "../hooks/queries/useAgentsQuery";
import { useListKeyboardNav } from "../hooks/useListKeyboardNav";
import { useEventStream } from "../hooks/useEventStream";
import { KeyboardShortcutsOverlay } from "../components/KeyboardShortcutsOverlay";
import { trackedFetch } from "../api/trackedFetch";
import { getApiBasePath } from "../api/baseUrl";

type TabKey = "queue" | "policies" | "history";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "queue", label: "Queue" },
  { key: "policies", label: "Policies" },
  { key: "history", label: "History" },
];

// HEL-217: matches `PLAN_APPROVAL_TEMPLATE_NAME` in
// src/agents/runtime/planApprovalBridge.ts. Kept inline because the
// dashboard and backend don't share a constants module today.
const PLAN_APPROVAL_TEMPLATE_NAME = "__autoflow_plan_approval__";
const PLAN_APPROVAL_MESSAGE_DELIMITER = "\n\n---ORIGINAL_PROMPT---\n\n";

interface ParsedPlanApprovalMessage {
  planText: string;
  originalPrompt: string;
}

function parsePlanApprovalMessage(message: string): ParsedPlanApprovalMessage {
  const idx = message.indexOf(PLAN_APPROVAL_MESSAGE_DELIMITER);
  if (idx === -1) {
    return { planText: message, originalPrompt: "" };
  }
  return {
    planText: message.slice(0, idx),
    originalPrompt: message.slice(idx + PLAN_APPROVAL_MESSAGE_DELIMITER.length),
  };
}

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

// -- Queue item type ----------------------------------------------------------

interface QueueItem {
  id: string;
  kind: "action" | "escalation" | "plan_approval";
  title: string;
  subtitle: string;
  tierLabel: string;
  tierTone: "clay" | "plum" | "mustard" | "sage";
  agent: string;
  drawer: {
    eyebrow: string;
    headline: string;
    body: string;
    /** For plan-mode rows: the parsed plan text rendered in a preformatted block. */
    planText?: string;
    /** For plan-mode rows: the original user prompt shown below the plan. */
    originalPrompt?: string;
    actions: Array<{ label: string; variant?: "primary" | "default" }>;
    deepLink?: string;
  };
  /** Raw approval row — present when the item came from `approvals` (action or plan_approval). */
  rawApproval?: ApprovalRequest;
}

// -- Helpers ------------------------------------------------------------------

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

const QUEUE_GRID = "90px 1fr 130px 130px 200px";

function exportQueueCsv(items: QueueItem[]) {
  const header = ["id", "kind", "agent", "title", "subtitle"];
  const escape = (v: string) =>
    /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  const rows = [header.join(",")];
  for (const item of items) {
    rows.push(
      [item.id, item.kind, item.agent, item.title, item.subtitle]
        .map((v) => escape(String(v ?? "")))
        .join(","),
    );
  }
  const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `approvals-queue-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// -- Page ---------------------------------------------------------------------

export default function Approvals() {
  const { requireAccessToken } = useAuth();
  const { activeWorkspaceId } = useWorkspace();
  const queryClient = useQueryClient();
  const approvalsQuery = useApprovalsQuery();
  const agentsQuery = useAgentsQuery();
  const approvals = approvalsQuery.data ?? [];
  const [error, setError] = useState<string | null>(
    approvalsQuery.error instanceof Error ? approvalsQuery.error.message : null,
  );

  // Live SSE — invalidate the approvals query whenever the workspace
  // emits an activity event. The approvals snapshot picks up the new
  // pending/resolved state on the next fetch without polling.
  useEventStream(activeWorkspaceId ? "/api/activity-events/stream" : null, {
    onMessage: () => {
      if (!activeWorkspaceId) return;
      void queryClient.invalidateQueries({
        queryKey: queryKeys.approvals(activeWorkspaceId),
      });
    },
  });
  const [resolvingId, setResolvingId] = useState<string | null>(null);

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
  const [escalationsError, setEscalationsError] = useState<string | null>(null);
  const [newEscalationOpen, setNewEscalationOpen] = useState(false);
  const [policyRefreshTick, setPolicyRefreshTick] = useState(0);

  const loadEscalations = useCallback(async () => {
    if (!companyId) return;
    try {
      setEscalationsError(null);
      const accessToken = await requireAccessToken();
      const state = await getHitlCompanyState(companyId, accessToken);
      setCompanyState(state);
    } catch (err) {
      setEscalationsError(
        err instanceof Error ? err.message : "Failed to load escalations",
      );
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

  const pending = useMemo(
    () => approvals.filter((approval) => approval.status === "pending"),
    [approvals],
  );

  const history = useMemo(
    () => approvals.filter((approval) => approval.status !== "pending"),
    [approvals],
  );

  // Merge pending approvals + escalations into one queue.
  const queueItems: QueueItem[] = useMemo(() => {
    const fromApprovals: QueueItem[] = pending.map((approval) => {
      const isPlanApproval = approval.templateName === PLAN_APPROVAL_TEMPLATE_NAME;
      if (isPlanApproval) {
        // HEL-217: plan-mode approval rows carry the plan text + the
        // original prompt encoded in `message` with a delimiter. Render
        // the plan as the headline content and surface the original
        // prompt in the drawer body so reviewers can sanity-check the
        // plan against what the user asked for.
        const { planText, originalPrompt } = parsePlanApprovalMessage(
          approval.message,
        );
        return {
          id: approval.id.slice(0, 8).toUpperCase(),
          kind: "plan_approval",
          title: approval.stepName,
          subtitle: `Plan approval · ${approval.assignee}`,
          tierLabel: "plan",
          tierTone: "mustard",
          agent: approval.assignee,
          drawer: {
            eyebrow: "Plan approval · agent paused for review",
            headline: approval.stepName,
            body: "The agent produced this plan and stopped before executing any tools. Approve to let it replay with execution enabled, or reject to keep it paused.",
            planText,
            originalPrompt,
            actions: [
              { label: "Approve plan", variant: "primary" },
              { label: "Reject" },
            ],
          },
          rawApproval: approval,
        };
      }
      return {
        id: approval.id.slice(0, 8).toUpperCase(),
        kind: "action",
        title: approval.message || approval.stepName,
        subtitle: `${approval.templateName} · ${approval.assignee}`,
        tierLabel: "action",
        tierTone: "clay",
        agent: approval.assignee,
        drawer: {
          eyebrow: "Action approval",
          headline: approval.message || approval.stepName,
          body: `Run ${approval.runId} · step ${approval.stepName} · timeout ${approval.timeoutMinutes}m.`,
          actions: [
            { label: "Approve", variant: "primary" },
            { label: "Reject" },
          ],
        },
        rawApproval: approval,
      };
    });
    const fromEscalations: QueueItem[] = escalations.map((req) => ({
      id: req.id.slice(0, 8).toUpperCase(),
      kind: "escalation",
      title: req.question,
      subtitle: `Escalation · ${formatTimestamp(req.createdAt)}`,
      tierLabel: "escalation",
      tierTone: "plum",
      agent: "—",
      drawer: {
        eyebrow: "Escalation · governance",
        headline: req.question,
        body: req.response.summary,
        actions: [
          { label: "Approve recommendation", variant: "primary" },
          { label: "Reply with guidance" },
          { label: "Reject" },
        ],
      },
    }));
    return [...fromEscalations, ...fromApprovals];
  }, [pending, escalations]);

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

  // agentsQuery is fetched here so the page reuses the cached agents
  // when other components ask. Read-through only.
  void agentsQuery;

  const queueCount = queueItems.length;

  return (
    <div className="af2-v2">
      <div className="af2-page">
        <div className="page-head">
          <div className="page-head-left">
            <h1 className="h1">Approvals</h1>
            <div className="meta">{queueCount} open</div>
          </div>
          <div className="page-head-right">
            <button
              type="button"
              className="btn"
              onClick={() => exportQueueCsv(queueItems)}
              disabled={queueItems.length === 0}
              title={
                queueItems.length === 0
                  ? "Nothing to export yet"
                  : "Download the current queue as CSV"
              }
            >
              Export
            </button>
            {tab !== "policies" ? (
              <button
                type="button"
                className="btn primary"
                onClick={() => setNewEscalationOpen(true)}
                disabled={!companyId}
              >
                + Ask the team
              </button>
            ) : null}
          </div>
        </div>

        <div className="tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              className="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
            >
              {t.label}
              {t.key === "queue" ? (
                <span className="pill clay" style={{ marginLeft: 6 }}>
                  {queueCount}
                </span>
              ) : null}
            </button>
          ))}
        </div>

        <div className="panel" hidden={tab !== "queue"}>
          <QueueTab
            items={queueItems}
            resolvingId={resolvingId}
            onResolve={handleResolve}
          />
          {error ? (
            <div style={{ marginTop: 14 }}>
              <ErrorState
                title="Resolve failed"
                message={error}
                onRetry={() => void approvalsQuery.refetch()}
              />
            </div>
          ) : null}
          {escalationsError ? (
            <div style={{ marginTop: 14 }}>
              <ErrorState title="Escalations unavailable" message={escalationsError} />
            </div>
          ) : null}
        </div>

        <div className="panel" hidden={tab !== "policies"}>
          <PoliciesTab
            refreshTick={policyRefreshTick}
            onChange={() => setPolicyRefreshTick((n) => n + 1)}
          />
        </div>

        <div className="panel" hidden={tab !== "history"}>
          <HistoryTab history={history} />
        </div>

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

      </div>
    </div>
  );
}

// -- Queue tab ---------------------------------------------------------------

function QueueTab({
  items,
  resolvingId,
  onResolve,
}: {
  items: QueueItem[];
  resolvingId: string | null;
  onResolve: (approval: ApprovalRequest, decision: "approved" | "rejected") => Promise<void>;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [kindFilter, setKindFilter] = useState<"all" | "action" | "escalation" | "plan_approval">(
    "all",
  );
  const [todayChip, setTodayChip] = useState(true);
  // Set of approval IDs the user just approved — drives the "replay
  // within ~30s" callout. Cleared when the approvals query refetches
  // (the row disappears from `items` once it's resolved).
  const [recentlyApproved, setRecentlyApproved] = useState<Set<string>>(new Set());

  const visibleIds = useMemo(() => new Set(items.map((i) => i.id)), [items]);
  useEffect(() => {
    setRecentlyApproved((prev) => {
      const next = new Set<string>();
      for (const id of prev) if (visibleIds.has(id)) next.add(id);
      return next.size === prev.size ? prev : next;
    });
  }, [visibleIds]);

  const agentOptions = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) {
      if (it.agent && it.agent !== "—") set.add(it.agent);
    }
    return Array.from(set).sort();
  }, [items]);

  const filtered = items.filter((item) => {
    if (kindFilter !== "all" && item.kind !== kindFilter) return false;
    if (agentFilter !== "all" && item.agent !== agentFilter) return false;
    return true;
  });

  const runResolve = async (
    approval: ApprovalRequest,
    decision: "approved" | "rejected",
  ) => {
    const itemId = approval.id.slice(0, 8).toUpperCase();
    if (decision === "approved") {
      setRecentlyApproved((prev) => {
        const next = new Set(prev);
        next.add(itemId);
        return next;
      });
    }
    try {
      await onResolve(approval, decision);
    } catch {
      // Roll back the optimistic banner if the call failed.
      setRecentlyApproved((prev) => {
        if (!prev.has(itemId)) return prev;
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
    }
  };

  const filteredIds = useMemo(() => filtered.map((i) => i.id), [filtered]);
  const { focusedId, helpOpen, setHelpOpen } = useListKeyboardNav({
    ids: filteredIds,
    expandedId,
    setExpandedId,
  });

  return (
    <>
      <div className="filterbar">
        <div className="seg">
          <button
            type="button"
            aria-selected={kindFilter === "all"}
            onClick={() => setKindFilter("all")}
          >
            All
          </button>
          <button
            type="button"
            aria-selected={kindFilter === "action"}
            onClick={() => setKindFilter("action")}
          >
            Actions
          </button>
          <button
            type="button"
            aria-selected={kindFilter === "escalation"}
            onClick={() => setKindFilter("escalation")}
          >
            Escalations
          </button>
          <button
            type="button"
            aria-selected={kindFilter === "plan_approval"}
            onClick={() => setKindFilter("plan_approval")}
          >
            Plans
          </button>
        </div>
        <select value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)}>
          <option value="all">Any agent</option>
          {agentOptions.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        {todayChip ? (
          <span className="chip">
            today
            <button
              type="button"
              className="x"
              onClick={() => setTodayChip(false)}
              aria-label="Remove today filter"
            >
              ×
            </button>
          </span>
        ) : null}
        <div className="grow" />
        <span style={{ fontSize: 12, color: "var(--af2-ink-3)" }}>
          {filtered.length} of {items.length}
        </span>
      </div>

      <div className="card card-list" style={{ padding: 0 }}>
        {filtered.map((item) => {
          const expanded = expandedId === item.id;
          const focused = focusedId === item.id;
          return (
            <div key={item.id} data-keyboard-row-id={item.id}>
              <div
                className={`row${expanded ? " expanded" : ""}`}
                style={{
                  gridTemplateColumns: QUEUE_GRID,
                  ...(focused
                    ? {
                        outline: "2px solid var(--af2-clay)",
                        outlineOffset: -2,
                      }
                    : null),
                }}
                onClick={() => setExpandedId(expanded ? null : item.id)}
                aria-expanded={expanded}
              >
                <div className="id">{item.id}</div>
                <div>
                  <b>{item.title}</b>
                  <br />
                  <span style={{ color: "var(--af2-ink-3)", fontSize: 12 }}>
                    {item.subtitle}
                  </span>
                </div>
                <div>
                  <span className={`pill dot ${item.tierTone}`}>{item.tierLabel}</span>
                </div>
                <div>
                  <span className="pill">{item.agent}</span>
                </div>
                <div className="actions">
                  {item.kind === "escalation" ? (
                    <button
                      type="button"
                      className="btn ghost sm"
                      onClick={(e: ReactMouseEvent) => e.stopPropagation()}
                    >
                      Reply
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="btn sm"
                    disabled={!item.rawApproval || resolvingId === item.rawApproval.id}
                    onClick={(e: ReactMouseEvent) => {
                      e.stopPropagation();
                      if (item.rawApproval) {
                        void runResolve(item.rawApproval, "rejected");
                      }
                    }}
                  >
                    Reject
                  </button>
                  <button
                    type="button"
                    className="btn primary sm"
                    disabled={!item.rawApproval || resolvingId === item.rawApproval.id}
                    onClick={(e: ReactMouseEvent) => {
                      e.stopPropagation();
                      if (item.rawApproval) {
                        void runResolve(item.rawApproval, "approved");
                      }
                    }}
                  >
                    {item.kind === "plan_approval" ? "Approve plan" : "Approve"}
                  </button>
                </div>
              </div>
              <div className={`row-drawer${expanded ? " open" : ""}`}>
                <div className="row-drawer-head">
                  <div>
                    <div className="eyebrow" style={{ marginBottom: 4 }}>
                      {item.drawer.eyebrow}
                    </div>
                    <h3>{item.drawer.headline}</h3>
                  </div>
                  <button
                    type="button"
                    className="btn ghost sm"
                    onClick={(e: ReactMouseEvent) => {
                      e.stopPropagation();
                      setExpandedId(null);
                    }}
                  >
                    Collapse ↑
                  </button>
                </div>
                <p style={{ fontSize: 13, color: "var(--af2-ink-2)", margin: "0 0 12px" }}>
                  {item.drawer.body}
                </p>
                {item.kind === "plan_approval" && item.drawer.planText ? (
                  <PlanApprovalBody
                    planText={item.drawer.planText}
                    originalPrompt={item.drawer.originalPrompt ?? ""}
                  />
                ) : null}
                {recentlyApproved.has(item.id) ? (
                  <div
                    role="status"
                    style={{
                      margin: "0 0 12px",
                      padding: "8px 12px",
                      border: "1px solid rgba(115, 158, 90, 0.30)",
                      background: "rgba(115, 158, 90, 0.10)",
                      color: "var(--af2-sage, #4a6a36)",
                      borderRadius: 6,
                      fontSize: 12.5,
                    }}
                  >
                    Approved — the agent will replay within ~30s.
                  </div>
                ) : null}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {item.drawer.actions.map((a, i) => {
                    const isPrimary = a.variant === "primary";
                    const handler = item.rawApproval
                      ? () =>
                          void runResolve(
                            item.rawApproval!,
                            isPrimary ? "approved" : "rejected",
                          )
                      : undefined;
                    return (
                      <button
                        key={`${item.id}-act-${i}`}
                        type="button"
                        className={`btn${isPrimary ? " primary" : ""}`}
                        disabled={
                          !handler ||
                          (item.rawApproval !== undefined &&
                            resolvingId === item.rawApproval.id)
                        }
                        onClick={(e: ReactMouseEvent) => {
                          e.stopPropagation();
                          if (handler) handler();
                        }}
                      >
                        {a.label}
                      </button>
                    );
                  })}
                </div>
                {item.drawer.deepLink ? (
                  <div style={{ marginTop: 14 }}>
                    <a
                      href="#"
                      onClick={(e) => e.preventDefault()}
                      style={{ color: "var(--af2-clay)", fontSize: 12 }}
                    >
                      ↘ {item.drawer.deepLink}
                    </a>
                  </div>
                ) : null}
                <div className="row-drawer-foot">
                  <span className="url">?row={item.id}</span>
                  <a
                    href="#"
                    className="btn"
                    onClick={(e) => e.preventDefault()}
                  >
                    Open full page →
                  </a>
                </div>
              </div>
            </div>
          );
        })}
        {filtered.length === 0 ? (
          <div style={{ padding: "24px 16px", textAlign: "center", color: "var(--af2-ink-3)", fontSize: 13 }}>
            {items.length === 0
              ? "No approvals waiting. You're all caught up."
              : "No approvals match the current filters."}
          </div>
        ) : null}
      </div>
      <div
        style={{
          marginTop: 8,
          fontSize: 11,
          color: "var(--af2-ink-4)",
        }}
      >
        Tip: <kbd style={kbdStyle}>j</kbd>/<kbd style={kbdStyle}>k</kbd> to
        navigate, <kbd style={kbdStyle}>enter</kbd> to expand,{" "}
        <kbd style={kbdStyle}>?</kbd> for all shortcuts.
      </div>
      <KeyboardShortcutsOverlay
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        title="Approval queue shortcuts"
        shortcuts={[
          { keys: "j / ↓", label: "Next item" },
          { keys: "k / ↑", label: "Previous item" },
          { keys: "enter / o", label: "Expand focused item" },
          { keys: "esc", label: "Collapse" },
          { keys: "⌘K / Ctrl+K", label: "Command palette" },
          { keys: "?", label: "Toggle this help" },
        ]}
      />
    </>
  );
}

const kbdStyle: CSSProperties = {
  fontFamily: "var(--af2-mono, ui-monospace, SFMono-Regular, monospace)",
  fontSize: 10,
  background: "var(--af2-paper-2)",
  border: "1px solid var(--af2-line-2)",
  borderRadius: 3,
  padding: "0 4px",
  color: "var(--af2-ink-2)",
};

// -- Policies tab ------------------------------------------------------------

const MODE_OPTIONS: ApprovalTierMode[] = [
  "require_approval",
  "notify_only",
  "auto_approve",
];

function PoliciesTab({
  refreshTick,
  onChange,
}: {
  refreshTick: number;
  onChange: () => void;
}) {
  const { requireAccessToken } = useAuth();
  const [policies, setPolicies] = useState<ApprovalPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

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
  }, [load, refreshTick]);

  async function updatePolicy(
    policy: ApprovalPolicy,
    patch: { mode?: ApprovalTierMode; spendThresholdCents?: number },
  ) {
    setBusyId(policy.actionType);
    try {
      const token = await requireAccessToken();
      const body: Record<string, unknown> = {
        mode: patch.mode ?? policy.mode,
      };
      if (policy.actionType === "spend_above_threshold") {
        body.spendThresholdCents =
          patch.spendThresholdCents ?? policy.spendThresholdCents ?? 0;
      }
      const res = await trackedFetch(
        `${getApiBasePath()}/approval-policies/${encodeURIComponent(policy.actionType)}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) throw new Error(`Failed to update policy (${res.status})`);
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update policy");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      {loading ? (
        <div className="card" style={{ padding: 14 }}>
          Loading policies…
        </div>
      ) : null}
      {error ? (
        <div style={{ marginBottom: 14 }}>
          <ErrorState
            title="Policies unavailable"
            message={error}
            onRetry={() => void load()}
          />
        </div>
      ) : null}
      <div className="grid-2">
        {policies.map((p) => {
          const isBusy = busyId === p.actionType;
          return (
            <div key={p.actionType} className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <h3 style={{ margin: 0 }}>{ACTION_LABEL[p.actionType]}</h3>
              <label
                style={{
                  fontSize: 11,
                  color: "var(--af2-ink-3)",
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                }}
              >
                Mode
                <select
                  value={p.mode}
                  onChange={(e) =>
                    void updatePolicy(p, { mode: e.target.value as ApprovalTierMode })
                  }
                  disabled={isBusy}
                  style={{
                    marginTop: 4,
                    width: "100%",
                    padding: "6px 8px",
                    fontSize: 13,
                    textTransform: "none",
                    letterSpacing: 0,
                    color: "var(--af2-ink)",
                  }}
                >
                  {MODE_OPTIONS.map((mode) => (
                    <option key={mode} value={mode}>
                      {MODE_LABEL[mode]}
                    </option>
                  ))}
                </select>
              </label>
              {p.actionType === "spend_above_threshold" ? (
                <label
                  style={{
                    fontSize: 11,
                    color: "var(--af2-ink-3)",
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                  }}
                >
                  Threshold (USD)
                  <input
                    type="number"
                    min={0}
                    step={1}
                    defaultValue={
                      p.spendThresholdCents ? Math.round(p.spendThresholdCents / 100) : 0
                    }
                    onBlur={(e) => {
                      const dollars = Number(e.target.value);
                      if (Number.isFinite(dollars) && dollars >= 0) {
                        const cents = Math.round(dollars * 100);
                        if (cents !== (p.spendThresholdCents ?? 0)) {
                          void updatePolicy(p, { spendThresholdCents: cents });
                        }
                      }
                    }}
                    disabled={isBusy}
                    style={{
                      marginTop: 4,
                      width: "100%",
                      padding: "6px 8px",
                      fontSize: 13,
                      textTransform: "none",
                      letterSpacing: 0,
                      color: "var(--af2-ink)",
                    }}
                  />
                </label>
              ) : null}
            </div>
          );
        })}
      </div>
    </>
  );
}

// -- History tab --------------------------------------------------------------

function HistoryTab({ history }: { history: ApprovalRequest[] }) {
  const rows = history.map((h) => ({
    id: h.id.slice(0, 8).toUpperCase(),
    title: h.message || h.stepName,
    status: (h.status === "approved" ? "approved" : "rejected") as
      | "approved"
      | "rejected",
    when: h.resolvedAt ? formatTimestamp(h.resolvedAt) : "—",
  }));

  if (rows.length === 0) {
    return (
      <div className="card">
        <p className="desc">No resolved approvals yet.</p>
      </div>
    );
  }

  return (
    <div className="card card-list" style={{ padding: 0 }}>
      {rows.map((r) => (
        <div
          key={r.id}
          className="row"
          style={{ gridTemplateColumns: "90px 1fr 120px 110px", cursor: "default" }}
        >
          <div className="id">{r.id}</div>
          <div>
            <b>{r.title}</b>
          </div>
          <div>
            <span className={`pill ${r.status === "approved" ? "sage" : "clay"} dot`}>
              {r.status}
            </span>
          </div>
          <div className="id">{r.when}</div>
        </div>
      ))}
    </div>
  );
}

// -- New escalation modal -----------------------------------------------------

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
      setSubmitError("Please describe what you'd like the team to weigh in on.");
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
      className="af2-v2-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-escalation-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="af2-v2-modal">
        <div className="af2-v2-modal-head">
          <div>
            <h2 id="new-escalation-title">Ask the team</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="btn ghost sm"
          >
            <X size={14} />
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="af2-v2-modal-body">
            <label className="field">
              Question
              <textarea
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                rows={5}
                placeholder="What should the team weigh in on?"
                autoFocus
                required
              />
            </label>
            {submitError ? (
              <div
                role="alert"
                style={{
                  marginTop: 8,
                  padding: "8px 12px",
                  border: "1px solid rgba(192,84,76,0.30)",
                  background: "rgba(192,84,76,0.10)",
                  color: "var(--af2-clay)",
                  borderRadius: 6,
                  fontSize: 12.5,
                }}
              >
                {submitError}
              </div>
            ) : null}
          </div>
          <div className="af2-v2-modal-foot">
            <button
              type="button"
              onClick={onClose}
              className="btn"
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn primary"
              disabled={submitting}
            >
              {submitting ? (
                <Loader2 size={14} className="animate-spin" style={{ marginRight: 6 }} />
              ) : null}
              Send
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// -- Plan approval body (HEL-217) --------------------------------------------

/**
 * Renders a plan-mode approval's plan text + the original user prompt.
 *
 * The plan body comes from the agent's free-text output, so we render
 * it in a preformatted block that preserves whitespace + step
 * numbering. The dashboard doesn't ship a markdown renderer today; if
 * we add one later, swap the `<pre>` for `<ReactMarkdown />` and the
 * surrounding scaffolding stays the same.
 */
function PlanApprovalBody({
  planText,
  originalPrompt,
}: {
  planText: string;
  originalPrompt: string;
}) {
  const [showPrompt, setShowPrompt] = useState(false);
  return (
    <div style={{ margin: "0 0 12px" }}>
      <div
        style={{
          marginBottom: 8,
          fontSize: 11,
          color: "var(--af2-ink-3)",
          textTransform: "uppercase",
          letterSpacing: "0.1em",
        }}
      >
        Proposed plan
      </div>
      <pre
        style={{
          margin: 0,
          padding: "10px 12px",
          background: "var(--af2-paper-2)",
          border: "1px solid var(--af2-line-2)",
          borderRadius: 6,
          fontSize: 12.5,
          lineHeight: 1.55,
          color: "var(--af2-ink)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          fontFamily: "var(--af2-mono, ui-monospace, SFMono-Regular, monospace)",
        }}
      >
        {planText.trim() || "(empty plan)"}
      </pre>
      {originalPrompt ? (
        <div style={{ marginTop: 10 }}>
          <button
            type="button"
            className="btn ghost sm"
            onClick={(e: ReactMouseEvent) => {
              e.stopPropagation();
              setShowPrompt((v) => !v);
            }}
          >
            {showPrompt ? "Hide original prompt" : "Show original prompt"}
          </button>
          {showPrompt ? (
            <pre
              style={{
                marginTop: 8,
                padding: "10px 12px",
                background: "var(--af2-paper-3, var(--af2-paper-2))",
                border: "1px solid var(--af2-line-2)",
                borderRadius: 6,
                fontSize: 12,
                lineHeight: 1.55,
                color: "var(--af2-ink-2)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {originalPrompt.trim() || "(empty prompt)"}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
