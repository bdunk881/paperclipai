import { useEffect, useMemo, useState } from "react";
import { Monitor, Smartphone, Globe, Loader2 } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { apiDelete, ApiError, apiGet, apiPost } from "../api/settingsClient";
import Toast from "../components/Toast";

interface Session {
  id: string;
  device: string;
  deviceType: "desktop" | "mobile" | "browser";
  ip: string;
  location: string;
  lastActive: string;
  current: boolean;
}

function DeviceIcon({ type }: { type: Session["deviceType"] }) {
  if (type === "mobile") return <Smartphone size={16} className="text-gray-400" />;
  if (type === "desktop") return <Monitor size={16} className="text-gray-400" />;
  return <Globe size={16} className="text-gray-400" />;
}

export default function SecuritySettings() {
  const { user } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [sessionsUnavailable, setSessionsUnavailable] = useState(false);
  const [passwordUnavailable, setPasswordUnavailable] = useState(false);
  const [toast, setToast] = useState<{ variant: "success" | "error"; message: string } | null>(null);

  const [sessions, setSessions] = useState<Session[]>([]);

  const disablePasswordForm = useMemo(
    () => passwordUnavailable || sessionsUnavailable,
    [passwordUnavailable, sessionsUnavailable]
  );

  useEffect(() => {
    let cancelled = false;

    async function loadSessions() {
      setSessionsLoading(true);
      setSessionsError(null);
      try {
        const data = await apiGet<{ sessions: Session[] }>("/api/user/sessions", user);
        if (cancelled) return;
        setSessions(data.sessions ?? []);
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && (e.status === 404 || e.status === 501)) {
          setSessionsUnavailable(true);
          setSessions([]);
          return;
        }
        setSessionsError(e instanceof Error ? e.message : "Failed to load active sessions.");
      } finally {
        if (!cancelled) setSessionsLoading(false);
      }
    }

    void loadSessions();
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPwError(null);
    setSaved(false);

    if (!currentPassword) {
      setPwError("Current password is required.");
      return;
    }
    if (newPassword.length < 8) {
      setPwError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwError("Passwords do not match.");
      return;
    }

    setSaving(true);
    try {
      await apiPost("/api/user/password", { currentPassword, newPassword }, user);
      setSaved(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setToast({ variant: "success", message: "Password updated successfully." });
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 404 || e.status === 501)) {
        setPasswordUnavailable(true);
        setPwError("Password updates are not available yet.");
      } else {
        setPwError("Failed to update password. Please try again.");
      }
      setToast({
        variant: "error",
        message: e instanceof Error ? e.message : "Password update failed.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleRevoke(id: string) {
    setRevokingId(id);
    try {
      await apiDelete(`/api/user/sessions/${id}`, user);
      setSessions((prev) => prev.filter((s) => s.id !== id));
      setToast({ variant: "success", message: "Session revoked." });
    } catch (e) {
      if (e instanceof ApiError && (e.status === 404 || e.status === 501)) {
        setSessionsUnavailable(true);
      }
      setToast({
        variant: "error",
        message: e instanceof Error ? e.message : "Failed to revoke session.",
      });
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <div className="p-8 max-w-4xl">
      {toast && <Toast variant={toast.variant} message={toast.message} />}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Security</h1>
        <p className="text-gray-500 mt-1">Manage your password and active sessions.</p>
      </div>

      {/* Change Password */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Change Password</h2>
        <form onSubmit={handlePasswordSubmit} className="space-y-4 max-w-md">
          {pwError && (
            <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
              {pwError}
            </div>
          )}
          {saved && (
            <div className="px-3 py-2 rounded-lg bg-green-50 border border-green-200 text-sm text-green-700">
              Password updated successfully.
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Current Password</label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Confirm New Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="pt-1">
            <button
              type="submit"
              disabled={saving || disablePasswordForm}
              className="px-5 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-60 transition-colors"
            >
              {saving ? "Updating…" : "Update password"}
            </button>
            {disablePasswordForm && (
              <p className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                Security mutation APIs are not available yet. This section is read-only until backend support lands.
              </p>
            )}
          </div>
        </form>
      </div>

      {/* Active Sessions */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Active Sessions</h2>
        {sessionsLoading ? (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Loader2 size={16} className="animate-spin" />
            Loading active sessions...
          </div>
        ) : sessionsError ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {sessionsError}
          </div>
        ) : sessionsUnavailable ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3">
            <p className="text-sm font-medium text-amber-800">Session management coming soon</p>
            <p className="text-xs text-amber-700 mt-1">
              The backend endpoint for session listing/revocation is not available yet.
            </p>
          </div>
        ) : sessions.length === 0 ? (
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-3">
            <p className="text-sm font-medium text-gray-700">No active sessions found.</p>
            <p className="text-xs text-gray-500 mt-1">
              You are likely only signed in on this device, or recent sessions have expired.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {sessions.map((session) => (
              <div key={session.id} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                <div className="flex items-center gap-3">
                  <DeviceIcon type={session.deviceType} />
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {session.device}
                      {session.current && (
                        <span className="ml-2 text-xs font-normal text-green-600 bg-green-50 px-1.5 py-0.5 rounded-full">
                          Current
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-gray-400">
                      {session.ip} · {session.location} · {session.lastActive}
                    </p>
                  </div>
                </div>
                {!session.current && (
                  <button
                    onClick={() => void handleRevoke(session.id)}
                    disabled={revokingId === session.id}
                    className="text-xs text-red-500 hover:text-red-700 font-medium px-2 py-1 rounded-lg hover:bg-red-50 disabled:opacity-60 transition-colors"
                  >
                    {revokingId === session.id ? "Revoking..." : "Revoke"}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
