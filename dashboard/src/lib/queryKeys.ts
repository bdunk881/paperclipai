/**
 * Workspace-scoped TanStack Query keys. Every cache entry is namespaced by
 * active workspace so switching tenants never bleeds data across workspaces.
 */
export const queryKeys = {
  workspace: (id: string) => ["workspace", id] as const,
  home: (id: string) => ["workspace", id, "home"] as const,
  agents: (id: string) => ["workspace", id, "agents"] as const,
  missions: (id: string) => ["workspace", id, "missions"] as const,
  approvals: (id: string) => ["workspace", id, "approvals"] as const,
  orgGraph: (id: string) => ["workspace", id, "org-graph"] as const,
  budgets: (id: string) => ["workspace", id, "budgets"] as const,
  entitlements: (id: string) => ["workspace", id, "entitlements"] as const,
  observability: (id: string, tab: string) => ["workspace", id, "observability", tab] as const,
  tickets: (id: string) => ["workspace", id, "tickets"] as const,
};
