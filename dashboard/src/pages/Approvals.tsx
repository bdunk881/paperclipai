import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import {
  CheckCircle,
  XCircle,
  Clock,
  User,
  MessageSquare,
  AlertCircle,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { listApprovals, resolveApproval, type ApprovalRequest } from "../api/client";
import { useAuth } from "../context/AuthContext";

const POLL_INTERVAL_MS = 10_000;

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const STATUS_CONFIG: Record<
  ApprovalRequest["status"],
  { label: string; badge: string; card: string; icon: React.ElementType }
> = {
  pending: {
    label: "Awaiting Input",
    badge: "bg-orange-100 text-orange-700",
    card: "border-orange-300 border-dashed",
    icon: Clock,
  },
  approved: {
    label: "Approved",
    badge: "bg-teal-100 text-teal-700",
    card: "border-teal-300",
    icon: CheckCircle,
  },
  rejected: {
    label: "Rejected",
    badge: "bg-red-100 text-red-700",
    card: "border-red-300",
    icon: XCircle,
  },
  timed_out: {
    label: "Timed Out",
    badge: "bg-gray-100 text-gray-500",
    card: "border-slate-300",
    icon: AlertCircle,
  },
};

export default function Approvals() {
  const { requireAccessToken } = useAuth();
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [filter, setFilter] = useState<"all" | "pending" | "resolved">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState(new Date());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function fetchApprovals() {
    try {
      const accessToken = await requireAccessToken();
      const data = await listApprovals(accessToken);
      setApprovals(data);
      setLastRefreshed(new Date());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load approvals");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchApprovals();
    intervalRef.current = setInterval(fetchApprovals, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  function handleResolved(id: string, decision: "approved" | "rejected") {
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
                <span className="px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 text-xs font-semibold">
                  {pendingCount} pending
                </span>
              )}
            </div>
            <p className="text-gray-500 text-sm mt-1">
              Review and resolve human-in-the-loop approval requests from your workflows.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400">
              Updated: {lastRefreshed.toLocaleTimeString()}
            </span>
            <button
              onClick={fetchApprovals}
              className="flex items-center gap-2 px-3.5 py-2 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-50 transition text-gray-700"
            >
              <RefreshCw size={14} />
              Refresh
            </button>
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

      {/* Content */}
      <div className="max-w-4xl mx-auto px-8 py-6 space-y-4">
        {loading && (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <Loader2 size={24} className="animate-spin mr-2" />
            <span className="text-sm">Loading approvals…</span>
          </div>
        )}

        {!loading && error && (
          <div className="flex items-center gap-2 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            <AlertCircle size={16} />
            <span>{error}</span>
            <button
              onClick={fetchApprovals}
              className="ml-auto text-xs underline hover:no-underline"
            >
              Retry
            </button>
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <CheckCircle size={40} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm font-medium text-gray-500">
              {filter === "pending"
                ? "No pending approvals"
                : filter === "resolved"
                ? "No resolved approvals yet"
                : "No approvals yet"}
            </p>
            {filter === "pending" && (
              <p className="text-xs text-gray-400 mt-1">
                Start a workflow with an approval step from the{" "}
                <Link to="/builder" className="text-blue-600 hover:underline">
                  builder
                </Link>
                .
              </p>
            )}
          </div>
        )}

        {!loading &&
          filtered.map((item) => (
            <ApprovalCard
              key={item.id}
              item={item}
              onResolved={handleResolved}
            />
          ))}
      </div>
    </div>
  );
}

function ApprovalCard({
  item,
  onResolved,
}: {
  item: ApprovalRequest;
  onResolved: (id: string, decision: "approved" | "rejected") => void;
}) {
  const { requireAccessToken } = useAuth();
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const cfg = STATUS_CONFIG[item.status];
  const StatusIcon = cfg.icon;

  async function handleResolve(decision: "approved" | "rejected") {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const accessToken = await requireAccessToken();
      await resolveApproval(item.id, decision, accessToken, comment.trim() || undefined);
      onResolved(item.id, decision);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Failed to submit");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={`bg-white rounded-xl border p-6 shadow-sm ${cfg.card}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          {/* Workflow › Step header */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-gray-900 text-sm">{item.templateName}</span>
            <span className="text-gray-300">›</span>
            <span className="text-gray-600 text-sm">{item.stepName}</span>
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.badge}`}
            >
              <StatusIcon size={11} />
              {cfg.label}
            </span>
          </div>

          {/* Meta row */}
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

          {/* Message */}
          <div className="mt-3 flex items-start gap-2 p-3 bg-gray-50 rounded-lg">
            <MessageSquare size={13} className="text-gray-400 mt-0.5 shrink-0" />
            <p className="text-sm text-gray-700 leading-relaxed">{item.message}</p>
          </div>

          {/* Resolved comment */}
          {item.comment && item.status !== "pending" && (
            <p className="mt-2 text-xs text-gray-500 italic">
              Comment: {item.comment}
            </p>
          )}
        </div>
      </div>

      {/* Action area — only for pending */}
      {item.status === "pending" && (
        <div className="mt-4 pt-4 border-t border-gray-100 space-y-3">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Optional comment (visible to requester)…"
            rows={2}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-300 text-gray-700 placeholder-gray-400"
          />

          {submitError && (
            <p className="text-xs text-red-600 flex items-center gap-1">
              <AlertCircle size={12} />
              {submitError}
            </p>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => handleResolve("approved")}
              disabled={submitting}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-medium transition"
            >
              {submitting ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <CheckCircle size={15} />
              )}
              Approve
            </button>
            <button
              onClick={() => handleResolve("rejected")}
              disabled={submitting}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-50 hover:bg-red-100 disabled:opacity-50 text-red-600 border border-red-200 text-sm font-medium transition"
            >
              {submitting ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <XCircle size={15} />
              )}
              Reject
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
