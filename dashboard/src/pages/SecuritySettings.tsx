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
  if (type === "mobile") return <Smartphone size={16} className="text-gray-400" />;
  if (type === "desktop") return <Monitor size={16} className="text-gray-400" />;
  return <Globe size={16} className="text-gray-400" />;
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
          {saved ? (
            <div className="px-3 py-2 rounded-lg bg-green-50 border border-green-200 text-sm text-green-700">
              Password updated successfully.
            </div>
          ) : null}

          <div className="px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
            Password management is not connected to a backend endpoint in this environment yet.
          </div>

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
              disabled={saving}
              className="px-5 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-60 transition-colors"
            >
              {saving ? "Updating…" : "Update password"}
            </button>
          </div>
        </form>
      </div>

      {/* Active Sessions */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Active Sessions</h2>
        {sessions.length > 0 ? (
          <div className="divide-y divide-gray-100">
            {sessions.map((session) => (
              <div key={session.id} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                <div className="flex items-center gap-3">
                  <DeviceIcon type={session.deviceType} />
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {session.device}
                      {session.current ? (
                        <span className="ml-2 text-xs font-normal text-green-600 bg-green-50 px-1.5 py-0.5 rounded-full">
                          Current
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-gray-400">
                      {session.ip} · {session.location} · {session.lastActive}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-5 py-10 text-center">
            <AlertCircle size={22} className="mx-auto mb-3 text-gray-300" />
            <p className="text-sm font-medium text-gray-700">No active session data available</p>
            <p className="mt-1 text-sm text-gray-500">
              This environment does not expose a backend session-management endpoint yet.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
