/**
 * useNotifications — aggregates the workspace's pending operator-facing
 * items into a single inbox-shaped list for the top-right bell.
 *
 * Sources (all client-side derivations from existing queries — no new
 * backend tables, no schema change):
 *   - Approvals waiting     → useApprovalsQuery (status: pending)
 *   - Open assignments      → useTicketsQuery filtered to current actor
 *   - Connector failures    → getConnectorHealth (auth_failed | disabled |
 *                             provider_error states)
 *   - Budget threshold hit  → listBudgetAlerts
 *
 * Read state is persisted per-workspace in localStorage (no backend
 * schema change). Each item carries a stable id derived from its
 * source so refreshes don't multiply rows.
 *
 * A passed-through "kind mute" set lets the settings page hide entire
 * categories without touching the source data.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getConnectorHealth,
  type ConnectorHealthRecord,
} from "../api/client";
import { listBudgetAlerts } from "../api/controlPlane";
import { useApprovalsQuery } from "./queries/useApprovalsQuery";
import { useTicketsQuery } from "./queries/useTicketsQuery";
import { useAuth } from "../context/AuthContext";
import { useWorkspace } from "../context/useWorkspace";
import { useResolveAccessToken } from "./queries/resolveAccessToken";
import { primaryAssignee } from "../pages/tickets/ticketingUi.helpers";

export type NotificationGroup =
  | "approvals"
  | "assignments"
  | "connections"
  | "budgets"
  | "system";

export interface InboxItem {
  /** Stable id, e.g. `approval:<id>` or `connector:<key>:auth_failed`. */
  id: string;
  group: NotificationGroup;
  title: string;
  subtitle: string;
  /** ISO timestamp for sorting + relative formatting. */
  occurredAt: string;
  /** Where clicking should take the operator. */
  href: string;
  /** Used to drive a red-tone urgent flag (high priority approvals, failures). */
  urgent?: boolean;
}

export interface UseNotificationsResult {
  items: InboxItem[];
  unreadCount: number;
  /** Subset of `items` not yet acknowledged. */
  unreadItems: InboxItem[];
  markRead: (id: string) => void;
  markAllRead: () => void;
  isRead: (id: string) => boolean;
  mutedGroups: Set<NotificationGroup>;
  setGroupMuted: (group: NotificationGroup, muted: boolean) => void;
}

const READ_PREFIX = "af2.notifications.read.v1";
const MUTED_PREFIX = "af2.notifications.muted.v1";

