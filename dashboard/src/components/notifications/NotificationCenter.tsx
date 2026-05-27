/**
 * NotificationCenter — top-right bell + dropdown inbox.
 *
 * Reads from useNotifications which aggregates approvals, assignments,
 * connector failures, and budget alerts into one stream. Unread state
 * lives in localStorage scoped to the workspace.
 *
 * Native desktop notifications (browser push for events while the tab
 * is alive) are Pro-gated via PaidFeatureGate. Full cross-device Web
 * Push (service worker + VAPID) is backlog (see Linear).
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Link } from "react-router-dom";
import { Bell, BellOff, CheckCheck, Settings } from "lucide-react";
import {
  useNotifications,
  type InboxItem,
  type NotificationGroup,
} from "../../hooks/useNotifications";

const GROUP_ORDER: NotificationGroup[] = [
  "approvals",
  "assignments",
  "connections",
  "budgets",
  "system",
];

const GROUP_LABEL: Record<NotificationGroup, string> = {
  approvals: "Approvals",
  assignments: "Assignments",
  connections: "Connections",
  budgets: "Budgets",
  system: "System",
};

function relative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "—";
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

export function NotificationCenter() {
  const {
    items,
    unreadCount,
    markRead,
    markAllRead,
    isRead,
    mutedGroups,
    setGroupMuted,
  } = useNotifications();
  const [open, setOpen] = useState(false);
  const bellRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click / ESC.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        bellRef.current &&
        !bellRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Native browser notification for new urgent items (in-tab only —
  // service-worker Web Push is backlog).
  useUrgentNativeNotifications(items, isRead);

  const grouped = useMemo(() => {
    const map = new Map<NotificationGroup, InboxItem[]>();
    for (const group of GROUP_ORDER) map.set(group, []);
    for (const item of items) {
      const bucket = map.get(item.group);
      if (bucket) bucket.push(item);
    }
    return map;
  }, [items]);

  const badge =
    unreadCount === 0 ? null : unreadCount > 99 ? "99+" : String(unreadCount);

  return (
    <div style={{ position: "relative", display: "inline-flex" }}>
      <button
        ref={bellRef}
        type="button"
        aria-label={
          unreadCount === 0
            ? "Notifications"
            : `Notifications — ${unreadCount} unread`
        }
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          position: "relative",
          width: 32,
          height: 32,
          borderRadius: 8,
          border: "1px solid transparent",
          background: open ? "var(--af2-paper-2)" : "transparent",
          color: "var(--af2-ink-2)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Bell size={16} aria-hidden />
        {badge ? (
          <span
            aria-hidden
            style={{
              position: "absolute",
              top: 2,
              right: 2,
              minWidth: 16,
              height: 16,
              padding: "0 4px",
              borderRadius: 8,
              background: "var(--af2-clay)",
              color: "white",
              fontSize: 9,
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              animation: "af2-pulse 1.4s ease-out 1",
            }}
          >
            {badge}
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Notifications"
          style={panelStyle}
        >
          <div style={panelHeaderStyle}>
            <span style={{ fontWeight: 600, color: "var(--af2-ink)" }}>
              Notifications
            </span>
            <button
              type="button"
              className="btn ghost sm"
              onClick={markAllRead}
              disabled={unreadCount === 0}
              title="Mark all read"
              style={{
                display: "inline-flex",
                gap: 4,
                alignItems: "center",
                fontSize: 11,
              }}
            >
              <CheckCheck size={12} aria-hidden /> Mark all read
            </button>
          </div>
          {items.length === 0 ? (
            <div
              style={{
                padding: "32px 20px",
                textAlign: "center",
                color: "var(--af2-ink-3)",
                fontSize: 13,
              }}
            >
              You're all caught up.
            </div>
          ) : (
            <div style={{ maxHeight: 420, overflowY: "auto" }}>
              {GROUP_ORDER.map((group) => {
                const rows = grouped.get(group) ?? [];
                if (rows.length === 0) return null;
                const muted = mutedGroups.has(group);
                return (
                  <div key={group}>
                    <div style={groupHeaderStyle}>
                      <span>{GROUP_LABEL[group]}</span>
                      <span style={{ color: "var(--af2-ink-4)", fontSize: 10 }}>
                        {rows.length}
                      </span>
                      <button
                        type="button"
                        className="btn ghost sm"
                        onClick={() => setGroupMuted(group, !muted)}
                        title={muted ? "Unmute group" : "Mute group"}
                        style={{
                          marginLeft: "auto",
                          padding: "0 6px",
                          fontSize: 10,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        <BellOff
                          size={10}
                          aria-hidden
                          style={{ opacity: muted ? 1 : 0.4 }}
                        />
                        {muted ? "muted" : "mute"}
                      </button>
                    </div>
                    {rows.map((item) => {
                      const read = isRead(item.id);
                      return (
                        <Link
                          key={item.id}
                          to={item.href}
                          onClick={() => {
                            markRead(item.id);
                            setOpen(false);
                          }}
                          style={{
                            ...rowStyle,
                            background: read ? "transparent" : "var(--af2-paper-2)",
                            opacity: read ? 0.72 : 1,
                          }}
                        >
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={titleStyle}>
                              {item.urgent ? (
                                <span
                                  aria-hidden
                                  style={{
                                    display: "inline-block",
                                    width: 6,
                                    height: 6,
                                    borderRadius: 3,
                                    background: "var(--af2-clay)",
                                    marginRight: 6,
                                    verticalAlign: "middle",
                                  }}
                                />
                              ) : null}
                              {item.title}
                            </div>
                            <div style={subtitleStyle}>{item.subtitle}</div>
                          </div>
                          <div style={timeStyle}>
                            {relative(item.occurredAt)}
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
          <div style={panelFooterStyle}>
            <Link
              to="/settings/notifications"
              onClick={() => setOpen(false)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                color: "var(--af2-ink-2)",
                fontSize: 11,
                textDecoration: "none",
              }}
            >
              <Settings size={11} aria-hidden /> Notification settings →
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Fire a native `Notification` for urgent unread items so the operator
 * gets a desktop popup while the tab is alive. Cross-device push (after
 * tab is closed) requires a service worker + VAPID and is tracked
 * separately in Linear.
 *
 * Permission gating: only fire if `Notification.permission === "granted"`.
 * The opt-in lives in `pages/NotificationsSettings.tsx` behind a Pro
 * gate.
 */
