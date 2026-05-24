/**
 * Account page (HEL-213 / PR I).
 *
 * Absorbs Settings → General + Security + Profile from the legacy
 * Settings.tsx tab strip. Three form sections, scaffold-level — Security
 * controls persist in local state with TODO markers until the backend
 * lands.
 *
 *   You         — display name, email (read-only), timezone
 *   Workspace   — name, mission statement, experience mode
 *   Security    — SSO, session timeout, password rotation, audit retention
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { trackedFetch } from "../api/trackedFetch";
import { getApiBasePath } from "../api/baseUrl";
import { apiGet } from "../api/settingsClient";
import { listMissions, type Mission } from "../api/missionsApi";
import { useAuth } from "../context/AuthContext";
import { useWorkspace } from "../context/useWorkspace";
import { useToast } from "../components/ToastProvider";

export default function Account() {
  const { user, requireAccessToken } = useAuth();
  const { activeWorkspace } = useWorkspace();
  const toast = useToast();

  useEffect(() => {
    document.title = "Account | AutoFlow";
  }, []);

  const browserTimezone =
    Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Los_Angeles";

  const [displayName, setDisplayName] = useState("");
  const [timezone, setTimezone] = useState(browserTimezone);
  const [initial, setInitial] = useState<{ displayName: string; timezone: string } | null>(
    null,
  );
  const [profileLoading, setProfileLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [missions, setMissions] = useState<Mission[]>([]);

  // Workspace experience mode: scaffold-only. TODO(HEL-213): persist via
  // /api/user/profile or the workspace preferences endpoint once it exists.
  const [experienceMode, setExperienceMode] = useState<"pro" | "simple">("pro");

  // Security section — all scaffold-level. TODO(HEL-213-sec): wire these
  // four controls to backend endpoints once they exist. Until then we
  // persist locally only so the UI has something to demonstrate.
  const [ssoEnabled, setSsoEnabled] = useState(false);
  const [sessionTimeoutMinutes, setSessionTimeoutMinutes] = useState(60);
  const [passwordRotationDays, setPasswordRotationDays] = useState(90);
  const [auditRetentionDays, setAuditRetentionDays] = useState(180);

  const workspaceName = activeWorkspace?.name ?? "Workspace";

  const loadProfile = useCallback(async () => {
    setProfileLoading(true);
    try {
      const token = await requireAccessToken();
      const data = await apiGet<{
        profile?: { displayName?: string | null; timezone?: string };
      }>("/api/user/profile", null, token);
      const nextDisplay = data.profile?.displayName ?? "";
      const nextTz = data.profile?.timezone ?? browserTimezone;
      setDisplayName(nextDisplay);
      setTimezone(nextTz);
      setInitial({ displayName: nextDisplay, timezone: nextTz });
    } catch {
      setInitial({ displayName: "", timezone: browserTimezone });
    } finally {
      setProfileLoading(false);
    }
  }, [browserTimezone, requireAccessToken]);

  const loadMissions = useCallback(async () => {
    try {
      const token = await requireAccessToken();
      const list = await listMissions(token).catch(() => [] as Mission[]);
      setMissions(list);
    } catch {
      setMissions([]);
    }
  }, [requireAccessToken]);

  useEffect(() => {
    void loadProfile();
    void loadMissions();
  }, [loadProfile, loadMissions]);

  const missionStatement = useMemo(() => {
    if (missions.length === 0) return "";
    const sorted = [...missions].sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
    );
    return sorted[0]?.statement ?? "";
  }, [missions]);

  const dirty =
    initial !== null &&
    (displayName.trim() !== initial.displayName.trim() ||
      timezone.trim() !== initial.timezone.trim());

  async function handleSaveYou() {
    setSaving(true);
    setSaveError(null);
    try {
      const token = await requireAccessToken();
      const response = await trackedFetch(`${getApiBasePath()}/user/profile`, {
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
    <div className="af2-page" style={{ maxWidth: 920 }}>
      <div className="af2-page-head">
        <div>
          <div className="af2-eyebrow">Account · Workspace</div>
          <h1 className="af2-h1" style={{ marginTop: 6 }}>
            Account
          </h1>
          <div className="af2-page-head-meta">
            {workspaceName} · signed in as {user?.email ?? "—"}
          </div>
        </div>
      </div>

      {/* ============================ You ============================ */}
      <section style={{ marginTop: 16 }}>
        <div className="af2-eyebrow" style={{ marginBottom: 8 }}>
          You
        </div>
        <div className="af2-card" style={{ padding: 18, display: "grid", gap: 14 }}>
          <Field
            label="Display name"
            htmlFor="account-display-name"
            description="How you appear to teammates and inside agent traces."
          >
            <input
              id="account-display-name"
              className="af2-input"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value.slice(0, 200))}
              placeholder={profileLoading ? "Loading…" : "How you appear to teammates"}
              disabled={profileLoading || saving}
            />
          </Field>

          <Field
            label="Email"
            htmlFor="account-email"
            description="Email changes require a confirmation flow — handled separately from Account."
          >
            <input
              id="account-email"
              className="af2-input"
              value={user?.email ?? ""}
              readOnly
              style={{ opacity: 0.7, cursor: "not-allowed" }}
            />
          </Field>

          <Field
            label="Default timezone"
            htmlFor="account-timezone"
            description="Used for displaying timestamps and scheduling routines."
          >
            <input
              id="account-timezone"
              className="af2-input"
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
              placeholder={profileLoading ? "Loading…" : browserTimezone}
              disabled={profileLoading || saving}
            />
          </Field>

          {saveError ? (
            <div
              role="alert"
              style={{
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

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              type="button"
              onClick={() => void handleSaveYou()}
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
      </section>

      {/* ========================== Workspace ========================== */}
      <section style={{ marginTop: 28 }}>
        <div className="af2-eyebrow" style={{ marginBottom: 8 }}>
          Workspace
        </div>
        <div className="af2-card" style={{ padding: 18, display: "grid", gap: 14 }}>
          <Field
            label="Workspace name"
            htmlFor="account-workspace-name"
            description="Workspace renaming is coming soon — use the workspace switcher in the topbar to create a new one."
          >
            <input
              id="account-workspace-name"
              className="af2-input"
              value={workspaceName}
              readOnly
              style={{ opacity: 0.7, cursor: "not-allowed" }}
            />
          </Field>

          <Field
            label="Mission statement"
            htmlFor="account-mission-statement"
            description={
              <>
                Mission statements are authored on the{" "}
                <Link to="/hire" style={{ color: "var(--af2-clay)" }}>
                  Hire page
                </Link>
                .
              </>
            }
          >
            <textarea
              id="account-mission-statement"
              className="af2-input font-af2-serif"
              rows={3}
              defaultValue={missionStatement}
              placeholder={
                missionStatement
                  ? undefined
                  : "No mission set — brief one from the Hire page."
              }
              readOnly
              style={{ fontSize: 15 }}
            />
          </Field>

          <Field
            label="Experience mode"
            htmlFor="account-experience-mode"
            description="Pro shows every advanced control; Simple hides power-user surfaces. Persists per user (TODO: backend wiring)."
          >
            <select
              id="account-experience-mode"
              className="af2-input"
              value={experienceMode}
              onChange={(event) =>
                setExperienceMode(event.target.value as "pro" | "simple")
              }
            >
              <option value="pro">Pro</option>
              <option value="simple">Simple</option>
            </select>
          </Field>
        </div>
      </section>

      {/* ============================ Security ============================ */}
      <section style={{ marginTop: 28 }}>
        <div className="af2-eyebrow" style={{ marginBottom: 8 }}>
          Security
        </div>
        <div className="af2-card" style={{ padding: 18, display: "grid", gap: 16 }}>
          <p className="af2-muted" style={{ fontSize: 12.5, margin: 0, lineHeight: 1.5 }}>
            Scaffold-level — the controls below persist locally only. Backend
            wiring lands in a follow-up (HEL-213 security).
          </p>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 16,
            }}
          >
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 500 }}>
                Single sign-on (SSO)
              </div>
              <div className="af2-muted" style={{ fontSize: 11.5, marginTop: 2 }}>
                Route every workspace login through your IdP.{" "}
                {/* TODO(HEL-213-sec): link to SSO config flow once it exists. */}
                <a href="#sso-todo" style={{ color: "var(--af2-clay)" }}>
                  Configure SSO →
                </a>
              </div>
            </div>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <input
                type="checkbox"
                checked={ssoEnabled}
                onChange={(event) => setSsoEnabled(event.target.checked)}
              />
              <span className="af2-muted-2" style={{ fontSize: 11 }}>
                {ssoEnabled ? "Enabled" : "Disabled"}
              </span>
            </label>
          </div>

          <Field
            label="Session timeout (minutes)"
            htmlFor="account-session-timeout"
            description="Idle sessions auto-sign-out after this window."
          >
            <input
              id="account-session-timeout"
              type="number"
              min={5}
              max={1440}
              step={5}
              className="af2-input"
              value={sessionTimeoutMinutes}
              onChange={(event) =>
                setSessionTimeoutMinutes(Number(event.target.value))
              }
            />
          </Field>

          <Field
            label="Password rotation policy (days)"
            htmlFor="account-password-rotation"
            description="Members are prompted to rotate their password after this many days."
          >
            <input
              id="account-password-rotation"
              type="number"
              min={0}
              max={365}
              step={30}
              className="af2-input"
              value={passwordRotationDays}
              onChange={(event) =>
                setPasswordRotationDays(Number(event.target.value))
              }
            />
          </Field>

          <Field
            label="Audit retention (days)"
            htmlFor="account-audit-retention"
            description="How long admin and approval audit events stay in the workspace ledger."
          >
            <input
              id="account-audit-retention"
              type="number"
              min={30}
              max={3650}
              step={30}
              className="af2-input"
              value={auditRetentionDays}
              onChange={(event) =>
                setAuditRetentionDays(Number(event.target.value))
              }
            />
          </Field>
        </div>
      </section>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  description,
  children,
}: {
  label: string;
  htmlFor: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        style={{ fontSize: 12.5, color: "var(--af2-ink-3)", display: "block" }}
      >
        {label}
      </label>
      <div style={{ marginTop: 6 }}>{children}</div>
      {description ? (
        <p className="af2-muted-2" style={{ fontSize: 11, marginTop: 4 }}>
          {description}
        </p>
      ) : null}
    </div>
  );
}
