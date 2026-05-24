/**
 * Connections — unified hub for everything an operator plugs into AutoFlow
 * (HEL-205 PR B). Mounted at `/connections` with four sub-tabs:
 *
 *   · Integrations    — existing integrations list (MCPIntegrations page)
 *   · Models          — preserved-verbatim LLMProviders page from PR #983
 *   · MCP Servers     — Pro-only; embeds the existing McpServers page
 *   · Health          — Pro-only; scaffold-level connector health table
 *
 * The Pro tabs are gated on ExperienceMode=pro (from HEL-203). HEL-203
 * hasn't landed yet, so we read the mode from a local lookup with a safe
 * fallback (localStorage flag → "smb") to keep the hub functional in
 * isolation; the import swap once HEL-203 ships is mechanical.
 *
 * The Manage panel below each tab exposes the per-scope permission tree
 * (mission · team · agent) via ScopePermissionSlider. Scaffold-level: the
 * scope rows are mocked locally and update in-place; once HEL-205's
 * /api/connector-grants route is wired into the dashboard client, the
 * `useConnectorGrants` hook here becomes the real fetch path.
 */
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import clsx from "clsx";
import LLMProviders from "./LLMProviders";
import MCPIntegrations from "./MCPIntegrations";
import McpServers from "./McpServers";
import ScopePermissionSlider, {
  type ScopePermission,
} from "../components/connections/ScopePermissionSlider";

// ---------------------------------------------------------------------------
// Experience mode (HEL-203). Local fallback until that PR lands.
// ---------------------------------------------------------------------------

type ExperienceMode = "smb" | "pro";

function useExperienceMode(): ExperienceMode {
  // HEL-203 will expose this via context; for now we read a localStorage flag
  // ("af2.experience-mode") so QA can flip into Pro without code changes.
  const [mode, setMode] = useState<ExperienceMode>("smb");
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("af2.experience-mode");
      if (stored === "pro" || stored === "smb") setMode(stored);
    } catch {
      /* localStorage unavailable — stay SMB */
    }
  }, []);
  return mode;
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

type TabId = "integrations" | "models" | "mcp" | "health";

interface TabDef {
  id: TabId;
  label: string;
  pro?: boolean;
}

const TABS: readonly TabDef[] = [
  { id: "integrations", label: "Integrations" },
  { id: "models", label: "Models" },
  { id: "mcp", label: "MCP Servers", pro: true },
  { id: "health", label: "Health", pro: true },
];

function isTabId(value: string | null | undefined): value is TabId {
  return value === "integrations" || value === "models" || value === "mcp" || value === "health";
}

// ---------------------------------------------------------------------------
// Manage panel — per-connector scope tree with permission sliders.
// Scaffold-level mock data; wired to /api/connector-grants once the
// dashboard client picks up the route added in this PR.
// ---------------------------------------------------------------------------

type ScopeKind = "mission" | "team" | "agent";

interface ScopeRow {
  id: string;
  kind: ScopeKind;
  label: string;
  permission: ScopePermission;
}

const SCOPE_GROUP_LABELS: Record<ScopeKind, string> = {
  mission: "Per mission",
  team: "Per team",
  agent: "Per agent",
};

function buildMockScopes(connectorId: string): ScopeRow[] {
  // Stable mock — varies by connector so the panel feels alive when the
  // user flips between tabs. Real data lands when the dashboard client
  // gains a connectorGrantsApi module.
  const seed = connectorId.length;
  return [
    {
      id: `${connectorId}:mission:onboarding`,
      kind: "mission",
      label: "Customer onboarding",
      permission: seed % 3 === 0 ? "ask" : "allow",
    },
    {
      id: `${connectorId}:mission:billing`,
      kind: "mission",
      label: "Billing operations",
      permission: "ask",
    },
    {
      id: `${connectorId}:team:support`,
      kind: "team",
      label: "Support team",
      permission: "allow",
    },
    {
      id: `${connectorId}:team:sales`,
      kind: "team",
      label: "Sales team",
      permission: seed % 2 === 0 ? "allow" : "ask",
    },
    {
      id: `${connectorId}:agent:triage-bot`,
      kind: "agent",
      label: "Triage bot",
      permission: "allow",
    },
    {
      id: `${connectorId}:agent:escalation-router`,
      kind: "agent",
      label: "Escalation router",
      permission: "deny",
    },
  ];
}

interface ConnectorManagePanelProps {
  connectorId: string;
  connectorLabel: string;
}

