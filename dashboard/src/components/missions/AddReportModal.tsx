import { Link } from "react-router-dom";
import { Af2Modal } from "../af2/Af2Modal";
import { LibraryRolePicker } from "./LibraryRolePicker";
import { addMissionReport } from "../../api/missionsApi";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../ToastProvider";

export interface AddReportModalProps {
  open: boolean;
  onClose: () => void;
  missionId: string;
  managerAgentId: string;
  managerName: string;
  managerRoleKey: string | null;
  existingRoleKeys: Set<string>;
  /** Latest hiring plan id for fallback link when team is not confirmed yet. */
  hiringPlanId: string | null;
  planConfirmed: boolean;
  onAdded: () => void;
}

export function AddReportModal({
  open,
  onClose,
  missionId,
  managerAgentId,
  managerName,
  managerRoleKey,
  existingRoleKeys,
  hiringPlanId,
  planConfirmed,
  onAdded,
}: AddReportModalProps) {
  const { requireAccessToken } = useAuth();
  const toast = useToast();

  return (
    <Af2Modal
      open={open}
      onClose={onClose}
      eyebrow="Workforce · Add report"
      title={`Reports to ${managerName}`}
      maxWidth={720}
      footer={
        <button type="button" className="af2-btn af2-btn-sm" onClick={onClose}>
          Close
        </button>
      }
    >
      {!planConfirmed ? (
        <div
          className="af2-card"
          style={{ padding: 14, marginBottom: 14, background: "var(--af2-paper-2)" }}
        >
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
            Confirm your hiring plan before adding reports to the live team.
          </p>
          {hiringPlanId ? (
            <Link
              to={`/hire/plan/${missionId}/${hiringPlanId}`}
              className="af2-btn af2-btn-sm af2-btn-clay"
              style={{ marginTop: 10, display: "inline-flex", textDecoration: "none" }}
            >
              Review hiring plan →
            </Link>
          ) : null}
        </div>
      ) : (
        <LibraryRolePicker
          embedded
          singleSelect
          eyebrow="Choose a role for this report"
          managerRoleKey={managerRoleKey}
          disabledRoleKeys={existingRoleKeys}
          confirmLabel="Add report"
          onConfirm={async (roleKeys) => {
            const roleKey = roleKeys[0];
            if (!roleKey) return;
            const token = await requireAccessToken();
            await addMissionReport(missionId, { managerAgentId, roleKey }, token);
            toast.success("Report added to your team.");
            onAdded();
            onClose();
          }}
        />
      )}
    </Af2Modal>
  );
}
