import { useEffect, useRef, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useExperienceMode } from "../context/ExperienceModeContext";
import { useWorkspace } from "../context/useWorkspace";

/**
 * Af2UserMenu — popover that anchors under the topbar avatar (HEL-213 / PR I).
 *
 * Items: Account · Members · Billing · Sign out. Routes target the
 * top-level /account, /members, /billing pages added in router.tsx (the
 * old /settings/* paths now redirect to these).
 *
 * Visibility/positioning is controlled by the caller — this component
 * renders nothing when `open` is false. The caller passes an `anchorRect`
 * (typically derived from `avatarButtonRef.current?.getBoundingClientRect()`)
 * so the popover can fixed-position itself under the trigger without
 * needing a portal or third-party floating-ui dep.
 *
 * Dismissal: outside-click and Esc. Clicking an item also closes (handled
 * inline below). Focus is NOT trapped — this is a popover, not a modal.
 */

type Af2UserMenuProps = {
  open: boolean;
  onClose: () => void;
  anchorRect?: DOMRect | null;
};

type MenuItem = {
  key: "account" | "members" | "billing" | "signout";
  label: string;
  action: () => void;
  variant?: "default" | "danger";
};

export function Af2UserMenu({ open, onClose, anchorRect }: Af2UserMenuProps) {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  // Workspace + plan are surfaced in the menu header beneath the user's
  // name/email. Both contexts wrap the entire authenticated shell where
  // this menu mounts, so reading them here is safe.
  const { activeWorkspace } = useWorkspace();
  const { mode: experienceMode } = useExperienceMode();
  const workspaceName = activeWorkspace?.name ?? null;
  const planLabel = experienceMode === "pro" ? "Pro" : "Simple";
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Esc to close, regardless of focus location.
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Outside-click — guarded by `open` so we don't pay the listener cost when
  // the menu is closed. We compare against panelRef rather than the event
  // target tree so a click on the avatar (parent's trigger) still closes.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      const node = panelRef.current;
      if (!node) return;
      if (event.target instanceof Node && node.contains(event.target)) return;
      onClose();
    }
    // mousedown fires before the avatar button's click handler, so we
    // close cleanly without the toggle re-opening on the same gesture.
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [open, onClose]);

  if (!open) return null;

  const items: MenuItem[] = [
    {
      key: "account",
      label: "Account",
      action: () => {
        navigate("/account");
        onClose();
      },
    },
    {
      key: "members",
      label: "Members",
      action: () => {
        navigate("/members");
        onClose();
      },
    },
    {
      key: "billing",
      label: "Billing",
      action: () => {
        navigate("/billing");
        onClose();
      },
    },
    {
      key: "signout",
      label: "Sign out",
      variant: "danger",
      action: () => {
        logout();
        onClose();
        navigate("/login");
      },
    },
  ];

  // Position: 8px below the anchor's bottom-right corner, right-aligned.
  // Fall back to the top-right of the viewport if no anchor was provided
  // (e.g. invoked from a context where the trigger ref isn't available).
  const top = anchorRect ? Math.round(anchorRect.bottom + 8) : 56;
  const right = anchorRect
    ? Math.max(8, Math.round(window.innerWidth - anchorRect.right))
    : 16;

  return (
    <div
      ref={panelRef}
      role="menu"
      aria-label="User menu"
      className="af2-user-menu"
      style={{
        position: "fixed",
        top,
        right,
        zIndex: 60,
        minWidth: 200,
        padding: 6,
        background: "var(--af2-card)",
        border: "1px solid var(--af2-line)",
        borderRadius: 10,
        boxShadow: "0 12px 32px rgba(26, 20, 16, 0.18)",
      }}
    >
      {user ? (
        <div
          style={{
            padding: "8px 10px",
            borderBottom: "1px solid var(--af2-line)",
            marginBottom: 4,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--af2-ink)" }}>
            {user.name || user.email}
          </div>
          {user.email ? (
            <div
              style={{
                fontSize: 11.5,
                color: "var(--af2-ink-4)",
                fontFamily: "var(--af2-mono)",
              }}
            >
              {user.email}
            </div>
          ) : null}
          {workspaceName ? (
            <div style={{ fontSize: 11.5, color: "var(--af2-ink-4)", marginTop: 2 }}>
              {workspaceName} · {planLabel}
            </div>
          ) : null}
        </div>
      ) : null}
      {items.map((item) => (
        <UserMenuButton key={item.key} variant={item.variant} onClick={item.action}>
          {item.label}
        </UserMenuButton>
      ))}
    </div>
  );
}

function UserMenuButton({
  children,
  variant,
  onClick,
}: {
  children: ReactNode;
  variant?: "default" | "danger";
  onClick: () => void;
}) {
  const danger = variant === "danger";
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        padding: "8px 10px",
        background: "transparent",
        border: 0,
        borderRadius: 6,
        cursor: "pointer",
        fontSize: 13,
        color: danger ? "var(--af2-clay)" : "var(--af2-ink)",
      }}
      onMouseEnter={(event) => {
        (event.currentTarget as HTMLButtonElement).style.background = "var(--af2-paper-2)";
      }}
      onMouseLeave={(event) => {
        (event.currentTarget as HTMLButtonElement).style.background = "transparent";
      }}
    >
      {children}
    </button>
  );
}
