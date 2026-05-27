import { useState } from "react";
import { completeMission } from "../../api/missionsApi";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../ToastProvider";
import { ConfirmDestructiveModal } from "./ConfirmDestructiveModal";

/**
 * HEL-210 — "Complete mission" modal. Sage-toned confirm with optional
 * success-note textarea. Reuses ConfirmDestructiveModal chrome.
 */
export interface CompleteMissionModalProps {
  open: boolean;
  onClose: () => void;
  missionId: string;
  missionStatement: string;
  onCompleted?: () => void;
}

export function CompleteMissionModal({
  open,
  onClose,
  missionId,
  missionStatement,
  onCompleted,
}: CompleteMissionModalProps) {
  const { requireAccessToken } = useAuth();
  const toast = useToast();
  const [note, setNote] = useState("");
  const [working, setWorking] = useState(false);

  const handleClose = () => {
    if (working) return;
    setNote("");
    onClose();
  };

  const truncatedStatement =
    missionStatement.length > 140
      ? `${missionStatement.slice(0, 140)}…`
      : missionStatement;

  return (
    <ConfirmDestructiveModal
      open={open}
      onClose={handleClose}
      eyebrow="Complete mission"
      title="Mark this mission as complete?"
      tone="sage"
      confirmLabel="Complete mission"
      confirming={working}
      message={
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: "var(--af2-ink)" }}>
            “{truncatedStatement}”
          </p>
          <p className="af2-muted" style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5 }}>
            The team stays in place — completing only flags the brief
            as done. Add an optional success note so the team's paper
            trail records what landed.
          </p>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, color: "var(--af2-ink-3)" }}>
            <span>Success note (optional)</span>
            <textarea
              className="af2-input"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={working}
              rows={3}
              maxLength={2000}
              placeholder="What landed? Hit which metric?"
              style={{ resize: "vertical", minHeight: 70 }}
            />
          </label>
        </div>
      }
      onConfirm={async () => {
        setWorking(true);
        try {
          const token = await requireAccessToken();
          await completeMission(missionId, { note }, token);
          toast.success("Mission marked complete.");
          setNote("");
          onCompleted?.();
          onClose();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Failed to complete mission");
        } finally {
          setWorking(false);
        }
      }}
    />
  );
}
