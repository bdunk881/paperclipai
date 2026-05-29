import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import { CompanyLogo } from "@autoflow/logo-dev";
import {
  isToolSlugInCatalog,
  resolveConnectorKeyForToolSlug,
} from "../../lib/integrationToolSlugs";
import { useTheme, type ResolvedTheme } from "../../context/ThemeContext";

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

function ToolChipLabel({
  tool,
  connectorKey,
  suffix,
  logoTheme,
}: {
  tool: string;
  connectorKey: string | null;
  suffix: string;
  logoTheme: ResolvedTheme;
}) {
  return (
    <>
      <CompanyLogo
        integrationId={connectorKey ?? tool.trim().toLowerCase()}
        name={tool}
        size={14}
        theme={logoTheme}
        style={{ borderRadius: 4, flexShrink: 0 }}
      />
      <span>
        {tool} · {suffix}
      </span>
    </>
  );
}

export function AgentToolChips({ tools, connectorHealth }: AgentToolChipsProps) {
  const { resolvedTheme } = useTheme();

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
              <ToolChipLabel
                tool={tool}
                connectorKey={null}
                suffix="Not available yet"
                logoTheme={resolvedTheme}
              />
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
              <ToolChipLabel
                tool={tool}
                connectorKey={connectorKey}
                suffix="Connected"
                logoTheme={resolvedTheme}
              />
            </span>
          );
        }

        return (
          <Link
            key={tool}
            to={`/connections?tab=integrations&reconnect=${encodeURIComponent(connectorKey)}`}
            style={chipStyle("rgba(194,80,43,0.12)", "var(--af2-clay)")}
          >
            <ToolChipLabel
              tool={tool}
              connectorKey={connectorKey}
              suffix="Connect"
              logoTheme={resolvedTheme}
            />
          </Link>
        );
      })}
    </div>
  );
}
