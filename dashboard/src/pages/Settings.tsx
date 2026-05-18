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
import { CheckCircle2, KeyRound, Loader2, Plug, Sparkles } from "lucide-react";
import { trackedFetch } from "../api/trackedFetch";
import { getApiBasePath } from "../api/baseUrl";
import { apiGet } from "../api/settingsClient";
import { listMissions, type Mission } from "../api/missionsApi";
import { listLLMConfigs, type LLMConfig } from "../api/client";
import { ErrorState, LoadingState } from "../components/UiStates";
import { useToast } from "../components/ToastProvider";
import { useAuth } from "../context/AuthContext";
import { useWorkspace } from "../context/useWorkspace";
import {
  LIVE_CONNECTOR_PROVIDERS,
  type ProviderKey,
  type ProviderStatus,
} from "../integrations/liveConnectorCatalog";

type TabKey =
  | "general"
  | "members"
  | "policies"
  | "security"
  | "billing"
  | "credentials"
  | "api";

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
  // PR 4: unified Credentials tab. Renders an inline summary of every
  // secret the workspace holds (LLM keys, integration OAuth/API keys,
  // custom MCP server tokens) so users have one place to scan
  // "what's connected, what's stale, what's missing." Entry of new
  // credentials still happens in the per-feature sub-routes — this
  // surface is the unified VIEW, not the unified EDITOR.
  { key: "credentials", label: "Credentials" },
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
          requireAccessToken={requireAccessToken}
        />
      ) : activeTab === "credentials" ? (
        <CredentialsTab requireAccessToken={requireAccessToken} />
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
  requireAccessToken: () => Promise<string>;
}

