import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Globe, KeyRound, Loader2, Monitor, ShieldCheck, Smartphone } from "lucide-react";
import {
  listSecuritySessions,
  revokeOtherSecuritySessions,
  revokeSecuritySession,
  updatePassword,
  type SecuritySession,
  type SecuritySessionCapabilities,
} from "../api/securityApi";
import { useAuth } from "../context/AuthContext";
import { MfaSettingsCard } from "./security/MfaSettingsCard";

function DeviceIcon({ type }: { type: SecuritySession["deviceType"] }) {
  if (type === "mobile") return <Smartphone size={16} className="text-af2-ink-4" />;
  if (type === "desktop") return <Monitor size={16} className="text-af2-ink-4" />;
  return <Globe size={16} className="text-af2-ink-4" />;
}

function formatDate(value: string | null): string {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

const DEFAULT_CAPABILITIES: SecuritySessionCapabilities = {
  canListOtherSessions: false,
  canRevokeSelectedSessions: false,
  canRevokeOtherSessions: false,
};

export default function SecuritySettings() {
  const { requireAccessToken, logout } = useAuth();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);

  const [sessions, setSessions] = useState<SecuritySession[]>([]);
  const [capabilities, setCapabilities] = useState<SecuritySessionCapabilities>(DEFAULT_CAPABILITIES);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const [revokingSessionId, setRevokingSessionId] = useState<string | null>(null);
  const [revokingOthers, setRevokingOthers] = useState(false);

  const activeOtherSessions = useMemo(
    () => sessions.filter((session) => !session.current).length,
    [sessions],
  );

  const refreshSessions = useCallback(async () => {
    setSessionsLoading(true);
    setSessionsError(null);
    try {
      const accessToken = await requireAccessToken();
      const response = await listSecuritySessions(accessToken);
      setSessions(response.sessions);
      setCapabilities(response.capabilities);
    } catch (error) {
      setSessionsError(error instanceof Error ? error.message : "Could not load active sessions.");
    } finally {
      setSessionsLoading(false);
    }
  }, [requireAccessToken]);

  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPwError(null);
    setSaved(false);

    if (!currentPassword.trim()) {
      setPwError("Current password is required.");
      return;
    }
    if (newPassword.length < 12) {
      setPwError("New password must be at least 12 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwError("New password and confirmation do not match.");
      return;
    }

    setSaving(true);
    try {
      const accessToken = await requireAccessToken();
      await updatePassword({ currentPassword, newPassword }, accessToken);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSaved(true);
    } catch (error) {
      setPwError(error instanceof Error ? error.message : "Password update failed.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRevokeSession(session: SecuritySession) {
    setSessionNotice(null);
    setSessionsError(null);
    setRevokingSessionId(session.id);
    try {
      const accessToken = await requireAccessToken();
      const result = await revokeSecuritySession(session.id, accessToken);
      if (result.currentSessionRevoked) {
        logout();
        return;
      }
      setSessionNotice("Session revoked.");
      await refreshSessions();
    } catch (error) {
      setSessionsError(error instanceof Error ? error.message : "Could not revoke session.");
    } finally {
      setRevokingSessionId(null);
    }
  }

  async function handleRevokeOthers() {
    setSessionNotice(null);
    setSessionsError(null);
    setRevokingOthers(true);
    try {
      const accessToken = await requireAccessToken();
      await revokeOtherSecuritySessions(accessToken);
      setSessionNotice("Other sessions revoked.");
      await refreshSessions();
    } catch (error) {
      setSessionsError(error instanceof Error ? error.message : "Could not revoke other sessions.");
    } finally {
      setRevokingOthers(false);
    }
  }

  return (
    <div className="af2-page max-w-5xl">
      <div className="af2-page-head">
        <div>
          <div className="af2-eyebrow">Settings / Security</div>
          <h1 className="af2-h1 mt-1.5">Security</h1>
          <div className="af2-page-head-meta">
            Manage your password and active sessions.
          </div>
        </div>
      </div>

      <MfaSettingsCard />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] mt-6">
        <section className="rounded-xl border border-af2-line bg-af2-card p-6">
          <div className="mb-5 flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-lg border border-af2-line bg-af2-paper">
              <KeyRound size={17} className="text-af2-clay" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-af2-ink">Change Password</h2>
              <p className="text-sm text-af2-ink-3">Current password confirmation is required.</p>
            </div>
          </div>

          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            {pwError && (
              <div className="rounded-lg border border-af2-clay/30 bg-af2-clay-soft/30 px-3 py-2 text-sm text-af2-clay">
                {pwError}
              </div>
            )}
            {saved ? (
              <div className="flex items-center gap-2 rounded-lg border border-af2-sage/30 bg-af2-sage/10 px-3 py-2 text-sm text-af2-sage">
                <CheckCircle2 size={16} />
                Password updated successfully.
              </div>
            ) : null}

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-af2-ink-2">Current Password</span>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                className="w-full rounded-lg border border-af2-line-2 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-af2-clay/40"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-af2-ink-2">New Password</span>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                className="w-full rounded-lg border border-af2-line-2 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-af2-clay/40"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-af2-ink-2">Confirm New Password</span>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                className="w-full rounded-lg border border-af2-line-2 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-af2-clay/40"
              />
            </label>

            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-af2-ink-blue px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-af2-ink-blue disabled:opacity-60"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
              {saving ? "Updating..." : "Update password"}
            </button>
          </form>
        </section>

        <section className="rounded-xl border border-af2-line bg-af2-card p-6">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-af2-ink">Active Sessions</h2>
              <p className="text-sm text-af2-ink-3">
                {sessionsLoading ? "Loading sessions..." : `${sessions.length} active session${sessions.length === 1 ? "" : "s"}`}
              </p>
            </div>
            <button
              type="button"
              onClick={handleRevokeOthers}
              disabled={revokingOthers || activeOtherSessions === 0 || !capabilities.canRevokeOtherSessions}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-af2-line bg-af2-paper px-3 py-2 text-sm font-medium text-af2-ink-2 hover:border-af2-clay/50 disabled:cursor-not-allowed disabled:opacity-55"
            >
              {revokingOthers ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />}
              Revoke other sessions
            </button>
          </div>

          {sessionsError ? (
            <div className="mb-4 rounded-lg border border-af2-clay/30 bg-af2-clay-soft/30 px-3 py-2 text-sm text-af2-clay">
              {sessionsError}
            </div>
          ) : null}
          {sessionNotice ? (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-af2-sage/30 bg-af2-sage/10 px-3 py-2 text-sm text-af2-sage">
              <CheckCircle2 size={16} />
              {sessionNotice}
            </div>
          ) : null}

          {sessionsLoading ? (
            <div className="grid min-h-52 place-items-center rounded-xl border border-dashed border-af2-line bg-af2-paper-2/40">
              <Loader2 size={24} className="animate-spin text-af2-ink-3" />
            </div>
          ) : sessions.length > 0 ? (
            <div className="divide-y divide-af2-line">
              {sessions.map((session) => (
                <div key={session.id} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-af2-line bg-af2-paper">
                      <DeviceIcon type={session.deviceType} />
                    </span>
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-af2-ink">
                        <span className="truncate">{session.device}</span>
                        {session.current ? (
                          <span className="rounded-full bg-af2-sage/10 px-2 py-0.5 text-xs font-normal text-af2-sage">
                            Current
                          </span>
                        ) : null}
                      </p>
                      <p className="mt-1 text-xs text-af2-ink-4">
                        {session.ip} - {session.location} - Last active {formatDate(session.lastActive)}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => void handleRevokeSession(session)}
                    disabled={revokingSessionId === session.id || (!session.current && !capabilities.canRevokeSelectedSessions)}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-af2-line bg-af2-paper px-3 py-2 text-sm font-medium text-af2-ink-2 hover:border-af2-clay/50 disabled:cursor-not-allowed disabled:opacity-55"
                  >
                    {revokingSessionId === session.id ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />}
                    {session.current ? "Sign out current session" : "Revoke"}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-af2-line bg-af2-paper-2/40 px-5 py-10 text-center">
              <AlertCircle size={22} className="mx-auto mb-3 text-af2-ink-3" />
              <p className="text-sm font-medium text-af2-ink-2">No active session data available</p>
              <p className="mt-1 text-sm text-af2-ink-3">
                Sign in again if this page cannot identify the current session.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