function loadReadSet(workspaceId: string | null): Set<string> {
  if (typeof window === "undefined" || !workspaceId) return new Set();
  try {
    const raw = window.localStorage.getItem(`${READ_PREFIX}.${workspaceId}`);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveReadSet(workspaceId: string | null, ids: Set<string>) {
  if (typeof window === "undefined" || !workspaceId) return;
  try {
    window.localStorage.setItem(
      `${READ_PREFIX}.${workspaceId}`,
      JSON.stringify(Array.from(ids).slice(-500)),
    );
  } catch {
    /* ignore */
  }
}

function loadMutedSet(workspaceId: string | null): Set<NotificationGroup> {
  if (typeof window === "undefined" || !workspaceId) return new Set();
  try {
    const raw = window.localStorage.getItem(`${MUTED_PREFIX}.${workspaceId}`);
    const parsed = raw ? (JSON.parse(raw) as NotificationGroup[]) : [];
    return new Set(parsed.filter((g) => isNotificationGroup(g)));
  } catch {
    return new Set();
  }
}

function saveMutedSet(workspaceId: string | null, groups: Set<NotificationGroup>) {
  if (typeof window === "undefined" || !workspaceId) return;
  try {
    window.localStorage.setItem(
      `${MUTED_PREFIX}.${workspaceId}`,
      JSON.stringify(Array.from(groups)),
    );
  } catch {
    /* ignore */
  }
}

function isNotificationGroup(value: unknown): value is NotificationGroup {
  return (
    value === "approvals" ||
    value === "assignments" ||
    value === "connections" ||
    value === "budgets" ||
    value === "system"
  );
}

function connectorStateLabel(state: ConnectorHealthRecord["state"]): string | null {
  if (state === "auth_failed") return "auth failed — needs reconnect";
  if (state === "provider_error") return "provider error";
  if (state === "disabled") return "disabled";
  return null;
}

export function useNotifications(): UseNotificationsResult {
  const { accessMode, user } = useAuth();
  const { activeWorkspaceId } = useWorkspace();
  const resolveAccessToken = useResolveAccessToken();

  const approvalsQuery = useApprovalsQuery();
  const ticketsQuery = useTicketsQuery();

  const connectorsQuery = useQuery({
    queryKey: ["workspace", activeWorkspaceId ?? "none", "connector-health"],
    queryFn: async () => {
      const token = await resolveAccessToken();
      return getConnectorHealth(token);
    },
    enabled: Boolean(activeWorkspaceId) && accessMode !== "preview",
    staleTime: 60_000,
  });

  const budgetAlertsQuery = useQuery({
    queryKey: ["workspace", activeWorkspaceId ?? "none", "budget-alerts"],
    queryFn: async () => {
      const token = await resolveAccessToken();
      return listBudgetAlerts(token);
    },
    enabled: Boolean(activeWorkspaceId) && accessMode !== "preview",
    staleTime: 60_000,
  });

  const [readSet, setReadSet] = useState<Set<string>>(() =>
    loadReadSet(activeWorkspaceId ?? null),
  );
  const [mutedGroups, setMutedGroups] = useState<Set<NotificationGroup>>(() =>
    loadMutedSet(activeWorkspaceId ?? null),
  );

  useEffect(() => {
    setReadSet(loadReadSet(activeWorkspaceId ?? null));
    setMutedGroups(loadMutedSet(activeWorkspaceId ?? null));
  }, [activeWorkspaceId]);

  const items = useMemo<InboxItem[]>(() => {
    const rows: InboxItem[] = [];

    // Approvals waiting.
    for (const a of approvalsQuery.data ?? []) {
      if (a.status !== "pending") continue;
      rows.push({
        id: `approval:${a.id}`,
        group: "approvals",
        title: a.message || a.stepName || "Approval needed",
        subtitle: `${a.assignee || "Agent"} · ${a.templateName}`,
        occurredAt: a.requestedAt ?? new Date().toISOString(),
        href: `/approvals?id=${encodeURIComponent(a.id)}`,
        urgent: a.timeoutMinutes > 0 && a.timeoutMinutes <= 30,
      });
    }

    // Open assignments where current user is the primary assignee.
    if (user) {
      const myId = user.id;
      for (const t of ticketsQuery.data?.tickets ?? []) {
        if (t.status !== "open" && t.status !== "in_progress") continue;
        const owner = primaryAssignee(t);
        const ownerIsMe =
          owner && owner.type === "user" && owner.id === myId;
        if (!ownerIsMe) continue;
        const updatedAt = t.updatedAt || t.createdAt || new Date().toISOString();
        rows.push({
          id: `ticket:${t.id}:${updatedAt}`,
          group: "assignments",
          title: t.title,
          subtitle: `${t.priority.toUpperCase()} · ${t.status.replace("_", " ")}`,
          occurredAt: updatedAt,
          href: `/mission-assignments/${t.id}`,
          urgent: t.priority === "urgent",
        });
      }
    }

    // Connector health transitions to failure-ish states.
    for (const c of connectorsQuery.data?.connectors ?? []) {
      const label = connectorStateLabel(c.state);
      if (!label) continue;
      rows.push({
        id: `connector:${c.connectorKey}:${c.state}`,
        group: "connections",
        title: `${c.connectorName} ${label}`,
        subtitle: c.lastErrorAt
          ? `Last failure ${new Date(c.lastErrorAt).toLocaleString()}`
          : "Reconnect to resume agent access",
        occurredAt: c.lastErrorAt ?? new Date().toISOString(),
        href: "/connections",
        urgent: c.state === "auth_failed",
      });
    }

    // Budget alerts.
    for (const alert of budgetAlertsQuery.data ?? []) {
      const pct = Math.round((alert.threshold ?? 0) * 100);
      rows.push({
        id: `budget:${alert.id}`,
        group: "budgets",
        title: `Budget at ${pct}%`,
        subtitle: `${alert.scope} · $${alert.spentUsd.toFixed(0)} of $${alert.budgetUsd.toFixed(0)}`,
        occurredAt: alert.recordedAt ?? new Date().toISOString(),
        href: "/budgets",
        urgent: pct >= 90,
      });
    }

    // Newest first.
    rows.sort(
      (a, b) =>
        new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
    );
    return rows.filter((row) => !mutedGroups.has(row.group));
  }, [
    approvalsQuery.data,
    ticketsQuery.data,
    connectorsQuery.data,
    budgetAlertsQuery.data,
    user,
    mutedGroups,
  ]);

  const unreadItems = useMemo(
    () => items.filter((i) => !readSet.has(i.id)),
    [items, readSet],
  );

  const markRead = useCallback(
    (id: string) => {
      setReadSet((prev) => {
        if (prev.has(id)) return prev;
        const next = new Set(prev);
        next.add(id);
        saveReadSet(activeWorkspaceId ?? null, next);
        return next;
      });
    },
    [activeWorkspaceId],
  );

  const markAllRead = useCallback(() => {
    setReadSet((prev) => {
      const next = new Set(prev);
      for (const item of items) next.add(item.id);
      saveReadSet(activeWorkspaceId ?? null, next);
      return next;
    });
  }, [items, activeWorkspaceId]);

  const setGroupMuted = useCallback(
    (group: NotificationGroup, muted: boolean) => {
      setMutedGroups((prev) => {
        const next = new Set(prev);
        if (muted) next.add(group);
        else next.delete(group);
        saveMutedSet(activeWorkspaceId ?? null, next);
        return next;
      });
    },
    [activeWorkspaceId],
  );

  const isRead = useCallback((id: string) => readSet.has(id), [readSet]);

  return {
    items,
    unreadCount: unreadItems.length,
    unreadItems,
    markRead,
    markAllRead,
    isRead,
    mutedGroups,
    setGroupMuted,
  };
}
