/**
 * Settings page (HEL-32 v2 rebuild — tabbed surface).
 *
 * Mirrors the v2 reference (`docs/design/v2/pages-extra.jsx::AF2_Settings`):
 *   - af2-page chrome with "Connect · Workspace" eyebrow + serif h1 + a
 *     workspace-meta strap (`Acme Robotics · Studio plan · 12 seats · created …`).
 *   - Tab strip: General / Members / Policies / Security / Billing / API.
 *   - Inline General tab content: Workspace section (name / mission /
 *     timezone), Approvals card seeded from `/api/approval-policies`, and a
 *     Danger zone card with "Pause all agents".
 *   - The other tabs are still hub tiles linking out to the existing
 *     sub-routes (`/settings/profile`, `/settings/security`,
 *     `/settings/api-keys`, etc.) so we don't break bookmarks while the
 *     inline Members + Billing surfaces are still under construction.
 *
 * Workspace meta uses `useWorkspace()` (which only exposes id/name/slug
 * today). Plan tier, seats and `createdAt` aren't on `WorkspaceSummary`
 * yet, so we render sensible fallbacks (`Free plan · — seats · created —`)
 * and TODO them in. Mission statement reads from `listMissions(token)`
 * (latest mission's statement; read-only — no workspace-mission PATCH route
 * exists). Pause all is a no-op handler with a TODO.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { trackedFetch } from "../api/trackedFetch";
import { getApiBasePath } from "../api/baseUrl";
import { listMissions, type Mission } from "../api/missionsApi";
import { ErrorState, LoadingState } from "../components/UiStates";
import { useAuth } from "../context/AuthContext";
import { useWorkspace } from "../context/useWorkspace";

type TabKey = "general" | "members" | "policies" | "security" | "billing" | "api";

interface TabDef {
  key: TabKey;
  label: string;
}

const TABS: TabDef[] = [
  { key: "general", label: "General" },
  { key: "members", label: "Members" },
  { key: "policies", label: "Policies" },
  { key: "security", label: "Security" },
  { key: "billing", label: "Billing" },
  { key: "api", label: "API" },
];

// Mirrors src/approvals/policyTypes.ts. The /api/approval-policies endpoint
// returns the seeded defaults if none have been configured yet.
type ApprovalTierActionType =
  | "spend_above_threshold"
  | "contracts"
  | "public_posts"
  | "customer_facing_comms"
  | "code_merges_to_prod";

type ApprovalTierMode =
  | "auto_approve"
  | "notify_only"
  | "require_approval";

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
  if (cents == null || !Number.isFinite(cents)) return "any amount";
  const dollars = cents / 100;
  return dollars >= 1000
    ? `$${(dollars / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })}k`
    : `$${dollars.toLocaleString()}`;
}

function policyValueText(policy: ApprovalPolicy): string {
  if (policy.actionType === "spend_above_threshold") {
    return `${MODE_LABEL[policy.mode]} for spend over ${formatSpend(policy.spendThresholdCents)}`;
  }
  return MODE_LABEL[policy.mode];
}

function policyKeyText(policy: ApprovalPolicy): string {
  if (policy.actionType === "spend_above_threshold") {
    return `Spend over ${formatSpend(policy.spendThresholdCents ?? 50000)}`;
  }
  return ACTION_LABEL[policy.actionType];
}

function formatDate(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

// The /settings/* hub tiles we still surface from the non-General tabs.
// Each tab maps to either an inline panel (rendered in this file) or a
// list of `{ to, title, description }` cards linking to the legacy
// per-feature settings sub-routes.
const TAB_HUB: Partial<Record<TabKey, Array<{ to: string; title: string; description: string }>>> = {
  members: [
    {
      to: "/settings/profile",
      title: "Your profile",
      description: "Update your display name, email, and account preferences.",
    },
  ],
  security: [
    {
      to: "/settings/security",
      title: "Security",
      description: "Manage your password, active sessions, and two-factor authentication.",
    },
    {
      to: "/settings/notifications",
      title: "Notifications",
      description: "Choose when and how you get notified about workflow runs and alerts.",
    },
  ],
  api: [
    {
      to: "/settings/api-keys",
      title: "API keys",
      description: "Generate and manage API keys for programmatic access to AutoFlow.",
    },
    {
      to: "/settings/llm-providers",
      title: "LLM providers",
      description:
        "Connect your own API keys for OpenAI, Anthropic, Gemini, and Mistral to use in workflows.",
    },
    {
      to: "/settings/integrations",
      title: "Integrations",
      description: "Register and manage integration servers to use as steps in your workflows.",
    },
  ],
  policies: [
    {
      to: "/settings/ticketing-sla",
      title: "Ticketing SLA",
      description:
        "Configure first-response targets, resolution windows, and escalation rules by priority.",
    },
  ],
};

export default function Settings() {
  const { activeWorkspace } = useWorkspace();
  const { requireAccessToken } = useAuth();

  const [activeTab, setActiveTab] = useState<TabKey>("general");

  const [missions, setMissions] = useState<Mission[]>([]);
  const [policies, setPolicies] = useState<ApprovalPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const workspaceName = activeWorkspace?.name ?? "Workspace";

  useEffect(() => {
    document.title = "Settings | AutoFlow";
  }, []);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await requireAccessToken();
      const [missionsList, policiesRes] = await Promise.all([
        listMissions(token).catch(() => [] as Mission[]),
        trackedFetch(`${getApiBasePath()}/approval-policies`, {
          headers: { Authorization: `Bearer ${token}` },
        })
          .then(async (res) => {
            if (!res.ok) return null;
            return (await res.json()) as ApprovalPoliciesResponse;
          })
          .catch(() => null),
      ]);
      setMissions(missionsList);
      setPolicies(policiesRes?.policies ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load settings");
    } finally {
      setLoading(false);
    }
  }, [requireAccessToken]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const missionStatement = useMemo(() => {
    if (missions.length === 0) return "";
    // Newest-first by createdAt — `listMissions` returns whatever order the
    // backend chose; sort defensively.
    const sorted = [...missions].sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
    );
    return sorted[0]?.statement ?? "";
  }, [missions]);

  // TODO: workspace plan/seats/createdAt aren't on WorkspaceSummary yet.
  // Surface real values once the workspace API exposes them.
  const planTier: string | null = null;
  const seats: number | null = null;
  const createdAt: string | null = null;
  const metaLine = `${workspaceName} · ${planTier ?? "Free"} plan · ${seats ?? "—"} seats · created ${formatDate(createdAt)}.`;

  function handlePauseAll() {
    // TODO: wire to a backend pause endpoint once one exists. For now this
    // is a no-op so the button doesn't navigate or mutate state.
    // eslint-disable-next-line no-console
    console.warn("Pause all agents: backend endpoint not yet implemented");
  }

  return (
    <div className="af2-page" style={{ maxWidth: 920 }}>
      <div className="af2-page-head">
        <div>
          <div className="af2-eyebrow">Connect · Workspace</div>
          <h1 className="af2-h1" style={{ marginTop: 6 }}>
            Settings
          </h1>
          <div className="af2-page-head-meta">{metaLine}</div>
        </div>
      </div>

      <div className="af2-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`af2-tab${activeTab === tab.key ? " active" : ""}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <LoadingState label="Loading workspace settings…" />
      ) : error ? (
        <ErrorState
          title="Settings unavailable"
          message={error}
          onRetry={() => void loadSettings()}
        />
      ) : activeTab === "general" ? (
        <GeneralTab
          workspaceName={workspaceName}
          missionStatement={missionStatement}
          policies={policies}
          onPauseAll={handlePauseAll}
        />
      ) : (
        <HubTab tabKey={activeTab} />
      )}
    </div>
  );
}

interface GeneralTabProps {
  workspaceName: string;
  missionStatement: string;
  policies: ApprovalPolicy[];
  onPauseAll: () => void;
}

function GeneralTab({
  workspaceName,
  missionStatement,
  policies,
  onPauseAll,
}: GeneralTabProps) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "200px 1fr",
        gap: 28,
        alignItems: "start",
      }}
    >
      <div className="af2-eyebrow" style={{ paddingTop: 8 }}>
        Workspace
      </div>
      <div>
        <label
          htmlFor="settings-workspace-name"
          style={{ fontSize: 12.5, color: "var(--af2-ink-3)" }}
        >
          Name
        </label>
        <input
          id="settings-workspace-name"
          className="af2-input"
          defaultValue={workspaceName}
          style={{ display: "block", width: "100%", marginTop: 6 }}
        />
        <label
          htmlFor="settings-mission-statement"
          style={{
            fontSize: 12.5,
            color: "var(--af2-ink-3)",
            marginTop: 14,
            display: "block",
          }}
        >
          Mission statement
        </label>
        <textarea
          id="settings-mission-statement"
          className="af2-input font-af2-serif"
          rows={3}
          defaultValue={missionStatement}
          placeholder={
            missionStatement
              ? undefined
              : "No mission set — brief one from the Hire page."
          }
          readOnly
          style={{ width: "100%", marginTop: 6, fontSize: 15 }}
        />
        <label
          htmlFor="settings-timezone"
          style={{
            fontSize: 12.5,
            color: "var(--af2-ink-3)",
            marginTop: 14,
            display: "block",
          }}
        >
          Default timezone
        </label>
        <input
          id="settings-timezone"
          className="af2-input"
          defaultValue={
            Intl.DateTimeFormat().resolvedOptions().timeZone ||
            "America/Los_Angeles"
          }
          style={{ display: "block", width: "100%", marginTop: 6 }}
        />
      </div>

      <div className="af2-eyebrow" style={{ paddingTop: 8 }}>
        Approvals
      </div>
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
                  i < policies.length - 1
                    ? "1px solid var(--af2-line)"
                    : "none",
              }}
            >
              <span style={{ fontSize: 13.5, fontWeight: 500 }}>
                {policyKeyText(policy)}
              </span>
              <span className="af2-muted" style={{ fontSize: 12 }}>
                {policyValueText(policy)}
              </span>
              <Link
                to="/settings/ticketing-sla"
                className="af2-btn af2-btn-sm"
                style={{ textDecoration: "none", textAlign: "center" }}
              >
                Edit
              </Link>
            </div>
          ))
        )}
      </div>

      <div className="af2-eyebrow" style={{ paddingTop: 8 }}>
        Danger zone
      </div>
      <div
        className="af2-card"
        style={{ padding: 16, borderColor: "rgba(194,80,43,0.3)" }}
      >
        <div className="af2-row">
          <div>
            <div style={{ fontWeight: 600, fontSize: 13.5 }}>
              Pause all agents
            </div>
            <div
              className="af2-muted"
              style={{ fontSize: 12, marginTop: 2 }}
            >
              Stops every agent and routine in this workspace immediately.
            </div>
          </div>
          <span className="af2-spacer" />
          <button
            type="button"
            className="af2-btn af2-btn-sm"
            onClick={onPauseAll}
            style={{
              color: "var(--af2-clay)",
              borderColor: "rgba(194,80,43,0.3)",
            }}
          >
            Pause all
          </button>
        </div>
      </div>
    </div>
  );
}

function HubTab({ tabKey }: { tabKey: TabKey }) {
  const tiles = TAB_HUB[tabKey] ?? [];

  if (tiles.length === 0) {
    return (
      <div className="af2-card" style={{ padding: 24, textAlign: "center" }}>
        <div className="af2-muted" style={{ fontSize: 13 }}>
          This surface isn&rsquo;t available yet. Track progress in the v2
          settings rebuild.
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(2, 1fr)",
        gap: 14,
      }}
    >
      {tiles.map(({ to, title, description }) => (
        <Link
          key={to}
          to={to}
          className="af2-card"
          style={{
            padding: 18,
            textDecoration: "none",
            color: "inherit",
            display: "block",
          }}
        >
          <div
            style={{
              fontWeight: 600,
              fontSize: 14,
              marginBottom: 4,
            }}
          >
            {title}
          </div>
          <div
            className="af2-muted"
            style={{ fontSize: 12.5, lineHeight: 1.5 }}
          >
            {description}
          </div>
        </Link>
      ))}
    </div>
  );
}
