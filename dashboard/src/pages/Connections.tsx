/**
 * Connections — Run pillar hub for everything an operator plugs into AutoFlow.
 *
 * Ports the v2 "Consolidation Preview" prototype
 * (`docs/design/v2/preview/consolidation.html` lines 1030–1232) into React.
 * Visuals are driven entirely by the `.af2-v2` scoped stylesheet
 * (`src/styles/af2-v2-shell.css`) — the Pro-only tabs/panels/blocks are
 * shown via `[data-pro="on"]` on the outer wrapper, so SMB and Pro
 * presentations live in the same component.
 *
 * The page is intentionally self-contained: tab state, row-drawer state,
 * and per-scope permission state are all `useState` locally. Real wiring
 * to `/api/connector-grants` lands in a follow-up; until then the rows
 * mutate in-place so QA can exercise the slider UI.
 */
import { useEffect, useState, type ReactNode } from "react";
import { useExperienceMode } from "../context/ExperienceModeContext";
import { getConnectorHealth, type ConnectorHealthRecord } from "../api/client";
import { useAuth } from "../context/AuthContext";

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

type TabId = "integrations" | "models" | "mcp" | "health" | "env-vars";

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
  { id: "env-vars", label: "Environment Variables", pro: true },
];

// ---------------------------------------------------------------------------
// Integration row + collapsible drawer.
// ---------------------------------------------------------------------------

interface IntegrationRowProps {
  id: string;
  logo: string;
  name: string;
  desc: string;
  pill: ReactNode;
  action: ReactNode;
  expanded: boolean;
  onToggle: (id: string) => void;
  children?: ReactNode;
}

function IntegrationRow({
  id,
  logo,
  name,
  desc,
  pill,
  action,
  expanded,
  onToggle,
  children,
}: IntegrationRowProps) {
  return (
    <>
      <div
        className="int-row"
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={() => onToggle(id)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggle(id);
          }
        }}
      >
        <div className="int-logo">{logo}</div>
        <div>
          <div className="int-name">{name}</div>
          <div className="int-desc">{desc}</div>
        </div>
        {pill}
        {action}
      </div>
      <div className={`row-drawer${expanded ? " open" : ""}`}>{children}</div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

function stateToPill(state: ConnectorHealthRecord["state"]): ReactNode {
  if (state === "healthy") {
    return <span className="pill dot sage">connected</span>;
  }
  if (state === "degraded") {
    return <span className="pill dot mustard">degraded</span>;
  }
  if (state === "auth_failed") {
    return <span className="pill dot clay">auth failed</span>;
  }
  if (state === "disabled") {
    return <span className="pill">disabled</span>;
  }
  if (state === "provider_error") {
    return <span className="pill dot clay">provider error</span>;
  }
  return <span className="pill">not connected</span>;
}

