import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listPlatformAdmins,
  revokePlatformAdmin,
  type PlatformAdminView,
} from "../../api/platformAdminsApi";
import { DangerActionPrompt } from "../../components/infra/DangerActionPrompt";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
}

function shortId(id: string): string {
  return `${id.slice(0, 8)}…`;
}

export function PlatformAdminsPage() {
  const qc = useQueryClient();
  const { data, error, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["platform-admins"],
    queryFn: listPlatformAdmins,
    refetchInterval: 60_000,
  });
  const [target, setTarget] = useState<PlatformAdminView | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const revoke = useMutation({
    mutationFn: ({ userId, reason }: { userId: string; reason: string }) =>
      revokePlatformAdmin({ userId, reason, confirm: "REVOKE" }),
    onSuccess: () => {
      setActionMessage("Admin revoked.");
      setActionError(null);
      void qc.invalidateQueries({ queryKey: ["platform-admins"] });
    },
    onError: (err) => {
      setActionMessage(null);
      setActionError(err instanceof Error ? err.message : String(err));
    },
  });

  const admins = data?.admins ?? [];
  const selfId = data?.self_user_id ?? null;
  const onlyAdminLeft = admins.length <= 1;

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: "1rem" }}>
        <h1 style={{ fontSize: "1.3rem", margin: 0 }}>Platform admins</h1>
        <button onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div className="card">
        <p className="muted" style={{ marginTop: 0 }}>
          This page lists every account with <code className="code">is_platform_admin = true</code>
          {" "}so a stolen-session attacker cannot use it to elevate themselves or a buddy.{" "}
          <strong>Granting is intentionally out-of-band</strong>: do it via the Supabase SQL
          editor (
          <code className="code">UPDATE user_profiles SET is_platform_admin = true WHERE user_id = '…'</code>
          ) or the <code className="code">AUTOFLOW_STAFF_USER_IDS</code> env var. Revoking
          requires a <strong>passkey step-up</strong> — TOTP is not sufficient here.
        </p>
      </div>

      {error && (
        <div className="banner danger">
          {error instanceof Error ? error.message : "Failed to load platform admins"}
        </div>
      )}
      {actionMessage && <div className="banner">{actionMessage}</div>}
      {actionError && <div className="banner danger">{actionError}</div>}

      <div className="card">
        {isLoading ? (
          <span className="muted">Loading…</span>
        ) : admins.length === 0 ? (
          <p className="muted">No platform admins found.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>Name</th>
                <th>User ID</th>
                <th>Granted</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {admins.map((a) => {
                const isSelf = a.user_id === selfId;
                const disabledReason = isSelf
                  ? "Cannot revoke your own grant"
                  : onlyAdminLeft
                    ? "Cannot revoke the last admin (would lock everyone out)"
                    : null;
                return (
                  <tr key={a.user_id}>
                    <td>{a.email ?? <span className="muted">—</span>}</td>
                    <td>{a.display_name ?? <span className="muted">—</span>}</td>
                    <td className="code">{shortId(a.user_id)}</td>
                    <td>{fmtDate(a.granted_at)}</td>
                    <td>
                      <button
                        className="danger"
                        onClick={() => setTarget(a)}
                        disabled={Boolean(disabledReason)}
                        title={disabledReason ?? "Revoke this admin grant"}
                      >
                        Revoke
                      </button>
                      {isSelf && (
                        <span
                          className="pill"
                          style={{ marginLeft: "0.4rem", verticalAlign: "middle" }}
                        >
                          you
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <DangerActionPrompt
        open={target !== null}
        title={
          target
            ? `Revoke admin: ${target.email ?? target.display_name ?? shortId(target.user_id)}`
            : "Revoke admin"
        }
        description={
          <>
            This removes <code className="code">is_platform_admin</code> from{" "}
            <strong>{target?.email ?? target?.display_name ?? "this user"}</strong>. Their next
            request to <code className="code">/api/admin-console/*</code> will fail with 403.
            Cannot be undone from this dashboard — re-granting requires SQL access.
          </>
        }
        typedConfirm="REVOKE"
        confirmLabel="Revoke admin"
        acknowledgementText="I confirm this person no longer needs platform-admin access."
        onClose={() => setTarget(null)}
        onConfirm={async ({ reason }) => {
          if (!target) return;
          await revoke.mutateAsync({ userId: target.user_id, reason });
          setTarget(null);
        }}
      />
    </>
  );
}
