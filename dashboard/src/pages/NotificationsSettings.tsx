import { AlertCircle } from "lucide-react";

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
  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Notifications</h1>
        <p className="text-gray-500 mt-1">Choose when and how you get notified.</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-1">Email Notifications</h2>
        <p className="text-sm text-gray-400 mb-5">Notifications are sent to your account email address.</p>

        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Notification preferences are not connected to a backend endpoint in this environment yet.
        </div>

        <div className="divide-y divide-gray-100">
          {NOTIFICATION_OPTIONS.map((option) => (
            <div key={option.id} className="flex items-center justify-between py-4 first:pt-0">
              <div>
                <p className="text-sm font-medium text-gray-900">{option.label}</p>
                <p className="text-xs text-gray-400 mt-0.5">{option.description}</p>
              </div>
              <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-500">
                Unavailable
              </span>
            </div>
          ))}
        </div>

        <div className="mt-5 rounded-xl border border-dashed border-gray-200 bg-gray-50 px-5 py-8 text-center">
          <AlertCircle size={22} className="mx-auto mb-3 text-gray-300" />
          <p className="text-sm font-medium text-gray-700">No notification settings available yet</p>
          <p className="mt-1 text-sm text-gray-500">
            Preferences will appear here once the notifications API is implemented.
          </p>
        </div>
      </div>
    </div>
  );
}
