import { useState } from "react";
import { Monitor, Smartphone, Globe } from "lucide-react";

interface Session {
  id: string;
  device: string;
  deviceType: "desktop" | "mobile" | "browser";
  ip: string;
  location: string;
  lastActive: string;
  current: boolean;
}

const MOCK_SESSIONS: Session[] = [
  {
    id: "1",
    device: "Chrome on macOS",
    deviceType: "browser",
    ip: "192.168.1.1",
    location: "New York, US",
    lastActive: "Now",
    current: true,
  },
  {
    id: "2",
    device: "Safari on iPhone",
    deviceType: "mobile",
    ip: "10.0.0.2",
    location: "New York, US",
    lastActive: "2 hours ago",
    current: false,
  },
  {
    id: "3",
    device: "Firefox on Windows",
    deviceType: "desktop",
    ip: "203.0.113.42",
    location: "London, UK",
    lastActive: "3 days ago",
    current: false,
  },
];

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

  const [sessions, setSessions] = useState<Session[]>(MOCK_SESSIONS);

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
      await new Promise((res) => setTimeout(res, 600));
      setSaved(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setPwError("Failed to update password. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  function handleRevoke(id: string) {
    setSessions((prev) => prev.filter((s) => s.id !== id));
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
              className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Confirm New Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary"
            />
          </div>

          <div className="pt-1">
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 rounded-lg bg-brand-primary text-white text-sm font-medium hover:bg-brand-primary-hover disabled:opacity-60 transition-colors"
            >
              {saving ? "Updating…" : "Update password"}
            </button>
          </div>
        </form>
      </div>

      {/* Active Sessions */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Active Sessions</h2>
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
                  onClick={() => handleRevoke(session.id)}
                  className="text-xs text-red-500 hover:text-red-700 font-medium px-2 py-1 rounded-lg hover:bg-red-50 transition-colors"
                >
                  Revoke
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
