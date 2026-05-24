import { useState } from "react";
import { stopMission } from "../../api/missionsApi";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../ToastProvider";
import { ConfirmDestructiveModal } from "./ConfirmDestructiveModal";

/**
 * HEL-210 — "Stop mission" modal. Destructive-toned: terminates open
 * assignments + archives the mission.
 */
export interface StopMissionModalProps {
  open: boolean;
  onClose: () => void;
  missionId: string;
  missionStatement: string;
  onStopped?: () => void;
}

export function StopMissionModal({
  open,
  onClose,
  missionId,
  missionStatement,
  onStopped,
}: StopMissionModalProps) {
  const { requireAccessToken } = useAuth();
  const toast = useToast();
  const [working, setWorking] = useState(false);

  const truncatedStatement =
    missionStatement.length > 140
      ? `${missionStatement.slice(0, 140)}…`
      : missionStatement;

  return (
    <ConfirmDestructiveModal
      open={open}
      onClose={() => {
        if (!working) onClose();
      }}
      eyebrow="Stop mission"
      title="Stop this mission?"
      tone="destructive"
      confirmLabel="Stop mission"
      confirming={working}
      message={`“${truncatedStatement}”\n\nThis terminates open assignments and archives the mission. Agents will be released. You can re-hire later if needed.`}
      onConfirm={async () => {
        setWorking(true);
        try {
          const token = await requireAccessToken();
          const result = await stopMission(missionId, token);
          toast.success(
            result.terminatedAgentCount > 0
              ? `Mission stopped. ${result.terminatedAgentCount} agent${result.terminatedAgentCount === 1 ? "" : "s"} released.`
              : "Mission stopped.",
          );
          onStopped?.();
          onClose();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Failed to stop mission");
        } finally {
          setWorking(false);
        }
      }}
    />
  );
}
