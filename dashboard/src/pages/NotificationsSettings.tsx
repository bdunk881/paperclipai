import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { ApiError, apiGet, apiPatch } from "../api/settingsClient";
import Toast from "../components/Toast";

interface NotificationToggle {
  id: string;
  label: string;
  description: string;
}

const NOTIFICATION_OPTIONS: NotificationToggle[] = [
  {
    id: "run_completed",
    label: "Workflow run completed",
    description: "Receive an email when a workflow run finishes successfully.",
  },
  {
    id: "run_failed",
    label: "Workflow run failed",
    description: "Receive an email when a workflow run encounters an error.",
  },
  {
    id: "weekly_digest",
    label: "Weekly activity digest",
    description: "A summary of your workflow activity every week.",
  },
  {
    id: "product_updates",
    label: "Product updates & announcements",
    description: "News about new features and platform improvements.",
  },
];

export default function NotificationsSettings() {
  const { user } = useAuth();
  const [toggles, setToggles] = useState<Record<string, boolean>>({
    run_completed: true,
    run_failed: true,
    weekly_digest: false,
    product_updates: false,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ variant: "success" | "error"; message: string } | null>(null);

  const fallbackStorageKey = useMemo(
    () => `autoflow.notification-settings:${user?.id ?? "anonymous"}`,
    [user?.id]
  );

  useEffect(() => {
    let cancelled = false;

    async function loadSettings() {
      setLoading(true);
      setError(null);
      try {
        const data = await apiGet<{ notifications?: Record<string, boolean> }>(
          "/api/user/notifications",
          user
        );
        if (cancelled) return;
        if (data.notifications) setToggles((prev) => ({ ...prev, ...data.notifications }));
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && (e.status === 404 || e.status === 501)) {
          const raw = localStorage.getItem(fallbackStorageKey);
          const fallback = raw ? (JSON.parse(raw) as Record<string, boolean>) : null;
          if (fallback) setToggles((prev) => ({ ...prev, ...fallback }));
          return;
        }
        setError(e instanceof Error ? e.message : "Failed to load notification preferences.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadSettings();
    return () => {
      cancelled = true;
    };
  }, [fallbackStorageKey, user]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function handleToggle(id: string) {
    setToggles((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await apiPatch("/api/user/notifications", { notifications: toggles }, user);
      setToast({ variant: "success", message: "Preferences saved." });
    } catch (e) {
      if (e instanceof ApiError && (e.status === 404 || e.status === 501)) {
        localStorage.setItem(fallbackStorageKey, JSON.stringify(toggles));
        setToast({
          variant: "success",
          message: "Preferences saved locally while the backend endpoint is pending.",
        });
      } else {
        setError("Failed to save preferences. Please try again.");
        setToast({
          variant: "error",
          message: e instanceof Error ? e.message : "Failed to save preferences.",
        });
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="p-8 max-w-4xl">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 size={16} className="animate-spin" />
          Loading notification settings...
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-4xl">
      {toast && <Toast variant={toast.variant} message={toast.message} />}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Notifications</h1>
        <p className="text-gray-500 mt-1">Choose when and how you get notified.</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-1">Email Notifications</h2>
        <p className="text-sm text-gray-400 mb-5">Notifications are sent to your account email address.</p>

        {error && (
          <div className="mb-4 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
            {error}
          </div>
        )}
        <div className="divide-y divide-gray-100">
          {NOTIFICATION_OPTIONS.map((option) => (
            <div key={option.id} className="flex items-center justify-between py-4 first:pt-0">
              <div>
                <p className="text-sm font-medium text-gray-900">{option.label}</p>
                <p className="text-xs text-gray-400 mt-0.5">{option.description}</p>
              </div>
              <button
                role="switch"
                aria-checked={toggles[option.id]}
                onClick={() => handleToggle(option.id)}
                className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 ${
                  toggles[option.id] ? "bg-blue-600" : "bg-gray-200"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ${
                    toggles[option.id] ? "translate-x-4" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
          ))}
        </div>

        <div className="mt-5 pt-4 border-t border-gray-100">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-60 transition-colors"
          >
            {saving ? "Saving…" : "Save preferences"}
          </button>
        </div>
      </div>
    </div>
  );
}