function logoLetter(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

function useConnectorHealth(): {
  connectors: ConnectorHealthRecord[];
  loading: boolean;
  error: string | null;
} {
  const { getAccessToken } = useAuth();
  const [connectors, setConnectors] = useState<ConnectorHealthRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const token = (await getAccessToken()) ?? undefined;
        const result = await getConnectorHealth(token);
        if (!cancelled) setConnectors(result.connectors ?? []);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Failed to load connectors");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getAccessToken]);

  return { connectors, loading, error };
}

function IntegrationsPanel() {
  const { connectors, loading, error } = useConnectorHealth();
  const [openId, setOpenId] = useState<string | null>(null);
  const toggle = (id: string) => setOpenId((cur) => (cur === id ? null : id));
  const collapse = () => setOpenId(null);

  return (
    <div className="panel" role="tabpanel" id="con-int">
      {loading ? (
        <div className="card">
          <p className="desc">Loading…</p>
        </div>
      ) : error ? (
        <div className="card">
          <p className="desc" style={{ color: "var(--af2-clay)" }}>{error}</p>
        </div>
      ) : connectors.length === 0 ? (
        <div className="card">
          <p className="desc">
            No integrations connected yet. Browse the integration catalog →
          </p>
        </div>
      ) : (
        connectors.map((c) => (
          <IntegrationRow
            key={c.connectorKey}
            id={c.connectorKey}
            logo={logoLetter(c.connectorName)}
            name={c.connectorName}
            desc={c.lastSuccessAt ? `Last sync ${new Date(c.lastSuccessAt).toLocaleString()}` : "Not yet synced"}
            pill={stateToPill(c.state)}
            action={
              <button
                type="button"
                className={`btn sm${c.state === "auth_failed" ? " primary" : ""}`}
                onClick={(e) => e.stopPropagation()}
              >
                {c.state === "auth_failed" ? "Reconnect" : "Manage"}
              </button>
            }
            expanded={openId === c.connectorKey}
            onToggle={toggle}
          >
            <div className="row-drawer-head">
              <div>
                <div className="eyebrow" style={{ marginBottom: 4 }}>
                  Connection
                </div>
                <h3>{c.connectorName} · permissions</h3>
              </div>
              <button
                type="button"
                className="btn ghost sm"
                onClick={(event) => {
                  event.stopPropagation();
                  collapse();
                }}
              >
                Collapse ↑
              </button>
            </div>
            <p style={{ fontSize: 13, color: "var(--af2-ink-2)" }}>
              Set per-scope access. <b>Allow</b> = unrestricted · <b>Ask</b> = approval
              required before each call · <b>Don&apos;t allow</b> = blocked.
            </p>
            <p className="desc">
              No scopes configured. Drag this integration onto a mission, team, or agent to grant access.
            </p>
          </IntegrationRow>
        ))
      )}
    </div>
  );
}

function ModelsPanel() {
  return (
    <div className="panel" role="tabpanel" id="con-models">
      <div className="card">
        <p className="desc">
          No model providers configured yet. Add an OpenAI, Anthropic, or other
          provider key in Settings → Models.
        </p>
      </div>
    </div>
  );
}

function McpPanel() {
  return (
    <div className="panel" role="tabpanel" id="con-mcp">
      <div className="card">
        <h3>Custom MCP servers</h3>
        <p className="desc">
          Bring your own MCP server (stdio or HTTP). Each server&apos;s tools get a
          scope-permission slider just like integrations.
        </p>
        <p className="desc" style={{ marginTop: 10 }}>
          No MCP servers added yet.
        </p>
      </div>
    </div>
  );
}

function HealthPanel() {
  const { connectors, loading, error } = useConnectorHealth();

  return (
    <div className="panel" role="tabpanel" id="con-health">
      <div className="card card-list" style={{ padding: 0 }}>
        {loading ? (
          <div style={{ padding: 16, color: "var(--af2-ink-3)", fontSize: 13 }}>
            Loading…
          </div>
        ) : error ? (
          <div style={{ padding: 16, color: "var(--af2-clay)", fontSize: 13 }}>
            {error}
          </div>
        ) : connectors.length === 0 ? (
          <div style={{ padding: 16, color: "var(--af2-ink-3)", fontSize: 13 }}>
            No connectors to report on yet.
          </div>
        ) : (
          <>
            <div
              className="row"
              style={{
                gridTemplateColumns: "1fr 130px 110px 110px 110px",
                background: "var(--af2-paper-2)",
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: "0.1em",
              }}
            >
              <div>Connector</div>
              <div>Status</div>
              <div>Last poll</div>
              <div>Errors 24h</div>
              <div></div>
            </div>
            {connectors.map((c) => (
              <div
                key={c.connectorKey}
                className="row"
                style={{ gridTemplateColumns: "1fr 130px 110px 110px 110px" }}
              >
                <div>
                  <b>{c.connectorName}</b>
                  <br />
                  <span className="id">{c.connectorKey}</span>
                </div>
                <div>{stateToPill(c.state)}</div>
                <div className="id">
                  {c.lastSuccessAt
                    ? new Date(c.lastSuccessAt).toLocaleTimeString()
                    : "—"}
                </div>
                <div>{c.authFailures15m + c.rateLimitEvents15m}</div>
                <div className="actions">
                  <button
                    type="button"
                    className={`btn sm${c.state === "auth_failed" ? " primary" : ""}`}
                  >
                    {c.state === "auth_failed" ? "Reconnect" : "Logs"}
                  </button>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function EnvVarsPanel() {
  return (
    <div className="panel" role="tabpanel" id="con-env">
      <div className="info-strip">
        Encrypted at rest (pgcrypto, mirrors <code>provisioned_company_secrets</code>) ·
        values are <b>write-only</b> · agents get short-lived signed deref tokens at
        execution time · audit row on every grant change · <b>cannot drift</b>.
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
        <button type="button" className="btn primary">
          + Add env var
        </button>
      </div>
      <div className="card">
        <p className="desc">
          No environment variables saved yet.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Connections() {
  const { mode } = useExperienceMode();
  const isPro = mode === "pro";
  const [active, setActive] = useState<TabId>("integrations");

  return (
    <div className="af2-v2" data-pro={isPro ? "on" : "off"}>
      <section className="hub" data-hub="connections">
        <div className="page-head">
          <div className="page-head-left">
            <div className="eyebrow">Run · Connections</div>
            <h1 className="h1">Connections</h1>
            <div className="meta">
              Per-mission / per-team / per-agent permission scoping · moved to Run pillar
            </div>
          </div>
        </div>

        <div className="pro-banner">
          Pro mode reveals <b>MCP Servers</b>, <b>Health</b>, and{" "}
          <b>Environment Variables</b> tabs · plus raw client/secret fields per
          connector.
        </div>

        <div className="tabs" role="tablist" aria-label="Connections sections">
          {TABS.map((tab) => {
            const selected = active === tab.id;
            const cls = tab.pro ? "tab pro-tab" : "tab";
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={selected}
                className={cls}
                onClick={() => setActive(tab.id)}
              >
                {tab.label}
                {tab.pro && <span className="pro-chip">PRO</span>}
              </button>
            );
          })}
        </div>

        <div hidden={active !== "integrations"}>
          <IntegrationsPanel />
        </div>
        <div hidden={active !== "models"}>
          <ModelsPanel />
        </div>
        <div hidden={active !== "mcp"}>
          <McpPanel />
        </div>
        <div hidden={active !== "health"}>
          <HealthPanel />
        </div>
        <div hidden={active !== "env-vars"}>
          <EnvVarsPanel />
        </div>
      </section>
    </div>
  );
}
