import { useState } from "react";
import { CheckCircle, XCircle, Clock, User, MessageSquare, AlertCircle } from "lucide-react";

interface ApprovalItem {
  id: string;
  workflowName: string;
  runId: string;
  stepName: string;
  requestedAt: string;
  assignee: string;
  message: string;
  timeoutMinutes: number;
  status: "pending" | "approved" | "rejected" | "timed_out";
}

const MOCK_APPROVALS: ApprovalItem[] = [
  {
    id: "appr-1",
    workflowName: "Customer Onboarding Pipeline",
    runId: "run-abc123",
    stepName: "Legal Review Gate",
    requestedAt: "2026-04-01T20:15:00Z",
    assignee: "legal@company.com",
    message:
      "Please review the generated contract terms for customer ACME Corp before proceeding with the onboarding.",
    timeoutMinutes: 60,
    status: "pending",
  },
  {
    id: "appr-2",
    workflowName: "Invoice Processing",
    runId: "run-def456",
    stepName: "Finance Approval",
    requestedAt: "2026-04-01T18:30:00Z",
    assignee: "finance@company.com",
    message:
      "Invoice #INV-2890 for $12,500 requires manual approval. Vendor: Acme Supplies Ltd.",
    timeoutMinutes: 120,
    status: "pending",
  },
  {
    id: "appr-3",
    workflowName: "Content Publishing",
    runId: "run-ghi789",
    stepName: "Editor Review",
    requestedAt: "2026-04-01T14:00:00Z",
    assignee: "editor@company.com",
    message: "Blog post draft is ready for editorial review before scheduled publish.",
    timeoutMinutes: 30,
    status: "approved",
  },
  {
    id: "appr-4",
    workflowName: "HR Workflow",
    runId: "run-jkl012",
    stepName: "Offer Letter Sign-off",
    requestedAt: "2026-04-01T09:00:00Z",
    assignee: "hr@company.com",
    message: "Offer letter for candidate Jane Smith requires final sign-off.",
    timeoutMinutes: 240,
    status: "rejected",
  },
];

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const STATUS_CONFIG = {
  pending: { label: "Pending", color: "bg-yellow-100 text-yellow-700", icon: Clock },
  approved: { label: "Approved", color: "bg-green-100 text-green-700", icon: CheckCircle },
  rejected: { label: "Rejected", color: "bg-red-100 text-red-700", icon: XCircle },
  timed_out: { label: "Timed Out", color: "bg-gray-100 text-gray-500", icon: AlertCircle },
};

export default function Approvals() {
  const [approvals, setApprovals] = useState<ApprovalItem[]>(MOCK_APPROVALS);
  const [filter, setFilter] = useState<"all" | "pending" | "resolved">("all");

  function resolve(id: string, decision: "approved" | "rejected") {
    setApprovals((prev) =>
      prev.map((a) => (a.id === id ? { ...a, status: decision } : a))
    );
  }

  const filtered = approvals.filter((a) => {
    if (filter === "pending") return a.status === "pending";
    if (filter === "resolved") return a.status !== "pending";
    return true;
  });

  const pendingCount = approvals.filter((a) => a.status === "pending").length;

  return (
    <div className="min-h-full bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-8 py-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">Approvals</h1>
              {pendingCount > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 text-xs font-semibold">
                  {pendingCount} pending
                </span>
              )}
              <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 text-xs font-medium">
                In Development
              </span>
            </div>
            <p className="text-gray-500 text-sm mt-1">
              Review and resolve human-in-the-loop approval requests from your workflows.
            </p>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1 mt-5">
          {(["all", "pending", "resolved"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium capitalize transition ${
                filter === f
                  ? "bg-gray-900 text-white"
                  : "text-gray-500 hover:bg-gray-100"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Approval list */}
      <div className="max-w-4xl mx-auto px-8 py-6 space-y-4">
        {filtered.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <CheckCircle size={40} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">No approvals to show</p>
          </div>
        )}

        {filtered.map((item) => {
          const cfg = STATUS_CONFIG[item.status];
          const StatusIcon = cfg.icon;

          return (
            <div
              key={item.id}
              className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-gray-900 text-sm">
                      {item.workflowName}
                    </span>
                    <span className="text-gray-300">›</span>
                    <span className="text-gray-600 text-sm">{item.stepName}</span>
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}
                    >
                      <StatusIcon size={11} />
                      {cfg.label}
                    </span>
                  </div>

                  <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
                    <span className="flex items-center gap-1">
                      <User size={11} />
                      {item.assignee}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock size={11} />
                      {timeAgo(item.requestedAt)}
                    </span>
                    <span>Run: {item.runId}</span>
                    <span>Timeout: {item.timeoutMinutes}min</span>
                  </div>

                  <div className="mt-3 flex items-start gap-2 p-3 bg-gray-50 rounded-lg">
                    <MessageSquare size={13} className="text-gray-400 mt-0.5 shrink-0" />
                    <p className="text-sm text-gray-700 leading-relaxed">{item.message}</p>
                  </div>
                </div>
              </div>

              {item.status === "pending" && (
                <div className="flex gap-2 mt-4 pt-4 border-t border-gray-100">
                  <button
                    onClick={() => resolve(item.id, "approved")}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-medium transition"
                  >
                    <CheckCircle size={15} />
                    Approve
                  </button>
                  <button
                    onClick={() => resolve(item.id, "rejected")}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 text-sm font-medium transition"
                  >
                    <XCircle size={15} />
                    Reject
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