function ConnectorManagePanel({ connectorId, connectorLabel }: ConnectorManagePanelProps) {
  const [scopes, setScopes] = useState<ScopeRow[]>(() => buildMockScopes(connectorId));

  useEffect(() => {
    setScopes(buildMockScopes(connectorId));
  }, [connectorId]);

  const grouped = useMemo(() => {
    const map: Record<ScopeKind, ScopeRow[]> = { mission: [], team: [], agent: [] };
    for (const s of scopes) map[s.kind].push(s);
    return map;
  }, [scopes]);

  function updatePermission(id: string, next: ScopePermission) {
    setScopes((prev) => prev.map((s) => (s.id === id ? { ...s, permission: next } : s)));
    // TODO(HEL-205 follow-up): PUT /api/connector-grants once the
    // dashboard client module lands.
  }

  return (
    <div className="af2-card" style={{ padding: 18, marginTop: 24 }}>
      <div className="af2-eyebrow">Manage</div>
      <h3 className="af2-h3" style={{ marginTop: 6 }}>
        {connectorLabel} — access by scope
      </h3>
      <p
        style={{
          fontSize: 12.5,
          color: "var(--af2-ink-3)",
          marginTop: 6,
          marginBottom: 18,
          maxWidth: 640,
        }}
      >
        Grant or restrict this connector per mission, team, or agent. <strong>Allow</strong>{" "}
        lets agents call it freely; <strong>Ask</strong> requires a human approval per call;{" "}
        <strong>Deny</strong> blocks it outright.
      </p>

      {(["mission", "team", "agent"] as ScopeKind[]).map((kind) => {
        const rows = grouped[kind];
        if (rows.length === 0) return null;
        return (
          <div key={kind} style={{ marginBottom: 18 }}>
            <div
              className="af2-eyebrow"
              style={{ fontSize: 11, color: "var(--af2-ink-3)", marginBottom: 8 }}
            >
              {SCOPE_GROUP_LABELS[kind]}
            </div>
            <div className="af2-list">
              {rows.map((row) => (
                <div
                  key={row.id}
                  className="af2-list-row"
                  style={{ gridTemplateColumns: "1fr auto", alignItems: "center" }}
                >
                  <div style={{ fontSize: 13.5, fontWeight: 500 }}>{row.label}</div>
                  <ScopePermissionSlider
                    value={row.permission}
                    onChange={(next) => updatePermission(row.id, next)}
                  />
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Health tab — scaffold-level empty table.
// ---------------------------------------------------------------------------

function HealthTab() {
  return (
    <div className="af2-page" style={{ maxWidth: 1080, padding: 0 }}>
      <div className="af2-page-head">
        <div>
          <div className="af2-eyebrow">Health</div>
          <h1 className="af2-h1" style={{ marginTop: 6 }}>
            Connector health
          </h1>
          <div className="af2-page-head-meta">
            Live status pings for every connector this workspace is using.
          </div>
        </div>
      </div>
      <div className="af2-list" style={{ marginTop: 16 }}>
        <div
          className="af2-list-head"
          style={{ gridTemplateColumns: "240px 1fr 120px 160px 120px" }}
        >
          <div>Connector</div>
          <div>Last event</div>
          <div>Latency</div>
          <div>Last error</div>
          <div>Status</div>
        </div>
        <div
          className="af2-list-row"
          style={{
            gridTemplateColumns: "1fr",
            padding: "32px 16px",
            textAlign: "center",
            color: "var(--af2-ink-4)",
            fontSize: 13,
          }}
        >
          No connectors reporting yet.
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const DEFAULT_TAB_FOR_MODE: Record<ExperienceMode, TabId> = {
  smb: "integrations",
  pro: "integrations",
};

export default function Connections() {
  const experienceMode = useExperienceMode();
  const [searchParams, setSearchParams] = useSearchParams();

  const visibleTabs = useMemo(
    () => TABS.filter((t) => !t.pro || experienceMode === "pro"),
    [experienceMode],
  );

  const requestedTab = searchParams.get("tab");
  const initialTab: TabId =
    isTabId(requestedTab) && visibleTabs.some((t) => t.id === requestedTab)
      ? requestedTab
      : DEFAULT_TAB_FOR_MODE[experienceMode];

  const [activeTab, setActiveTab] = useState<TabId>(initialTab);

  useEffect(() => {
    if (!isTabId(requestedTab)) return;
    if (!visibleTabs.some((t) => t.id === requestedTab)) return;
    setActiveTab(requestedTab);
  }, [requestedTab, visibleTabs]);

  function handleTabClick(id: TabId) {
    setActiveTab(id);
    const next = new URLSearchParams(searchParams);
    next.set("tab", id);
    setSearchParams(next, { replace: true });
  }

  return (
    <div className="af2-page" style={{ maxWidth: 1080 }}>
      <div className="af2-page-head">
        <div>
          <div className="af2-eyebrow">Connect</div>
          <h1 className="af2-h1" style={{ marginTop: 6 }}>
            Connections
          </h1>
          <div className="af2-page-head-meta">
            One hub for integrations, model providers, MCP servers, and the
            health of everything you&apos;ve plugged in.
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div
        role="tablist"
        aria-label="Connections sub-sections"
        style={{
          display: "flex",
          gap: 4,
          borderBottom: "1px solid var(--af2-line)",
          marginBottom: 20,
        }}
      >
        {visibleTabs.map((tab) => {
          const active = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => handleTabClick(tab.id)}
              className={clsx("af2-btn-tab", { "af2-btn-tab-active": active })}
              style={{
                background: "transparent",
                border: "none",
                borderBottom: active
                  ? "2px solid var(--af2-clay)"
                  : "2px solid transparent",
                padding: "10px 14px",
                fontSize: 13,
                fontWeight: 600,
                color: active ? "var(--af2-ink)" : "var(--af2-ink-3)",
                cursor: "pointer",
                marginBottom: -1,
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              {tab.label}
              {tab.pro && (
                <span
                  className="af2-pill"
                  style={{ fontSize: 10, padding: "1px 6px" }}
                >
                  Pro
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div role="tabpanel" aria-label={activeTab}>
        {activeTab === "integrations" && (
          <>
            <MCPIntegrations />
            <ConnectorManagePanel
              connectorId="integration-default"
              connectorLabel="Selected integration"
            />
          </>
        )}
        {activeTab === "models" && (
          <>
            <LLMProviders />
            <ConnectorManagePanel
              connectorId="llm-default"
              connectorLabel="Selected provider"
            />
          </>
        )}
        {activeTab === "mcp" && experienceMode === "pro" && (
          <>
            <McpServers />
            <ConnectorManagePanel
              connectorId="mcp-default"
              connectorLabel="Selected MCP server"
            />
          </>
        )}
        {activeTab === "health" && experienceMode === "pro" && <HealthTab />}
      </div>
    </div>
  );
}
