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

// $0 threshold is semantically "no threshold" — the spend policy mode
// (auto-approve / notify / require-human) decides behavior at every
// spend already. Surface that as "any spend" so the dashboard doesn't
// render meaningless copy like "Spend over $0" (which surfaced live
// on dev where legacy rows had spend_threshold_cents = 0 from the
// backend's pre-fix default).
function formatSpend(cents?: number): string {
  if (cents == null || !Number.isFinite(cents) || cents <= 0) {
    return "any spend";
  }
  const dollars = cents / 100;
  return dollars >= 1000
    ? `$${(dollars / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })}k`
    : `$${dollars.toLocaleString()}`;
}

function spendKeyLabel(cents?: number): string {
  // "any spend" reads better as a sentence prefix; for positive
  // thresholds we use the "Spend over $X" pattern.
  const label = formatSpend(cents);
  return label === "any spend" ? "Spend (any amount)" : `Spend over ${label}`;
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

function policyKeyText(policy: ApprovalPolicy): string {
  if (policy.actionType === "spend_above_threshold") {
    return spendKeyLabel(policy.spendThresholdCents);
  }
  return ACTION_LABEL[policy.actionType];
}

async function updateApprovalPolicy(
  actionType: ApprovalTierActionType,
  body: { mode: ApprovalTierMode; spendThresholdCents?: number },
  token: string,
): Promise<ApprovalPolicy> {
  const res = await trackedFetch(
    `${getApiBasePath()}/approval-policies/${encodeURIComponent(actionType)}`,
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
    throw new Error(payload?.error ?? `Failed to update approval policy (${res.status})`);
  }
  const { policy } = (await res.json()) as { policy: ApprovalPolicy };
  return policy;
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
      to: "#approvals",
      title: "Approval policies",
      description:
        "Tier-based rules for when a workflow run requires human sign-off. Currently read-only — view the live list on the General tab.",
    },
    {
      to: "/settings/ticketing-sla",
      title: "Ticketing SLA",
      description:
        "First-response targets, resolution windows, and escalation rules by ticket priority.",
    },
  ],
};

export default function Settings() {
  const { activeWorkspace } = useWorkspace();
  const { requireAccessToken } = useAuth();

  const [activeTab, setActiveTab] = useState<TabKey>("general");

  const [missions, setMissions] = useState<Mission[]>([]);
  const [policies, setPolicies] = useState<ApprovalPolicy[]>([]);
  // When non-null, the approval-policy editor modal is open and editing
  // this policy. The PUT response replaces the matching row in `policies`.
  const [editingPolicy, setEditingPolicy] = useState<ApprovalPolicy | null>(null);
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

  // DASH-16: drop placeholder seats/createdAt from the meta line until
  // the workspace API surfaces them. Showing "— seats · created —" was
  // worse than skipping the line entirely.
  const planTier: string | null = null;
  const metaSegments = [workspaceName, `${planTier ?? "Free"} plan`].filter(
    (s) => s.length > 0,
  );
  const metaLine = `${metaSegments.join(" · ")}.`;

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
          onEditPolicy={(policy) => setEditingPolicy(policy)}
        />
      ) : (
        <HubTab tabKey={activeTab} onJumpToGeneral={() => setActiveTab("general")} />
      )}

      {editingPolicy ? (
        <ApprovalPolicyEditor
          policy={editingPolicy}
          onClose={() => setEditingPolicy(null)}
          onSaved={(updated) => {
            setPolicies((current) =>
              current.map((p) => (p.actionType === updated.actionType ? updated : p)),
            );
            setEditingPolicy(null);
          }}
          requireAccessToken={requireAccessToken}
        />
      ) : null}
    </div>
  );
}

interface GeneralTabProps {
  workspaceName: string;
  missionStatement: string;
  policies: ApprovalPolicy[];
  onEditPolicy: (policy: ApprovalPolicy) => void;
}

function GeneralTab({
  workspaceName,
  missionStatement,
  policies,
  onEditPolicy,
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
              <button
                type="button"
                onClick={() => onEditPolicy(policy)}
                className="af2-btn af2-btn-sm"
                style={{ textAlign: "center" }}
              >
                Edit
              </button>
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
              {" "}
              <span className="af2-muted-2">Backend endpoint lands in a follow-up.</span>
            </div>
          </div>
          <span className="af2-spacer" />
          {/* DASH-16: button stays in place so the layout doesn't shift
              when the bulk-pause backend ships, but it's disabled with
              a tooltip so a click can't silently no-op. */}
          <button
            type="button"
            className="af2-btn af2-btn-sm"
            disabled
            title="Coming soon — pause individual agents from the Team page in the meantime."
            style={{
              color: "var(--af2-muted)",
              borderColor: "var(--af2-line)",
              cursor: "not-allowed",
              opacity: 0.6,
            }}
          >
            Pause all
          </button>
        </div>
      </div>
    </div>
  );
}

function ApprovalPolicyEditor({
  policy,
  onClose,
  onSaved,
  requireAccessToken,
}: {
  policy: ApprovalPolicy;
  onClose: () => void;
  onSaved: (updated: ApprovalPolicy) => void;
  requireAccessToken: () => Promise<string>;
}) {
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
      const updated = await updateApprovalPolicy(policy.actionType, body, token);
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
        // Click outside the inner card closes the modal.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="af2-card"
        style={{ padding: 22, maxWidth: 520, width: "100%" }}
      >
        <div className="af2-eyebrow">Edit policy</div>
        <h2
          id="approval-policy-editor-title"
          className="af2-h3"
          style={{ marginTop: 6 }}
        >
          {policyKeyText(policy)}
        </h2>
        <p className="af2-muted" style={{ fontSize: 13, marginTop: 4, lineHeight: 1.5 }}>
          Choose how AutoFlow handles {ACTION_LABEL[policy.actionType].toLowerCase()}{" "}
          requests for this workspace.
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
            <p className="af2-muted-2" style={{ fontSize: 11.5, marginTop: 4 }}>
              Spend at or above this amount triggers the rule above.
            </p>
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

function HubTab({
  tabKey,
  onJumpToGeneral,
}: {
  tabKey: TabKey;
  onJumpToGeneral?: () => void;
}) {
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
      {tiles.map(({ to, title, description }) => {
        // Anchor-style targets (e.g. "#approvals") jump back to the General
        // tab instead of navigating away to a different route.
        const isInternalJump = to.startsWith("#");
        if (isInternalJump) {
          return (
            <button
              key={to}
              type="button"
              onClick={() => onJumpToGeneral?.()}
              className="af2-card"
              style={{
                padding: 18,
                textAlign: "left",
                cursor: "pointer",
                background: "var(--af2-card)",
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
                {title}
              </div>
              <div className="af2-muted" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
                {description}
              </div>
            </button>
          );
        }
        return (
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
        );
      })}
    </div>
  );
}
