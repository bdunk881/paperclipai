import { useState } from "react";
import { AlertCircle, Monitor, Smartphone, Globe } from "lucide-react";

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
  if (type === "mobile") return <Smartphone size={16} className="text-af2-ink-4" />;
  if (type === "desktop") return <Monitor size={16} className="text-af2-ink-4" />;
  return <Globe size={16} className="text-af2-ink-4" />;
}

export default function SecuritySettings() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);

  const [sessions] = useState<Session[]>([]);

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPwError(null);
    setSaved(false);
    setSaving(true);
    setPwError("Password updates are not available yet because no backend security endpoint is configured.");
    setSaving(false);
  }

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-af2-ink">Security</h1>
        <p className="text-af2-ink-3 mt-1">Manage your password and active sessions.</p>
      </div>

      {/* Change Password */}
      <div className="bg-af2-card rounded-xl border border-af2-line p-6 mb-6">
        <h2 className="text-base font-semibold text-af2-ink mb-4">Change Password</h2>
        <form onSubmit={handlePasswordSubmit} className="space-y-4 max-w-md">
          {pwError && (
            <div className="px-3 py-2 rounded-lg bg-af2-clay-soft/30 border border-af2-clay/30 text-sm text-af2-clay">
              {pwError}
            </div>
          )}
          {saved ? (
            <div className="px-3 py-2 rounded-lg bg-af2-sage/10 border border-af2-sage/30 text-sm text-af2-sage">
              Password updated successfully.
            </div>
          ) : null}

          <div className="px-3 py-2 rounded-lg bg-af2-mustard/10 border border-af2-mustard/30 text-sm text-amber-800">
            Password management is not connected to a backend endpoint in this environment yet.
          </div>

          <div>
            <label className="block text-sm font-medium text-af2-ink-2 mb-1">Current Password</label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              className="w-full px-3 py-2 rounded-lg border border-af2-line-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-af2-ink-2 mb-1">New Password</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              className="w-full px-3 py-2 rounded-lg border border-af2-line-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-af2-ink-2 mb-1">Confirm New Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              className="w-full px-3 py-2 rounded-lg border border-af2-line-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="pt-1">
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 rounded-lg bg-af2-ink-blue text-white text-sm font-medium hover:bg-af2-ink-blue disabled:opacity-60 transition-colors"
            >
              {saving ? "Updating…" : "Update password"}
            </button>
          </div>
        </form>
      </div>

      {/* Active Sessions */}
      <div className="bg-af2-card rounded-xl border border-af2-line p-6">
        <h2 className="text-base font-semibold text-af2-ink mb-4">Active Sessions</h2>
        {sessions.length > 0 ? (
          <div className="divide-y divide-gray-100">
            {sessions.map((session) => (
              <div key={session.id} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                <div className="flex items-center gap-3">
                  <DeviceIcon type={session.deviceType} />
                  <div>
                    <p className="text-sm font-medium text-af2-ink">
                      {session.device}
                      {session.current ? (
                        <span className="ml-2 text-xs font-normal text-af2-sage bg-af2-sage/10 px-1.5 py-0.5 rounded-full">
                          Current
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-af2-ink-4">
                      {session.ip} · {session.location} · {session.lastActive}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-af2-line bg-af2-paper-2/40 px-5 py-10 text-center">
            <AlertCircle size={22} className="mx-auto mb-3 text-af2-ink-3" />
            <p className="text-sm font-medium text-af2-ink-2">No active session data available</p>
            <p className="mt-1 text-sm text-af2-ink-3">
              This environment does not expose a backend session-management endpoint yet.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
