import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import {
  isToolSlugInCatalog,
  resolveConnectorKeyForToolSlug,
} from "../../lib/integrationToolSlugs";

export type ConnectorHealthByKey = Record<
  string,
  { state: string; connectorName: string }
>;

export interface AgentToolChipsProps {
  tools: string[];
  connectorHealth: ConnectorHealthByKey;
}

function chipStyle(background: string, color: string): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "2px 8px",
    borderRadius: 999,
    fontSize: 10.5,
    fontWeight: 500,
    background,
    color,
    textDecoration: "none",
  };
}

export function AgentToolChips({ tools, connectorHealth }: AgentToolChipsProps) {
  if (tools.length === 0) return null;

  return (
    <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6 }}>
      {tools.map((tool) => {
        const slug = tool.trim().toLowerCase();
        const connectorKey = resolveConnectorKeyForToolSlug(slug);
        if (!connectorKey || !isToolSlugInCatalog(slug)) {
          return (
            <span
              key={tool}
              style={chipStyle("var(--af2-paper-2)", "var(--af2-ink-3)")}
              title="This integration is not available in AutoFlow yet"
            >
              {tool} · Not available yet
            </span>
          );
        }

        const health = connectorHealth[connectorKey];
        const isConnected = health?.state === "healthy";
        if (isConnected) {
          return (
            <span
              key={tool}
              style={chipStyle("rgba(90,120,90,0.15)", "var(--af2-sage)")}
            >
              {tool} · Connected
            </span>
          );
        }

        return (
          <Link
            key={tool}
            to={`/integrations/mcp?reconnect=${encodeURIComponent(connectorKey)}`}
            style={chipStyle("rgba(194,80,43,0.12)", "var(--af2-clay)")}
          >
            {tool} · Connect
          </Link>
        );
      })}
    </div>
  );
}
