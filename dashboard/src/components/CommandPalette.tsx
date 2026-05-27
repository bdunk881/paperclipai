/**
 * CommandPalette — ⌘K / Ctrl+K global launcher backed by `cmdk`.
 *
 * Pages contribute their own actions via `useRegisterCommandActions`;
 * this component is the single render site. It seeds a "Pages" group
 * from the sidebar navigation so the operator can jump to any route by
 * typing its name, plus a "Recent" group from the localStorage history
 * so frequent actions come back to the top.
 */
import { useEffect, useMemo, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { Command } from "cmdk";
import {
  ArrowRight,
  BookOpen,
  Brain,
  ClipboardList,
  Home,
  Plug,
  Stamp,
  Target,
  UserPlus,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import {
  useCommandPalette,
  type CommandAction,
} from "../context/CommandPaletteContext";

interface PageEntry {
  to: string;
  label: string;
  icon: LucideIcon;
  hint: string;
}

// Mirror of Layout.tsx::NAV_SECTIONS — kept in sync manually so changes
// to the sidebar surface here too. Small enough that a registry would
// be overkill.
const PAGE_ENTRIES: PageEntry[] = [
  { to: "/", label: "Home", icon: Home, hint: "Run" },
  { to: "/mission-state", label: "Missions", icon: Target, hint: "Run" },
  { to: "/mission-assignments", label: "Assignments", icon: ClipboardList, hint: "Run" },
  { to: "/approvals", label: "Approvals", icon: Stamp, hint: "Run" },
  { to: "/connections", label: "Connections", icon: Plug, hint: "Run" },
  { to: "/memory", label: "Memory", icon: Brain, hint: "Run" },
  { to: "/workspace/org-structure", label: "Team", icon: Users, hint: "Workforce" },
  { to: "/hire", label: "Hire", icon: UserPlus, hint: "Workforce" },
  { to: "/workspace/budget-dashboard", label: "Budget", icon: Wallet, hint: "Workforce" },
  { to: "/routines", label: "Routines", icon: BookOpen, hint: "Build" },
];

const KEYBOARD_HINTS = "⌘K · / · Ctrl+K";

export function CommandPalette() {
  const { open, setOpen, actions, recentIds, bumpRecent } = useCommandPalette();
  const navigate = useNavigate();

  // Global ⌘K / Ctrl+K listener. We refuse to open while typing inside a
  // text input / textarea / contenteditable so the user can still type
  // "k" naturally in form fields.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target;
      const typing =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT");
      if (typing) return;
      const isOpener =
        (e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey);
      if (isOpener) {
        e.preventDefault();
        setOpen(!open);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  const actionsById = useMemo(() => {
    const map = new Map<string, CommandAction>();
    for (const a of actions) map.set(a.id, a);
    return map;
  }, [actions]);

  const recentActions = useMemo(() => {
    return recentIds
      .map((id) => actionsById.get(id))
      .filter((a): a is CommandAction => Boolean(a));
  }, [recentIds, actionsById]);

  const grouped = useMemo(() => {
    const navigateActions: CommandAction[] = [];
    const actionActions: CommandAction[] = [];
    const filterActions: CommandAction[] = [];
    const helpActions: CommandAction[] = [];
    for (const action of actions) {
      switch (action.group) {
        case "navigate":
          navigateActions.push(action);
          break;
        case "filter":
          filterActions.push(action);
          break;
        case "help":
          helpActions.push(action);
          break;
        default:
          actionActions.push(action);
      }
    }
    return { navigateActions, actionActions, filterActions, helpActions };
  }, [actions]);

  function runAction(action: CommandAction) {
    bumpRecent(action.id);
    setOpen(false);
    // Defer the actual run so the palette closes first; avoids a flash
    // when the action triggers navigation.
    queueMicrotask(action.run);
  }

  function goToPage(entry: PageEntry) {
    bumpRecent(`page:${entry.to}`);
    setOpen(false);
    queueMicrotask(() => navigate(entry.to));
  }

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Command palette"
      style={dialogStyle}
      shouldFilter
    >
      <div style={chromeStyle}>
        <Command.Input
          placeholder="Search pages, actions, or filters…"
          style={inputStyle}
        />
        <span style={kbdHintStyle}>{KEYBOARD_HINTS}</span>
      </div>
      <Command.List style={listStyle}>
        <Command.Empty style={emptyStyle}>
          No matches. Try a page name or action verb.
        </Command.Empty>
        {recentActions.length > 0 ? (
          <Command.Group heading="Recent" style={groupHeadingStyle}>
            {recentActions.map((action) => (
              <Command.Item
                key={`recent:${action.id}`}
                value={`recent ${action.label} ${action.keywords ?? ""}`}
                onSelect={() => runAction(action)}
                style={itemStyle}
              >
                <span style={iconSlotStyle}>↶</span>
                <span style={labelStyle}>{action.label}</span>
                {action.hint ? <span style={hintStyle}>{action.hint}</span> : null}
              </Command.Item>
            ))}
          </Command.Group>
        ) : null}
        <Command.Group heading="Pages" style={groupHeadingStyle}>
          {PAGE_ENTRIES.map((entry) => {
            const Icon = entry.icon;
            return (
              <Command.Item
                key={`page:${entry.to}`}
                value={`page ${entry.label} ${entry.hint}`}
                onSelect={() => goToPage(entry)}
                style={itemStyle}
              >
                <span style={iconSlotStyle}>
                  <Icon size={14} aria-hidden />
                </span>
                <span style={labelStyle}>{entry.label}</span>
                <span style={hintStyle}>{entry.hint}</span>
                <ArrowRight size={11} style={{ color: "var(--af2-ink-4)" }} />
              </Command.Item>
            );
          })}
        </Command.Group>
        {grouped.actionActions.length > 0 ? (
          <Command.Group heading="Actions" style={groupHeadingStyle}>
            {grouped.actionActions.map((action) => (
              <ActionItem
                key={action.id}
                action={action}
                onRun={() => runAction(action)}
              />
            ))}
          </Command.Group>
        ) : null}
        {grouped.navigateActions.length > 0 ? (
          <Command.Group heading="Go to" style={groupHeadingStyle}>
            {grouped.navigateActions.map((action) => (
              <ActionItem
                key={action.id}
                action={action}
                onRun={() => runAction(action)}
              />
            ))}
          </Command.Group>
        ) : null}
        {grouped.filterActions.length > 0 ? (
          <Command.Group heading="Filters" style={groupHeadingStyle}>
            {grouped.filterActions.map((action) => (
              <ActionItem
                key={action.id}
                action={action}
                onRun={() => runAction(action)}
              />
            ))}
          </Command.Group>
        ) : null}
        {grouped.helpActions.length > 0 ? (
          <Command.Group heading="Help" style={groupHeadingStyle}>
            {grouped.helpActions.map((action) => (
              <ActionItem
                key={action.id}
                action={action}
                onRun={() => runAction(action)}
              />
            ))}
          </Command.Group>
        ) : null}
      </Command.List>
    </Command.Dialog>
  );
}

function ActionItem({
  action,
  onRun,
}: {
  action: CommandAction;
  onRun: () => void;
}) {
  return (
    <Command.Item
      value={`${action.label} ${action.keywords ?? ""} ${action.hint ?? ""}`}
      onSelect={onRun}
      style={itemStyle}
    >
      <span style={iconSlotStyle}>›</span>
      <span style={labelStyle}>{action.label}</span>
      {action.hint ? <span style={hintStyle}>{action.hint}</span> : null}
    </Command.Item>
  );
}

const dialogStyle: CSSProperties = {
  position: "fixed",
  top: "12vh",
  left: "50%",
  transform: "translateX(-50%)",
  width: "min(640px, calc(100vw - 24px))",
  background: "var(--af2-card)",
  border: "1px solid var(--af2-line)",
  borderRadius: 12,
  boxShadow: "0 24px 60px rgba(0,0,0,0.22)",
  zIndex: 200,
  display: "flex",
  flexDirection: "column",
  maxHeight: "70vh",
  overflow: "hidden",
};

const chromeStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "12px 14px",
  borderBottom: "1px solid var(--af2-line)",
};

const inputStyle: CSSProperties = {
  flex: 1,
  background: "transparent",
  border: "none",
  outline: "none",
  fontSize: 15,
  color: "var(--af2-ink)",
};

const kbdHintStyle: CSSProperties = {
  fontFamily: "var(--af2-mono, ui-monospace, SFMono-Regular, monospace)",
  fontSize: 10,
  color: "var(--af2-ink-4)",
  background: "var(--af2-paper-2)",
  border: "1px solid var(--af2-line-2)",
  borderRadius: 4,
  padding: "2px 6px",
  whiteSpace: "nowrap",
};

const listStyle: CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: 6,
};

const emptyStyle: CSSProperties = {
  padding: "24px 16px",
  textAlign: "center",
  color: "var(--af2-ink-3)",
  fontSize: 13,
};

const groupHeadingStyle: CSSProperties = {
  fontSize: 10,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "var(--af2-ink-4)",
  fontWeight: 600,
  padding: "8px 8px 4px",
};

const itemStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "8px 10px",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 13,
  color: "var(--af2-ink)",
};

const iconSlotStyle: CSSProperties = {
  width: 18,
  height: 18,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "var(--af2-ink-3)",
};

const labelStyle: CSSProperties = {
  flex: 1,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const hintStyle: CSSProperties = {
  fontSize: 11,
  color: "var(--af2-ink-3)",
};