function useUrgentNativeNotifications(
  items: InboxItem[],
  isRead: (id: string) => boolean,
): void {
  const seenRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    for (const item of items) {
      if (!item.urgent) continue;
      if (isRead(item.id)) {
        seenRef.current.add(item.id);
        continue;
      }
      if (seenRef.current.has(item.id)) continue;
      try {
        new Notification(item.title, {
          body: item.subtitle,
          tag: item.id,
        });
      } catch {
        /* some browsers throw if construction is rate-limited */
      }
      seenRef.current.add(item.id);
    }
  }, [items, isRead]);
}

const panelStyle: CSSProperties = {
  position: "absolute",
  top: 38,
  right: 0,
  width: 380,
  maxWidth: "calc(100vw - 24px)",
  background: "var(--af2-card)",
  border: "1px solid var(--af2-line)",
  borderRadius: 10,
  boxShadow: "0 16px 36px rgba(0,0,0,0.16)",
  zIndex: 100,
  display: "flex",
  flexDirection: "column",
};

const panelHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "10px 12px",
  borderBottom: "1px solid var(--af2-line)",
};

const panelFooterStyle: CSSProperties = {
  padding: "8px 12px",
  borderTop: "1px solid var(--af2-line)",
  display: "flex",
  justifyContent: "flex-end",
  background: "var(--af2-paper-2)",
};

const groupHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "8px 12px 4px",
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: "0.1em",
  color: "var(--af2-ink-4)",
  fontWeight: 600,
};

const rowStyle: CSSProperties = {
  display: "flex",
  gap: 8,
  padding: "10px 12px",
  borderBottom: "1px solid var(--af2-line)",
  textDecoration: "none",
  color: "var(--af2-ink)",
};

const titleStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
  color: "var(--af2-ink)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const subtitleStyle: CSSProperties = {
  marginTop: 2,
  fontSize: 11,
  color: "var(--af2-ink-3)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const timeStyle: CSSProperties = {
  fontSize: 10,
  color: "var(--af2-ink-4)",
  fontFamily: "var(--af2-mono, ui-monospace, monospace)",
  flexShrink: 0,
  marginTop: 2,
};
