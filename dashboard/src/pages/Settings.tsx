import { Link } from "react-router-dom";
import { Cpu, User, Bell, Shield, Key, PlugZap, ShieldAlert } from "lucide-react";

/**
 * Settings hub (HEL-64 v2 restyle).
 *
 * v1 of the v2 visual rebuild: keep the hub-of-sub-pages pattern (Profile,
 * Security, Notifications, etc. live on separate routes) so we don't break
 * users' bookmarks, but render it in the v2 editorial language —
 * `af2-page` + `af2-page-head` + `af2-eyebrow` + serif `af2-h1` + a tile
 * grid of `af2-card`s instead of the legacy gradient-on-soft-card pattern.
 *
 * Future iteration: collapse the sub-pages into a single tabbed surface
 * per the v2 reference (`docs/design/v2/pages-extra.jsx::AF2_Settings`),
 * which uses tabs General / Members / Policies / Security / Billing / API.
 * That requires (a) wiring Members + Billing surfaces that don't exist
 * yet and (b) inlining the existing /settings/* page content. Tracked
 * separately so this PR can land the visual change without scope creep.
 */
const SETTINGS_SECTIONS = [
  {
    to: "/settings/llm-providers",
    icon: Cpu,
    title: "LLM Providers",
    description:
      "Connect your own API keys for OpenAI, Anthropic, Gemini, and Mistral to use in workflows.",
  },
  {
    to: "/settings/integrations",
    icon: PlugZap,
    title: "Integrations",
    description: "Register and manage integration servers to use as steps in your workflows.",
  },
  {
    to: "/settings/ticketing-sla",
    icon: ShieldAlert,
    title: "Ticketing SLA",
    description:
      "Configure first-response targets, resolution windows, and escalation rules by priority.",
  },
  {
    to: "/settings/profile",
    icon: User,
    title: "Profile",
    description: "Update your display name, email, and account preferences.",
  },
  {
    to: "/settings/notifications",
    icon: Bell,
    title: "Notifications",
    description: "Choose when and how you get notified about workflow runs and alerts.",
  },
  {
    to: "/settings/security",
    icon: Shield,
    title: "Security",
    description: "Manage your password, active sessions, and two-factor authentication.",
  },
  {
    to: "/settings/api-keys",
    icon: Key,
    title: "API Keys",
    description: "Generate and manage API keys for programmatic access to AutoFlow.",
  },
];

export default function Settings() {
  return (
    <div className="af2-page" style={{ maxWidth: 920 }}>
      <div className="af2-page-head">
        <div>
          <div className="af2-eyebrow">Connect · Workspace</div>
          <h1 className="af2-h1" style={{ marginTop: 6 }}>
            Settings
          </h1>
          <div className="af2-page-head-meta">
            Manage your account and workspace configuration.
          </div>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          gap: 14,
        }}
      >
        {SETTINGS_SECTIONS.map(({ to, icon: Icon, title, description }) => (
          <Link
            key={to}
            to={to}
            style={{ textDecoration: "none", color: "inherit" }}
          >
            <div
              className="af2-card"
              style={{
                padding: 18,
                display: "flex",
                gap: 14,
                alignItems: "flex-start",
                cursor: "pointer",
                transition: "box-shadow 0.15s, border-color 0.15s",
              }}
              onMouseEnter={(event) => {
                event.currentTarget.style.boxShadow = "var(--af2-shadow)";
                event.currentTarget.style.borderColor = "var(--af2-line-2)";
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.boxShadow = "";
                event.currentTarget.style.borderColor = "";
              }}
            >
              <div
                className="af2-tone-bg-blue"
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 8,
                  display: "grid",
                  placeItems: "center",
                  flexShrink: 0,
                }}
              >
                <Icon size={18} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div
                  className="af2-h3"
                  style={{ fontSize: 16, lineHeight: 1.2, marginBottom: 4 }}
                >
                  {title}
                </div>
                <div
                  className="af2-muted"
                  style={{ fontSize: 12.5, lineHeight: 1.5 }}
                >
                  {description}
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
