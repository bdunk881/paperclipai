import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { ApiError, apiGet, apiPatch } from "../api/settingsClient";
import Toast from "../components/Toast";

const TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "America/Vancouver",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Amsterdam",
  "Europe/Moscow",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Bangkok",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Asia/Singapore",
  "Australia/Sydney",
  "Pacific/Auckland",
];

export default function ProfileSettings() {
  const { user, requireAccessToken } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ variant: "success" | "error"; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fallbackStorageKey = useMemo(
    () => `autoflow.profile-settings:${user?.id ?? "anonymous"}`,
    [user?.id]
  );

  useEffect(() => {
    let cancelled = false;

    async function loadProfile() {
      setLoading(true);
      setError(null);
      try {
        const accessToken = await requireAccessToken();
        const data = await apiGet<{ profile?: { displayName?: string; timezone?: string } }>(
          "/api/user/profile",
          user,
          accessToken
        );
        if (cancelled) return;
        setDisplayName(data.profile?.displayName ?? user?.name ?? "");
        setTimezone(data.profile?.timezone ?? "UTC");
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 404) {
          const raw = sessionStorage.getItem(fallbackStorageKey);
          const fallback = raw
            ? (JSON.parse(raw) as { displayName?: string; timezone?: string })
            : null;
          setDisplayName(fallback?.displayName ?? user?.name ?? "");
          setTimezone(fallback?.timezone ?? "UTC");
          return;
        }
        setDisplayName(user?.name ?? "");
        setTimezone("UTC");
        setError(e instanceof Error ? e.message : "Failed to load profile.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadProfile();
    return () => {
      cancelled = true;
    };
  }, [fallbackStorageKey, requireAccessToken, user]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const accessToken = await requireAccessToken();
      await apiPatch(
        "/api/user/profile",
        { displayName: displayName.trim(), timezone },
        user,
        accessToken
      );
      setToast({ variant: "success", message: "Profile saved successfully." });
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        sessionStorage.setItem(
          fallbackStorageKey,
          JSON.stringify({ displayName: displayName.trim(), timezone })
        );
        setToast({
          variant: "success",
          message: "Profile saved locally while the backend endpoint is pending.",
        });
      } else {
        setError("Failed to save profile. Please try again.");
        setToast({
          variant: "error",
          message: e instanceof Error ? e.message : "Profile save failed.",
        });
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="af2-page">
        <div className="flex items-center gap-2 text-sm text-af2-ink-3">
          <Loader2 size={16} className="animate-spin" />
          Loading profile settings...
        </div>
      </div>
    );
  }

  return (
    <div className="af2-page" style={{ maxWidth: 920 }}>
      {toast && <Toast variant={toast.variant} message={toast.message} />}
      <div className="af2-page-head">
        <div>
          <div className="af2-eyebrow">Settings · Profile</div>
          <h1 className="af2-h1" style={{ marginTop: 6 }}>Profile</h1>
          <div className="af2-page-head-meta">
            Update your display name and account preferences.
          </div>
        </div>
      </div>

      <div className="bg-af2-card rounded-xl border border-af2-line p-6">
        <form onSubmit={handleSubmit} className="space-y-5 max-w-md">
          {error && (
            <div className="px-3 py-2 rounded-lg bg-af2-clay-soft/30 border border-af2-clay/30 text-sm text-af2-clay">
              {error}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-af2-ink-2 mb-1">
              Display Name
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your name"
              className="w-full px-3 py-2 rounded-lg border border-af2-line-2 text-sm focus:outline-none focus:ring-2 focus:ring-af2-clay/40"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-af2-ink-2 mb-1">
              Email
            </label>
            <input
              type="email"
              value={user?.email ?? ""}
              readOnly
              className="w-full px-3 py-2 rounded-lg border border-af2-line text-sm bg-af2-paper-2/40 text-af2-ink-4 cursor-not-allowed"
            />
            <p className="mt-1 text-xs text-af2-ink-4">Email cannot be changed from this page.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-af2-ink-2 mb-1">
              Timezone
            </label>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-af2-line-2 text-sm focus:outline-none focus:ring-2 focus:ring-af2-clay/40 bg-af2-card"
            >
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>{tz}</option>
              ))}
            </select>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 rounded-lg bg-af2-ink-blue text-white text-sm font-medium hover:bg-af2-ink-blue disabled:opacity-60 transition-colors"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
