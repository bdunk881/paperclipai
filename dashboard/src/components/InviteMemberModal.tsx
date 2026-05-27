/**
 * InviteMemberModal (HEL-213 / PR I).
 *
 * Email + role picker + a $9/seat warning banner. Submit posts to
 * POST /api/workspace/members/invite which creates a workspace_member_invites
 * row and (eventually) emails the invitee. The Stripe seat-quantity bump
 * fires on accept, not invite — the banner here is the user-visible
 * heads-up that accepting the invite will trigger a per-seat charge.
 */
import { useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { trackedFetch } from "../api/trackedFetch";
import { getApiBasePath } from "../api/baseUrl";
import { useAuth } from "../context/AuthContext";
import { useToast } from "./ToastProvider";
import { Af2Modal } from "./af2";

export type InviteRole = "admin" | "operator" | "viewer";

export interface InviteMemberModalProps {
  open: boolean;
  onClose: () => void;
  onInvited?: (payload: { email: string; role: InviteRole }) => void;
}

const ROLE_OPTIONS: Array<{ value: InviteRole; label: string; description: string }> = [
  {
    value: "admin",
    label: "Admin",
    description: "Full operational access except billing + workspace delete.",
  },
  {
    value: "operator",
    label: "Operator",
    description: "Runs, approvals, and cost views.",
  },
  {
    value: "viewer",
    label: "Viewer",
    description: "Read-only across the workspace.",
  },
];

export function InviteMemberModal({ open, onClose, onInvited }: InviteMemberModalProps) {
  const { requireAccessToken } = useAuth();
  const toast = useToast();

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InviteRole>("operator");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form whenever the modal re-opens so a successful invite doesn't
  // leak its email into the next invite session.
  useEffect(() => {
    if (open) {
      setEmail("");
      setRole("operator");
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  async function handleSubmit() {
    const trimmed = email.trim();
    if (!trimmed || !/.+@.+\..+/.test(trimmed)) {
      setError("Enter a valid email address.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const token = await requireAccessToken();
      const res = await trackedFetch(`${getApiBasePath()}/workspace/members/invite`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ email: trimmed, role }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Invite failed (${res.status})`);
      }
      toast.success(`Invite sent to ${trimmed}.`);
      onInvited?.({ email: trimmed, role });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to send invite";
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Af2Modal
      open={open}
      onClose={onClose}
      eyebrow="Workspace · Members"
      title="Invite teammate"
      footer={
        <>
          <button
            type="button"
            className="af2-btn"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="af2-btn af2-btn-clay"
            onClick={() => void handleSubmit()}
            disabled={submitting || !email.trim()}
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            {submitting ? <Loader2 size={13} className="animate-spin" /> : null}
            Send invite
          </button>
        </>
      }
    >
      <div style={{ display: "grid", gap: 14 }}>
        <div>
          <label
            htmlFor="invite-email"
            style={{ fontSize: 12.5, color: "var(--af2-ink-3)", display: "block" }}
          >
            Email
          </label>
          <input
            id="invite-email"
            type="email"
            className="af2-input"
            placeholder="teammate@company.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={submitting}
            autoFocus
            style={{ marginTop: 6, width: "100%" }}
          />
        </div>

        <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
          <legend
            className="af2-eyebrow"
            style={{ padding: 0, marginBottom: 6 }}
          >
            Role
          </legend>
          <div style={{ display: "grid", gap: 8 }}>
            {ROLE_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  padding: 10,
                  border: "1px solid var(--af2-line)",
                  borderRadius: 8,
                  cursor: "pointer",
                  background:
                    role === opt.value ? "var(--af2-paper-2)" : "transparent",
                }}
              >
                <input
                  type="radio"
                  name="invite-role"
                  value={opt.value}
                  checked={role === opt.value}
                  onChange={() => setRole(opt.value)}
                  disabled={submitting}
                  style={{ marginTop: 3 }}
                />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{opt.label}</div>
                  <div
                    className="af2-muted"
                    style={{ fontSize: 11.5, marginTop: 2 }}
                  >
                    {opt.description}
                  </div>
                </div>
              </label>
            ))}
          </div>
          <p
            className="af2-muted-2"
            style={{ fontSize: 11, marginTop: 6 }}
          >
            Owner is a single seat per workspace — transfer ownership instead
            of inviting a second owner.
          </p>
        </fieldset>

        <div
          role="note"
          style={{
            display: "flex",
            gap: 10,
            alignItems: "flex-start",
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid rgba(192, 138, 76, 0.32)",
            background: "rgba(192, 138, 76, 0.10)",
            fontSize: 12.5,
            color: "var(--af2-ink)",
          }}
        >
          <AlertTriangle
            size={14}
            style={{ marginTop: 2, color: "var(--af2-mustard)" }}
            aria-hidden="true"
          />
          <div>
            <strong>+$9/mo seat charge on accept.</strong> Your Stripe
            subscription quantity goes up by 1 when this invite is accepted.
          </div>
        </div>

        {error ? (
          <div
            role="alert"
            style={{
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid rgba(192,84,76,0.30)",
              background: "rgba(192,84,76,0.10)",
              color: "var(--af2-clay)",
              fontSize: 12.5,
            }}
          >
            {error}
          </div>
        ) : null}
      </div>
    </Af2Modal>
  );
}
