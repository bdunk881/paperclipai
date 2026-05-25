/**
 * Account page — v2 shell port (HEL-213 / PR I).
 *
 * Ported from docs/design/v2/preview/consolidation.html lines 1328-1363.
 * Top page-head with eyebrow "Account" + h1 "Account". A `desc-grid` of
 * two cards (You / Workspace), then a Security card with SSO / password /
 * audit buttons, then a Pro · API explorer block.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { trackedFetch } from "../api/trackedFetch";
import { getApiBasePath } from "../api/baseUrl";
import { apiGet } from "../api/settingsClient";
import { listMissions, type Mission } from "../api/missionsApi";
import { useAuth } from "../context/AuthContext";
import { useWorkspace } from "../context/useWorkspace";
import { useToast } from "../components/ToastProvider";
import { ProReveal } from "../components/pro/ProReveal";

export default function Account() {
  const { user, requireAccessToken } = useAuth();
  const { activeWorkspace } = useWorkspace();
  const toast = useToast();

  useEffect(() => {
    document.title = "Account | AutoFlow";
  }, []);

  const browserTimezone =
    Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";

  const [displayName, setDisplayName] = useState("");
  const [timezone, setTimezone] = useState(browserTimezone);
  const [initial, setInitial] = useState<{ displayName: string; timezone: string } | null>(
    null,
  );
  const [profileLoading, setProfileLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [missions, setMissions] = useState<Mission[]>([]);
  const [missionDraft, setMissionDraft] = useState<string>("");
  const [experienceMode, setExperienceMode] = useState<"pro" | "simple">("pro");

  const workspaceName = activeWorkspace?.name ?? "Acme Robotics";

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

  useEffect(() => {
    setMissionDraft(
      missionStatement ||
        "Sell project-management software to design agencies, signing 5 new logos a month.",
    );
  }, [missionStatement]);

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
    <div className="af2-v2">
      <div className="af2-page" style={{ maxWidth: 1100 }}>
        <div className="page-head">
          <div className="page-head-left">
            <div className="eyebrow">Account</div>
            <h1 className="h1">Account</h1>
            <div className="meta">
              User info + workspace + security · absorbs General + Profile + Security.
            </div>
          </div>
        </div>

        <div className="desc-grid">
          <div className="card">
            <h3>You</h3>
            <label className="field">
              Name
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value.slice(0, 200))}
                placeholder={profileLoading ? "Loading…" : "Brad Dunkley"}
                disabled={profileLoading || saving}
              />
            </label>
            <label className="field">
              Email
              <input
                value={user?.email ?? "bdunk881@gmail.com"}
                readOnly
                style={{ opacity: 0.7, cursor: "not-allowed" }}
              />
            </label>
            <label className="field">
              Timezone
              <select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                <option value={timezone}>{timezone}</option>
                <option value="America/New_York">America/New_York</option>
                <option value="America/Los_Angeles">America/Los_Angeles</option>
                <option value="UTC">UTC</option>
              </select>
            </label>
            {saveError ? (
              <div
                role="alert"
                style={{
                  padding: "8px 10px",
                  border: "1px solid rgba(192,84,76,0.30)",
                  background: "rgba(192,84,76,0.10)",
                  color: "var(--af2-clay)",
                  borderRadius: 6,
                  fontSize: 12,
                  marginBottom: 10,
                }}
              >
                {saveError}
              </div>
            ) : null}
            <button
              type="button"
              className="btn primary"
              onClick={() => void handleSaveYou()}
              disabled={!dirty || saving || profileLoading}
            >
              {saving ? (
                <Loader2 size={12} className="animate-spin" style={{ marginRight: 6 }} />
              ) : null}
              Save changes
            </button>
          </div>

          <div className="card">
            <h3>Workspace</h3>
            <label className="field">
              Name
              <input
                value={workspaceName}
                readOnly
                style={{ opacity: 0.7, cursor: "not-allowed" }}
              />
            </label>
            <label className="field">
              Mission
              <textarea
                rows={2}
                value={missionDraft}
                onChange={(e) => setMissionDraft(e.target.value)}
              />
            </label>
            <label className="field">
              Experience mode
              <select
                value={experienceMode}
                onChange={(e) =>
                  setExperienceMode(e.target.value as "pro" | "simple")
                }
              >
                <option value="simple">Simple</option>
                <option value="pro">Pro</option>
              </select>
            </label>
          </div>
        </div>

        <div className="card">
          <h3>Security</h3>
          <p className="desc">
            Single sign-on · session timeout · password rotation · audit
            retention · all merged here from /settings/security.
          </p>
          <div
            style={{
              marginTop: 10,
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <button type="button" className="btn">
              Enable SSO
            </button>
            <button type="button" className="btn">
              Change password
            </button>
            <button type="button" className="btn">
              Audit log
            </button>
          </div>
        </div>

        <ProReveal
          label="API explorer"
          description="Pick a scope and generate a tokened curl example."
        >
          <div className="pro-block">
            <div className="label">Pro · API explorer</div>
            <select style={{ marginBottom: 6 }}>
              <option>scope: read:missions</option>
              <option>scope: write:missions</option>
              <option>scope: read:agents</option>
            </select>
            <pre>{`curl -X GET https://api.helloautoflow.com/v1/missions \\
  -H "Authorization: Bearer $AUTOFLOW_API_KEY"`}</pre>
            <div style={{ marginTop: 8 }}>
              <button type="button" className="btn sm">
                Generate token
              </button>
            </div>
          </div>
        </ProReveal>
      </div>
    </div>
  );
}
