/**
 * ApprovalDrawer — right-side overlay that lets the operator review and
 * resolve an approval inline from the home dashboard.
 *
 * Calls `resolveApproval()` from the existing API client; on success
 * fires `onResolved` so the parent can animate the affected agent
 * waking up. Esc closes; backdrop click closes.
 */
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import {
  resolveApproval,
  type ApprovalRequest,
} from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../ToastProvider";

interface ApprovalDrawerProps {
  approval: ApprovalRequest | null;
  onClose: () => void;
  onResolved: (approval: ApprovalRequest, decision: "approved" | "rejected") => void;
}

export function ApprovalDrawer({ approval, onClose, onResolved }: ApprovalDrawerProps) {
  const { getAccessToken } = useAuth();
  const toast = useToast();
  const [comment, setComment] = useState("");
  const [pending, setPending] = useState<"approved" | "rejected" | null>(null);

  useEffect(() => {
    // Reset when a new approval is opened.
    setComment("");
    setPending(null);
  }, [approval?.id]);

  // Esc closes.
  useEffect(() => {
    if (!approval) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !pending) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [approval, pending, onClose]);

  const handleResolve = useCallback(
    async (decision: "approved" | "rejected") => {
      if (!approval || pending) return;
      setPending(decision);
      try {
        const token = await getAccessToken();
        if (!token) throw new Error("Not authenticated");
        await resolveApproval(approval.id, decision, token, comment || undefined);
        toast.success(
          decision === "approved"
            ? `Approved · ${approval.assignee || "agent"} is waking up`
            : `Rejected · ${approval.assignee || "agent"} notified`,
        );
        onResolved(approval, decision);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to resolve approval",
        );
        setPending(null);
      }
    },
    [approval, pending, comment, getAccessToken, toast, onResolved],
  );

  if (!approval) return null;

  const requestedAt = approval.requestedAt
    ? new Date(approval.requestedAt).toLocaleString()
    : "—";

  return (
    <div
      role="dialog"
      aria-label={`Approval ${approval.id}`}
      aria-modal="true"
      onClick={(e) => {
        if (e.currentTarget === e.target && !pending) onClose();
      }}
      style={backdropStyle}
    >
      <div
        style={drawerStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={headerStyle}>
          <div>
            <div className="eyebrow" style={{ marginBottom: 4 }}>
              Approval · {approval.runId.slice(0, 8).toUpperCase()}
            </div>
            <h2 style={{ margin: 0, fontSize: 18 }}>
              {approval.message || approval.stepName || "Needs your stamp"}
            </h2>
            <div
              style={{
                fontSize: 12,
                color: "var(--af2-ink-3)",
                marginTop: 4,
              }}
            >
              <b>{approval.assignee || "Agent"}</b>
              {" · "}
              {approval.templateName || approval.stepName}
              {" · "}
              <span style={{ color: "var(--af2-ink-4)" }}>{requestedAt}</span>
            </div>
          </div>
          <button
            type="button"
            className="btn ghost sm"
            onClick={onClose}
            disabled={!!pending}
            aria-label="Close approval"
          >
            ✕
          </button>
        </div>

        <div style={bodyStyle}>
          <DetailRow label="Step" value={approval.stepName || "—"} />
          <DetailRow label="Status" value={approval.status} />
          <DetailRow
            label="Timeout"
            value={`${approval.timeoutMinutes} minutes`}
          />
          {approval.agentId ? (
            <DetailRow
              label="Agent"
              value={approval.agentId.slice(0, 8) + "…"}
              mono
            />
          ) : null}

          <div style={{ marginTop: 18 }}>
            <label
              htmlFor="approval-comment"
              style={{
                fontSize: 11,
                color: "var(--af2-ink-4)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                display: "block",
                marginBottom: 6,
              }}
            >
              Comment (optional)
            </label>
            <textarea
              id="approval-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="What should the agent know? Visible in the run log."
              rows={3}
              disabled={!!pending}
              style={{
                width: "100%",
                fontFamily: "inherit",
                fontSize: 13,
                padding: "8px 10px",
                border: "1px solid var(--af2-line)",
                borderRadius: 6,
                background: "var(--af2-paper)",
                color: "var(--af2-ink)",
                resize: "vertical",
              }}
            />
          </div>
        </div>

        <div style={footerStyle}>
          <button
            type="button"
            className="btn"
            onClick={() => void handleResolve("rejected")}
            disabled={!!pending}
          >
            {pending === "rejected" ? "Rejecting…" : "Reject"}
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => void handleResolve("approved")}
            disabled={!!pending}
          >
            {pending === "approved" ? "Approving…" : "Approve"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        padding: "8px 0",
        borderBottom: "1px solid var(--af2-line)",
        fontSize: 13,
      }}
    >
      <span
        style={{
          color: "var(--af2-ink-4)",
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
        }}
      >
        {label}
      </span>
      <span
        style={
          mono
            ? {
                fontFamily:
                  "var(--af2-mono, ui-monospace, SFMono-Regular, monospace)",
                fontSize: 12,
                color: "var(--af2-ink-2)",
              }
            : { color: "var(--af2-ink)" }
        }
      >
        {value}
      </span>
    </div>
  );
}

const backdropStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "color-mix(in srgb, var(--af2-ink, #111) 28%, transparent)",
  display: "flex",
  justifyContent: "flex-end",
  zIndex: 70,
  animation: "af2-backdrop-fade 0.18s ease-out",
};

const drawerStyle: CSSProperties = {
  width: "min(420px, 92vw)",
  height: "100%",
  background: "var(--af2-card)",
  borderLeft: "1px solid var(--af2-line)",
  display: "flex",
  flexDirection: "column",
  boxShadow: "-12px 0 28px rgba(0,0,0,0.16)",
  animation: "af2-drawer-slide-in 0.22s ease-out",
};

const headerStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  padding: "18px 20px",
  borderBottom: "1px solid var(--af2-line)",
  gap: 12,
};

const bodyStyle: CSSProperties = {
  padding: "8px 20px 24px",
  overflowY: "auto",
  flex: 1,
};

const footerStyle: CSSProperties = {
  padding: "14px 20px",
  borderTop: "1px solid var(--af2-line)",
  display: "flex",
  gap: 10,
  justifyContent: "flex-end",
  background: "var(--af2-paper-2)",
};
