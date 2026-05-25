/**
 * Members page — v2 prototype port (consolidation.html lines 1365-1411).
 *
 * Eyebrow "Account · Members", h1 "Members". Page-head-right hosts a
 * primary "+ Invite teammate" CTA that opens the existing
 * InviteMemberModal. Card-list of member rows (avatar + name/role/
 * joined date + Edit/Remove actions) followed by a "Role permissions"
 * card explaining owner/admin/operator/viewer.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { trackedFetch } from "../api/trackedFetch";
import { getApiBasePath } from "../api/baseUrl";
import { useAuth } from "../context/AuthContext";
import { useWorkspace } from "../context/useWorkspace";
import { InviteMemberModal } from "../components/InviteMemberModal";

export type WorkspaceMemberRole =
  | "owner"
  | "admin"
  | "operator"
  | "viewer"
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
  status?: "active" | "pending";
}

const ROLE_LABEL: Record<WorkspaceMemberRole, string> = {
  owner: "owner",
  admin: "admin",
  operator: "operator",
  viewer: "viewer",
  developer: "developer",
  approver: "approver",
  billing: "billing",
  member: "member",
};

interface FallbackMember {
  id: string;
  name: string;
  email: string;
  role: WorkspaceMemberRole;
  joined: string;
  status: "active" | "pending";
  avatar: string;
}

const FALLBACK_MEMBERS: FallbackMember[] = [
  {
    id: "f-brad",
    name: "Brad Dunkley",
    email: "bdunk881@gmail.com",
    role: "owner",
    joined: "since 2026-03-01",
    status: "active",
    avatar: "B",
  },
  {
    id: "f-jordan",
    name: "Jordan Lee",
    email: "jordan@acmerobotics.com",
    role: "admin",
    joined: "joined 2026-04-12",
    status: "active",
    avatar: "J",
  },
  {
    id: "f-priya",
    name: "Priya Shah",
    email: "priya@acmerobotics.com",
    role: "operator",
    joined: "invited 2h ago",
    status: "pending",
    avatar: "P",
  },
];

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
      const res = await trackedFetch(
        `${getApiBasePath()}/workspace/members`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      ).catch(() => null);
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

  const usingFallback = !loading && !error && sortedMembers.length === 0;
  const displayCount = usingFallback ? FALLBACK_MEMBERS.length : members.length;

  return (
    <div className="af2-v2">
      <div className="page-head">
        <div className="page-head-left">
          <div className="eyebrow">Account · Members</div>
          <h1 className="h1">Members</h1>
          <div className="meta">
            {activeWorkspace?.name ? `${activeWorkspace.name} · ` : ""}
            {displayCount} members · 12 seats on plan · invite adds 1 seat
            ($9/mo) to subscription
          </div>
        </div>
        <div className="page-head-right">
          <button
            type="button"
            className="btn primary"
            onClick={() => setInviteOpen(true)}
          >
            + Invite teammate
          </button>
        </div>
      </div>

      {error ? (
        <div
          className="card"
          style={{
            borderColor: "rgba(192,84,76,0.30)",
            background: "rgba(192,84,76,0.08)",
            color: "var(--af2-clay)",
            fontSize: 13,
          }}
        >
          {error}
          <button
            type="button"
            className="btn sm"
            style={{ marginLeft: 12 }}
            onClick={() => void loadMembers()}
          >
            Retry
          </button>
        </div>
      ) : (
        <div className="card card-list" style={{ padding: 0 }}>
          {loading ? (
            <div
              style={{
                padding: 24,
                textAlign: "center",
                color: "var(--af2-ink-3)",
                fontSize: 13,
              }}
            >
              Loading members…
            </div>
          ) : usingFallback ? (
            FALLBACK_MEMBERS.map((m, idx) => (
              <MemberRowFallback key={m.id} member={m} idx={idx} />
            ))
          ) : (
            sortedMembers.map((m) => <MemberRow key={m.id} member={m} />)
          )}
        </div>
      )}

      <div className="card">
        <h3>Role permissions</h3>
        <p className="desc">
          Permissions schema · stored as <code>workspace_members.role</code>{" "}
          (column already exists since migration 026).
        </p>
        <div
          style={{ marginTop: 10, fontSize: 13, color: "var(--af2-ink-2)" }}
        >
          <div
            style={{
              padding: "6px 0",
              borderBottom: "1px dashed var(--af2-line)",
            }}
          >
            <b>owner</b> — all permissions including billing &amp; member
            ownership transfer (single)
          </div>
          <div
            style={{
              padding: "6px 0",
              borderBottom: "1px dashed var(--af2-line)",
            }}
          >
            <b>admin</b> — everything except billing &amp; owner-mgmt
          </div>
          <div
            style={{
              padding: "6px 0",
              borderBottom: "1px dashed var(--af2-line)",
            }}
          >
            <b>operator</b> — everything except member-mgmt &amp; billing
          </div>
          <div style={{ padding: "6px 0" }}>
            <b>viewer</b> — read-only
          </div>
        </div>
      </div>

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

function MemberRow({ member }: { member: WorkspaceMemberRow }) {
  const initials = initialsForMember(member);
  return (
    <div
      className="row"
      style={{ gridTemplateColumns: "60px 1fr 130px 110px 110px" }}
    >
      <div
        className="avatar"
        style={{ width: 32, height: 32, fontSize: 12 }}
      >
        {initials}
      </div>
      <div>
        <b>{member.name ?? "—"}</b>
        <br />
        <span className="id">{member.email}</span>
      </div>
      <div>
        <span className="pill">{ROLE_LABEL[member.role] ?? member.role}</span>
      </div>
      <div className="id">{formatDate(member.joinedAt)}</div>
      <div className="actions">
        {member.role === "owner" ? (
          <button type="button" className="btn sm" disabled>
            —
          </button>
        ) : (
          <>
            <button type="button" className="btn sm">
              Edit
            </button>
            <button type="button" className="btn danger sm">
              Remove
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function MemberRowFallback({ member, idx }: { member: FallbackMember; idx: number }) {
  const gradient =
    idx === 0
      ? undefined
      : idx === 1
        ? "linear-gradient(135deg,var(--af2-sage),var(--af2-mustard))"
        : "linear-gradient(135deg,var(--af2-plum),var(--af2-ink-blue))";
  return (
    <div
      className="row"
      style={{ gridTemplateColumns: "60px 1fr 130px 110px 110px" }}
    >
      <div
        className="avatar"
        style={{
          width: 32,
          height: 32,
          fontSize: 12,
          ...(gradient ? { background: gradient } : {}),
        }}
      >
        {member.avatar}
      </div>
      <div>
        <b>{member.name}</b>
        {member.status === "pending" ? (
          <span className="pill mustard" style={{ marginLeft: 6 }}>
            pending
          </span>
        ) : null}
        <br />
        <span className="id">{member.email}</span>
      </div>
      <div>
        <span className="pill">{ROLE_LABEL[member.role]}</span>
      </div>
      <div className="id">{member.joined}</div>
      <div className="actions">
        {member.role === "owner" ? (
          <button type="button" className="btn sm" disabled>
            —
          </button>
        ) : member.status === "pending" ? (
          <>
            <button type="button" className="btn sm">
              Resend
            </button>
            <button type="button" className="btn danger sm">
              Cancel
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn sm">
              Edit
            </button>
            <button type="button" className="btn danger sm">
              Remove
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function initialsForMember(member: WorkspaceMemberRow): string {
  const source = member.name ?? member.email ?? "";
  const parts = source.split(/\s+|@/).filter(Boolean);
  if (parts.length === 0) return "U";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return (first + last).slice(0, 2).toUpperCase();
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