function GeneralTab({
  workspaceName,
  missionStatement,
  policies,
  onEditPolicy,
  requireAccessToken,
}: GeneralTabProps) {
  const toast = useToast();
  const browserTimezone =
    Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Los_Angeles";

  // DASH-16 redux: General-tab inputs used to be uncontrolled
  // (defaultValue) with no Save button, so the page LOOKED editable
  // but nothing persisted. Now controlled state + a Save button
  // wired to PATCH /api/profile (timezone + display name go through
  // the user_profiles table). Workspace name has no PATCH endpoint
  // yet, so it stays read-only with a pointer to the workspace
  // switcher where renaming will land.
  const [displayName, setDisplayName] = useState<string>("");
  const [timezone, setTimezone] = useState<string>(browserTimezone);
  const [initial, setInitial] = useState<{ displayName: string; timezone: string } | null>(
    null,
  );
  const [profileLoading, setProfileLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const token = await requireAccessToken();
        const data = await apiGet<{
          profile?: { displayName?: string | null; timezone?: string };
        }>("/api/profile", null, token);
        if (cancelled) return;
        const nextDisplay = data.profile?.displayName ?? "";
        const nextTz = data.profile?.timezone ?? browserTimezone;
        setDisplayName(nextDisplay);
        setTimezone(nextTz);
        setInitial({ displayName: nextDisplay, timezone: nextTz });
      } catch {
        if (cancelled) return;
        // Falls back to the browser timezone we seeded above.
        setInitial({ displayName: "", timezone: browserTimezone });
      } finally {
        if (!cancelled) setProfileLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [browserTimezone, requireAccessToken]);

  const dirty =
    initial !== null &&
    (displayName.trim() !== initial.displayName.trim() ||
      timezone.trim() !== initial.timezone.trim());

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const token = await requireAccessToken();
      const response = await trackedFetch(`${getApiBasePath()}/profile`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          displayName: displayName.trim() || null,
          timezone: timezone.trim(),
        }),
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Save failed (${response.status}): ${body.slice(0, 240)}`);
      }
      const data = (await response.json()) as {
        profile?: { displayName?: string | null; timezone?: string };
      };
      const nextDisplay = data.profile?.displayName ?? displayName.trim();
      const nextTz = data.profile?.timezone ?? timezone.trim();
      setInitial({ displayName: nextDisplay, timezone: nextTz });
      toast.success("Profile saved.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save profile";
      setSaveError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

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
          Workspace name
        </label>
        <input
          id="settings-workspace-name"
          className="af2-input"
          value={workspaceName}
          readOnly
          title="Workspace renaming is coming soon — use the workspace switcher in the topbar to create a new one."
          style={{
            display: "block",
            width: "100%",
            marginTop: 6,
            opacity: 0.7,
            cursor: "not-allowed",
          }}
        />
        <p
          className="af2-muted-2"
          style={{ fontSize: 11, marginTop: 4 }}
        >
          Workspace renaming is coming soon.
        </p>

        <label
          htmlFor="settings-display-name"
          style={{
            fontSize: 12.5,
            color: "var(--af2-ink-3)",
            marginTop: 16,
            display: "block",
          }}
        >
          Your display name
        </label>
        <input
          id="settings-display-name"
          className="af2-input"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value.slice(0, 200))}
          placeholder={profileLoading ? "Loading…" : "How you appear to teammates"}
          disabled={profileLoading || saving}
          style={{ display: "block", width: "100%", marginTop: 6 }}
        />

        <label
          htmlFor="settings-mission-statement"
          style={{
            fontSize: 12.5,
            color: "var(--af2-ink-3)",
            marginTop: 16,
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
        <p
          className="af2-muted-2"
          style={{ fontSize: 11, marginTop: 4 }}
        >
          Mission statements are authored on the{" "}
          <Link to="/hire" style={{ color: "var(--af2-clay)" }}>
            Hire page
          </Link>
          .
        </p>

        <label
          htmlFor="settings-timezone"
          style={{
            fontSize: 12.5,
            color: "var(--af2-ink-3)",
            marginTop: 16,
            display: "block",
          }}
        >
          Default timezone
        </label>
        <input
          id="settings-timezone"
          className="af2-input"
          value={timezone}
          onChange={(event) => setTimezone(event.target.value)}
          placeholder={profileLoading ? "Loading…" : browserTimezone}
          disabled={profileLoading || saving}
          style={{ display: "block", width: "100%", marginTop: 6 }}
        />
        <p
          className="af2-muted-2"
          style={{ fontSize: 11, marginTop: 4 }}
        >
          Used for displaying timestamps and scheduling routines.
        </p>

        {saveError ? (
          <div
            role="alert"
            style={{
              marginTop: 14,
              padding: "10px 12px",
              borderRadius: "var(--af2-radius)",
              border: "1px solid rgba(192,84,76,0.30)",
              background: "rgba(192,84,76,0.10)",
              color: "var(--af2-clay)",
              fontSize: 12.5,
            }}
          >
            {saveError}
          </div>
        ) : null}

        <div
          style={{
            marginTop: 18,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!dirty || saving || profileLoading}
            className="af2-btn af2-btn-clay"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              opacity: !dirty || saving || profileLoading ? 0.5 : 1,
              cursor: !dirty || saving || profileLoading ? "not-allowed" : "pointer",
            }}
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : null}
            Save changes
          </button>
          {dirty ? (
            <span className="af2-muted-2" style={{ fontSize: 11 }}>
              Unsaved changes
            </span>
          ) : null}
        </div>
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

// ---------------------------------------------------------------------------
// PR 4: Unified Credentials tab
// ---------------------------------------------------------------------------

interface McpServerSummary {
  id: string;
  name: string;
  url: string;
  hasAuth: boolean;
  createdAt: string;
}

interface CredentialsTabProps {
  requireAccessToken: () => Promise<string>;
}

/**
 * Read-only view of every secret the workspace holds. Three sections:
 * Models (BYOK LLM keys), Integrations (OAuth + API-key connectors),
 * Custom MCP (workspace MCP server tokens). Each row links to the
 * dedicated sub-route where adding/rotating actually happens — this
 * page is the SCAN surface, not the EDIT surface.
 */
function CredentialsTab({ requireAccessToken }: CredentialsTabProps) {
  const [llm, setLlm] = useState<LLMConfig[] | null>(null);
  const [integrations, setIntegrations] = useState<Record<
    ProviderKey,
    ProviderStatus
  > | null>(null);
  const [mcp, setMcp] = useState<McpServerSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const token = await requireAccessToken();
        const [llmList, integrationsRes, mcpRes] = await Promise.all([
          listLLMConfigs(token).catch(() => [] as LLMConfig[]),
          trackedFetch(`${getApiBasePath()}/integrations/status`, {
            headers: { Authorization: `Bearer ${token}` },
          })
            .then(async (res) =>
              res.ok
                ? ((await res.json()) as {
                    providers: Record<ProviderKey, ProviderStatus>;
                  })
                : null,
            )
            .catch(() => null),
          trackedFetch(`${getApiBasePath()}/mcp/servers`, {
            headers: { Authorization: `Bearer ${token}` },
          })
            .then(async (res) =>
              res.ok
                ? ((await res.json()) as { servers: McpServerSummary[] })
                : null,
            )
            .catch(() => null),
        ]);
        if (cancelled) return;
        setLlm(llmList);
        setIntegrations(integrationsRes?.providers ?? null);
        setMcp(mcpRes?.servers ?? []);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load credentials");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [requireAccessToken]);

  const integrationRows = useMemo(() => {
    if (!integrations) return [];
    return LIVE_CONNECTOR_PROVIDERS.map((p) => ({
      key: p.key,
      name: p.name,
      category: p.category,
      status: integrations[p.key],
    }));
  }, [integrations]);

  if (loading) {
    return <LoadingState label="Loading credentials…" />;
  }
  if (error) {
    return <ErrorState title="Couldn't load credentials" message={error} />;
  }

  const connectedIntegrations = integrationRows.filter(
    (r) => r.status?.connected,
  ).length;
  const mcpCount = mcp?.length ?? 0;
  const llmCount = llm?.length ?? 0;

  return (
    <div style={{ display: "grid", gap: 28 }}>
      <p className="af2-muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
        Everything connected to this workspace, in one place. Add or rotate
        credentials from the per-feature sub-routes; this tab is for
        scanning what's wired.
      </p>

      <CredentialsSection
        icon={<Sparkles size={14} />}
        title="Models"
        countLabel={`${llmCount} configured`}
        emptyText="No LLM providers connected yet."
        manageHref="/settings/llm-providers"
        manageLabel="Manage models"
        rows={(llm ?? []).map((cfg) => ({
          key: cfg.id,
          left: cfg.label,
          middle: `${cfg.provider} · ${cfg.model}`,
          right: cfg.isDefault ? "Default · " : "",
          tail: cfg.apiKeyMasked,
        }))}
      />

      <CredentialsSection
        icon={<Plug size={14} />}
        title="Integrations"
        countLabel={`${connectedIntegrations} connected · ${integrationRows.length} available`}
        emptyText="No integrations connected."
        manageHref="/integrations/mcp"
        manageLabel="Manage integrations"
        rows={integrationRows
          .filter((r) => r.status?.connected)
          .map((r) => ({
            key: r.key,
            left: r.name,
            middle: r.category,
            right: r.status?.authMethod
              ? r.status.authMethod === "api_key"
                ? "API key · "
                : "OAuth · "
              : "",
            tail: r.status?.tokenMasked ?? r.status?.accountLabel ?? "—",
          }))}
      />

      <CredentialsSection
        icon={<KeyRound size={14} />}
        title="Custom MCP servers"
        countLabel={`${mcpCount} registered`}
        emptyText="No custom MCP servers registered."
        manageHref="/settings/mcp-servers"
        manageLabel="Manage MCP servers"
        rows={(mcp ?? []).map((s) => ({
          key: s.id,
          left: s.name,
          middle: s.url,
          right: s.hasAuth ? "Auth · " : "No auth · ",
          tail: relativeDate(s.createdAt),
        }))}
      />
    </div>
  );
}

interface CredentialsSectionProps {
  icon: React.ReactNode;
  title: string;
  countLabel: string;
  emptyText: string;
  manageHref: string;
  manageLabel: string;
  rows: Array<{
    key: string;
    left: string;
    middle: string;
    right: string;
    tail: string;
  }>;
}

function CredentialsSection({
  icon,
  title,
  countLabel,
  emptyText,
  manageHref,
  manageLabel,
  rows,
}: CredentialsSectionProps) {
  return (
    <section>
      <div
        className="af2-row"
        style={{ alignItems: "baseline", marginBottom: 8 }}
      >
        <div
          className="af2-eyebrow"
          style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          {icon}
          {title}
        </div>
        <span className="af2-spacer" />
        <span className="af2-muted-2" style={{ fontSize: 11 }}>
          {countLabel}
        </span>
      </div>
      {rows.length === 0 ? (
        <div
          className="af2-card"
          style={{
            padding: 18,
            textAlign: "center",
            borderStyle: "dashed",
          }}
        >
          <p className="af2-muted" style={{ fontSize: 13, margin: 0 }}>
            {emptyText}
          </p>
          <Link
            to={manageHref}
            className="af2-btn af2-btn-sm af2-btn-clay"
            style={{
              marginTop: 10,
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            {manageLabel}
          </Link>
        </div>
      ) : (
        <div className="af2-list">
          {rows.map((r, idx) => (
            <div
              key={r.key}
              className="af2-list-row"
              style={{
                gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.2fr) auto",
                alignItems: "center",
                gap: 12,
                borderBottom:
                  idx < rows.length - 1 ? "1px solid var(--af2-line)" : "none",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: 13.5,
                    color: "var(--af2-ink)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {r.left}
                </div>
                <div
                  className="af2-muted"
                  style={{
                    fontSize: 11.5,
                    marginTop: 2,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {r.middle}
                </div>
              </div>
              <div
                className="af2-mono"
                style={{
                  fontSize: 11.5,
                  color: "var(--af2-ink-2)",
                  textAlign: "right",
                }}
              >
                <span style={{ color: "var(--af2-sage)" }}>
                  <CheckCircle2
                    size={11}
                    style={{ verticalAlign: "middle", marginRight: 4 }}
                  />
                  {r.right}
                </span>
                <span className="af2-muted-2">{r.tail}</span>
              </div>
              <Link
                to={manageHref}
                className="af2-btn af2-btn-sm af2-btn-ghost"
                style={{ textDecoration: "none", flexShrink: 0 }}
              >
                Manage
              </Link>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function relativeDate(iso: string): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return "—";
  const diffMs = Date.now() - ts;
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days < 1) return "today";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

