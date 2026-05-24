/**
 * Members page (HEL-213 / PR I).
 *
 * Lists workspace_members rows (avatar · name · email · role pill ·
 * joined date · actions) with a "+ Invite teammate" CTA that opens the
 * InviteMemberModal. Modal submit posts to
 * POST /api/workspace/members/invite (new — see memberInviteRoutes.ts).
 *
 * Scaffold-level — the read endpoint isn't introduced in this PR yet,
 * so the table falls back to a "No members loaded" empty state when
 * the call 404s. Once HEL-213 PR ii lands we'll swap the placeholder
 * fetch for the canonical workspace-members read route.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { UserPlus } from "lucide-react";
import { trackedFetch } from "../api/trackedFetch";
import { getApiBasePath } from "../api/baseUrl";
import { useAuth } from "../context/AuthContext";
import { useWorkspace } from "../context/useWorkspace";
import { ErrorState, LoadingState } from "../components/UiStates";
import { InviteMemberModal } from "../components/InviteMemberModal";

export type WorkspaceMemberRole =
  | "owner"
  | "admin"
  | "operator"
  | "viewer"
  // Pre-canonical roles still surface from the DB. Map them onto the
  // canonical role pills but never present them in the invite picker.
  | "developer"
  | "approver"
  | "billing"
  | "member";

export interface WorkspaceMemberRow {
  id: string;
  userId: string;
  email: string;
  name: string | null;
  role: WorkspaceMemberRole;
  joinedAt: string;
  avatarUrl?: string | null;
}

const ROLE_LABEL: Record<WorkspaceMemberRole, string> = {
  owner: "Owner",
  admin: "Admin",
  operator: "Operator",
  viewer: "Viewer",
  developer: "Developer",
  approver: "Approver",
  billing: "Billing",
  member: "Member",
};

export default function Members() {
  const { requireAccessToken } = useAuth();
  const { activeWorkspace } = useWorkspace();

  const [members, setMembers] = useState<WorkspaceMemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);

  useEffect(() => {
    document.title = "Members | AutoFlow";
  }, []);

  const loadMembers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await requireAccessToken();
      // TODO(HEL-213): swap to the canonical /api/workspace/members read
      // route once it exists. Today the endpoint returns 404 in most
      // environments — surface the empty state cleanly in that case.
      const res = await trackedFetch(`${getApiBasePath()}/workspace/members`, {
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => null);
      if (!res || res.status === 404) {
        setMembers([]);
      } else if (!res.ok) {
        throw new Error(`Failed to load members (${res.status})`);
      } else {
        const data = (await res.json()) as { members?: WorkspaceMemberRow[] };
        setMembers(data.members ?? []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load members");
    } finally {
      setLoading(false);
    }
  }, [requireAccessToken]);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  const sortedMembers = useMemo(() => {
    const order: Record<WorkspaceMemberRole, number> = {
      owner: 0,
      admin: 1,
      operator: 2,
      developer: 3,
      approver: 4,
      billing: 5,
      viewer: 6,
      member: 7,
    };
    return [...members].sort((a, b) => order[a.role] - order[b.role]);
  }, [members]);

  return (
    <div className="af2-page" style={{ maxWidth: 1040 }}>
      <div className="af2-page-head">
        <div>
          <div className="af2-eyebrow">Account · Workspace</div>
          <h1 className="af2-h1" style={{ marginTop: 6 }}>
            Members
          </h1>
          <div className="af2-page-head-meta">
            {activeWorkspace?.name ?? "Workspace"} ·{" "}
            {loading ? "loading…" : `${members.length} member(s)`}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setInviteOpen(true)}
          className="af2-btn af2-btn-clay"
          style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          <UserPlus size={14} />+ Invite teammate
        </button>
      </div>

      {loading ? (
        <LoadingState label="Loading members…" />
      ) : error ? (
        <ErrorState
          title="Members unavailable"
          message={error}
          onRetry={() => void loadMembers()}
        />
      ) : sortedMembers.length === 0 ? (
        <div className="af2-card" style={{ padding: 32, textAlign: "center" }}>
          <div className="af2-muted" style={{ fontSize: 13 }}>
            No members visible yet. Use the “Invite teammate” button above to
            get someone onto this workspace.
          </div>
        </div>
      ) : (
        <div className="af2-card" style={{ padding: 0, overflow: "hidden" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 13.5,
            }}
          >
            <thead>
              <tr
                style={{
                  textAlign: "left",
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  color: "var(--af2-ink-4)",
                  background: "var(--af2-paper-2)",
                }}
              >
                <th style={{ padding: "10px 14px" }}>Member</th>
                <th style={{ padding: "10px 14px" }}>Email</th>
                <th style={{ padding: "10px 14px" }}>Role</th>
                <th style={{ padding: "10px 14px" }}>Joined</th>
                <th style={{ padding: "10px 14px", textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedMembers.map((member) => {
                const initials = initialsForMember(member);
                return (
                  <tr
                    key={member.id}
                    style={{ borderTop: "1px solid var(--af2-line)" }}
                  >
                    <td style={{ padding: "12px 14px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span
                          aria-hidden="true"
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: 28,
                            height: 28,
                            borderRadius: "50%",
                            fontSize: 11,
                            fontWeight: 700,
                            color: "white",
                            background:
                              "linear-gradient(135deg, var(--af2-clay), var(--af2-mustard))",
                            textTransform: "uppercase",
                          }}
                        >
                          {initials}
                        </span>
                        <span style={{ fontWeight: 500 }}>
                          {member.name ?? "—"}
                        </span>
                      </div>
                    </td>
                    <td
                      style={{
                        padding: "12px 14px",
                        color: "var(--af2-ink-3)",
                      }}
                    >
                      {member.email}
                    </td>
                    <td style={{ padding: "12px 14px" }}>
                      <span
                        className="af2-pill"
                        style={{ fontSize: 11 }}
                      >
                        {ROLE_LABEL[member.role] ?? member.role}
                      </span>
                    </td>
                    <td
                      style={{
                        padding: "12px 14px",
                        color: "var(--af2-ink-3)",
                        fontSize: 12.5,
                      }}
                    >
                      {formatDate(member.joinedAt)}
                    </td>
                    <td style={{ padding: "12px 14px", textAlign: "right" }}>
                      <button
                        type="button"
                        className="af2-btn af2-btn-sm af2-btn-ghost"
                        disabled
                        title="Member management lands in HEL-213 PR ii"
                      >
                        Manage
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <InviteMemberModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onInvited={() => {
          setInviteOpen(false);
          void loadMembers();
        }}
      />
    </div>
  );
}

function initialsForMember(member: WorkspaceMemberRow): string {
  const source = member.name ?? member.email ?? "";
  const parts = source.split(/\s+|@/).filter(Boolean);
  if (parts.length === 0) return "U";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return (first + last).slice(0, 2);
}

function formatDate(iso: string): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return "—";
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
